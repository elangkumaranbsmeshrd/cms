"""Module 15 §6.1 / §7.9 — "Require an Attachment Before Recording a
Remittance", the tax-compliance module's one deferred toggle
(app/rbac/toggles.py's own comment: "the module's one explicitly-deferred
toggle ... the only real toggle this module needs"). OFF by default, same
posture as every document in this CMS before its own toggle was built
(compliance.py's record_remittance docstring cites Purchase Bill's "Require
Attachment Before Marking a Bill Paid" as the direct precedent).

Checked against the INCOMING body's receipt_file_id, not a stored
has_attachment column — Record Remittance is a single-step create, so there
is no prior record to inspect (record_remittance's own comment). These tests
prove:
  1. ON + no attachment -> rejected, and rejected BEFORE any deeper
     validation runs (documents_covered is deliberately left summing to the
     wrong total, so a pass here could only mean the attachment gate, not
     a lucky validation order).
  2. ON + a receipt_file_id (a fake UUID, never resolved against a real
     stored file — see the assertion below that record_remittance never
     calls db.get(StoredFile, ...) on it) -> the gate lets the request
     through to the next real check.
  3. OFF (default) + no attachment -> same as #2, without needing a
     receipt_file_id at all.

Route under test is called directly (this suite has no HTTP test-client
fixture yet — same "call the function, build the rows by hand" style as
tests/rbac/test_matrix.py's db_session-based tests), so `perms` is a
plain PermissionSet built by hand: record_remittance's own body never reads
it (require_screen's RBAC check is what would normally construct it, and is
bypassed entirely by calling the endpoint function directly).
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.compliance import record_remittance
from app.models.masters import TaxHead, TaxHeadWithholdingDirection
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.models.rbac import FeatureToggle, Role
from app.rbac.resolver import PermissionSet
from app.schemas.compliance import RemittanceCreate

TOGGLE_KEY = "Require an Attachment Before Recording a Remittance"
ATTACHMENT_REQUIRED_DETAIL = "A receipt attachment is required before this remittance can be recorded"
# The deliberately-mismatched documents_covered below (empty, against a
# positive Amount Remitted) always fails here next — §2.5's exact-match
# rule, the next check after the attachment gate in record_remittance.
DOCUMENTS_MISMATCH_DETAIL = "Documents Covered must sum to exactly Amount Remitted"


async def _seed_base(db: AsyncSession) -> tuple[User, TaxHead]:
    """Everything record_remittance needs on the DB side just to get past its
    tax-head/date/amount guards and reach the attachment check: a current
    Financial Year (get_current_financial_year is called right after the
    gate), an onward-liability Tax Head carrying the Module 15 compliance
    fields (remittance_period/period_aligns_to/deposit_due_days_after_
    period_end/liability_arises_on) record_remittance itself reads off
    `head`, its Withholding Direction row (masters_taxes.py's own
    WITHHOLDING_AT_SOURCE + "at least one direction required" pairing —
    ON_PAYMENTS_MADE is the one obligation_engine.py's
    _liability_source_for_head maps to PURCHASE_BILL/"Vendor"), and a user
    to record the remittance as.
    """
    role = Role(id=str(uuid.uuid4()), code="ACCOUNTANT", name="Accountant")
    db.add(role)
    await db.flush()
    user = User(id=str(uuid.uuid4()), email="accountant@test.local", password_hash="x", full_name="Test Accountant", role_id=role.id)
    db.add(user)

    db.add(FinancialYear(id=str(uuid.uuid4()), label="2026", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True))

    head = TaxHead(
        id=str(uuid.uuid4()), tax_name="TDS on Professional Fees", scope="WITHHOLDING_AT_SOURCE", tax_type="PERCENTAGE",
        applies_from=date(2026, 4, 1), rate_pct=Decimal("10"), creates_onward_liability=True,
        remitted_to_authority="Income Tax Department", remittance_period="MONTHLY", period_aligns_to="CALENDAR",
        deposit_due_days_after_period_end=7, liability_arises_on="PAYMENT_DATE", authority_reference_label="Challan Number",
    )
    db.add(head)
    await db.flush()
    db.add(TaxHeadWithholdingDirection(id=str(uuid.uuid4()), tax_head_id=head.id, direction="ON_PAYMENTS_MADE"))
    await db.commit()
    return user, head


async def _seed_toggle(db: AsyncSession, *, enabled: bool) -> None:
    """Mirrors app/seed.py's own FeatureToggle row shape exactly
    (label=toggle_key, default_enabled=False per TOGGLE_DEFAULTS) — the only
    field this test varies is `enabled`, Super Admin's live runtime setting.
    """
    db.add(FeatureToggle(id=str(uuid.uuid4()), toggle_key=TOGGLE_KEY, module_key="compliance", label=TOGGLE_KEY, enabled=enabled, default_enabled=False))
    await db.commit()


def _body(head: TaxHead, *, receipt_file_id: str | None) -> RemittanceCreate:
    """documents_covered is deliberately left empty against a positive
    Amount Remitted — a real §2.5 "must sum to exactly Amount Remitted"
    mismatch — so every test below that gets past the attachment gate
    reaches an actual, deterministic LATER validation instead of
    accidentally succeeding (or passing for the wrong reason).
    """
    return RemittanceCreate(
        tax_head_id=head.id, period_from=date(2026, 4, 1), period_to=date(2026, 4, 30), amount_remitted=Decimal("1000"),
        paid_on=date(2026, 4, 28), paid_from_bank_account_id=str(uuid.uuid4()), payment_mode_id=str(uuid.uuid4()),
        authority_reference="CHALLAN-001", receipt_file_id=receipt_file_id, documents_covered=[],
    )


def _perms() -> PermissionSet:
    return PermissionSet(screen_key="compliance.remittances", mode="full", allowed_actions=frozenset({"record"}))


async def test_toggle_on_no_attachment_is_rejected_before_any_deeper_validation(db_session):
    """Toggle ON, no receipt_file_id in the body: rejected 422 with the
    attachment-specific message, even though documents_covered is also
    wrong — proving the attachment gate fires first, not merely that the
    request eventually fails for some reason.
    """
    user, head = await _seed_base(db_session)
    await _seed_toggle(db_session, enabled=True)

    with pytest.raises(HTTPException) as exc_info:
        await record_remittance(body=_body(head, receipt_file_id=None), db=db_session, current_user=user, perms=_perms())

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == ATTACHMENT_REQUIRED_DETAIL


async def test_toggle_on_with_attachment_id_passes_the_gate_and_reaches_later_validation(db_session):
    """Toggle ON, WITH a receipt_file_id (a fake UUID that names no real
    stored file): the gate only checks the field is present
    (`not body.receipt_file_id` in compliance.py), never resolves it against
    a StoredFile row, so a fake id gets exactly as far as a real one — past
    the gate and into the next real check (§2.5's documents_covered sum).
    """
    user, head = await _seed_base(db_session)
    await _seed_toggle(db_session, enabled=True)

    with pytest.raises(HTTPException) as exc_info:
        await record_remittance(body=_body(head, receipt_file_id=str(uuid.uuid4())), db=db_session, current_user=user, perms=_perms())

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail != ATTACHMENT_REQUIRED_DETAIL
    assert exc_info.value.detail == DOCUMENTS_MISMATCH_DETAIL


async def test_toggle_off_no_attachment_passes_the_gate_and_reaches_later_validation(db_session):
    """Toggle OFF (its default posture): the same no-attachment request that
    test #1 rejected now proceeds past the attachment check entirely,
    reaching the same later validation as #2 — without ever needing a
    receipt_file_id.
    """
    user, head = await _seed_base(db_session)
    await _seed_toggle(db_session, enabled=False)

    with pytest.raises(HTTPException) as exc_info:
        await record_remittance(body=_body(head, receipt_file_id=None), db=db_session, current_user=user, perms=_perms())

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail != ATTACHMENT_REQUIRED_DETAIL
    assert exc_info.value.detail == DOCUMENTS_MISMATCH_DETAIL
