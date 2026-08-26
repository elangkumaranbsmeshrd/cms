"""Module 15 — Tax & Compliance (15-tax-compliance-module.md). Money the
company holds on somebody else's behalf (Obligations, §2.1-2.5) and money
somebody else holds on the company's behalf (Credits, §2.6-2.9) — the two
panels are never netted (§2.1/§4's single most important visual rule).

The Obligations/Credits REGISTERS themselves are never stored — every figure
here is computed fresh by obligation_engine.py/credits_engine.py from rows
that already exist (Purchase Bill withholding, Payslip statutory deductions,
Invoice customer withholding) netted against this module's own real
documents (remittances, certificates, claims). See those two service files'
docstrings for the full reasoning.
"""

import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.compliance import CertificateReceipt, CreditClaim, Remittance, RemittanceAllocation, WithholdingCertificate
from app.models.customer import Customer
from app.models.finance import Invoice, InvoicePayment
from app.models.masters import BankAccount, PayCycle, PaymentMode, TaxHead
from app.models.platform import User
from app.models.rbac import FeatureToggle
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.compliance import (
    CertificateCreate,
    CertificateOut,
    CertificateReceiptOut,
    CertificateVoidRequest,
    CreditClaimCreate,
    CreditClaimOut,
    CreditRowOut,
    ObligationsByDocumentRow,
    ObligationPeriodOut,
    OverviewOut,
    RemittanceAllocationOut,
    RemittanceCreate,
    RemittanceEligibleDocumentOut,
    RemittanceOut,
    RemittanceReverseRequest,
)
from app.services import credits_engine, list_export, obligation_engine
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/compliance", tags=["compliance"])


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _obligation_periods(db: AsyncSession, tax_head_id: str | None = None) -> list[obligation_engine.ObligationPeriod]:
    fy = await get_current_financial_year(db)
    return await obligation_engine.build_obligation_periods(db, date.today(), tax_head_id=tax_head_id, fy_start_month=fy.start_date.month)


def _period_to_out(p: obligation_engine.ObligationPeriod) -> ObligationPeriodOut:
    return ObligationPeriodOut(
        tax_head_id=p.tax_head_id, tax_head_name=p.tax_head_name, remitted_to=p.remitted_to, source_label=p.source_label,
        period_label=p.period_label, period_from=p.period_from, period_to=p.period_to, withheld=p.withheld,
        remitted=p.remitted, outstanding=p.outstanding, due_date=p.due_date, status=p.status,
        authority_reference_label=p.authority_reference_label,
        documents=[
            {
                "source_type": d.source_type, "source_id": d.source_id, "document_label": d.document_label,
                "counterparty": d.counterparty, "event_date": d.event_date, "amount": d.amount,
                "document_total": d.document_total, "calculated_on": d.calculated_on,
            }
            for d in p.documents
        ],
    )


# ================================================================== OVERVIEW
@router.get("/overview", response_model=OverviewOut)
async def overview(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("compliance.overview")),
) -> OverviewOut:
    fy = await get_current_financial_year(db)
    periods = await _obligation_periods(db)

    # "Withheld — Not Yet Remitted" / "Due Within 7 Days" / "Overdue" are
    # point-in-time snapshots (as-of-today outstanding), correctly unscoped
    # by FY — only the three widgets whose own label says "This FY" need a
    # financial-year window.
    withheld_not_remitted = sum((p.outstanding for p in periods if p.outstanding > 0), Decimal("0"))
    due_within_7 = sum((p.outstanding for p in periods if p.status == "DUE_SOON"), Decimal("0"))
    overdue = sum((p.outstanding for p in periods if p.status == "OVERDUE"), Decimal("0"))
    # Remittance.financial_year_id is stamped at record time (numbering.py's
    # get_current_financial_year, the same FY resolved here) — summing
    # directly off it (rather than off `periods`, which spans every FY that
    # ever had activity) is what actually resets this widget at the FY
    # boundary; found unscoped entirely by the close-out audit. Includes
    # reversal rows (negative-signed), so a remit-then-reverse within the
    # same FY correctly nets to zero.
    remitted_this_fy = (
        await db.execute(select(func.coalesce(func.sum(Remittance.amount_remitted), 0)).where(Remittance.financial_year_id == fy.id))
    ).scalar_one()

    credits = await credits_engine.build_credit_rows(db)
    certificate_outstanding = sum((c.withheld for c in credits if c.status == "AWAITING_CERTIFICATE"), Decimal("0"))
    certified_unclaimed = sum((c.withheld for c in credits if c.status == "CERTIFIED_UNCLAIMED"), Decimal("0"))
    # "Withheld by Customers — This FY": scoped by the receipt's own
    # payment_date, the natural "when did this withholding happen" date —
    # same close-out-audit gap as remitted_this_fy above.
    withheld_by_customers = sum(
        (c.withheld for c in credits if fy.start_date <= c.payment_date <= fy.end_date), Decimal("0"),
    )
    # "Credit Claimed This FY": scoped by CLAIM date, not the underlying
    # receipt's date — a credit withheld last FY but claimed this FY belongs
    # in THIS widget, matching "Remitted This FY" scoping by the remittance
    # event's own date rather than the original withholding's date.
    claimed_this_fy = (
        await db.execute(
            select(func.coalesce(func.sum(CreditClaim.amount_claimable), 0)).where(CreditClaim.claim_date >= fy.start_date, CreditClaim.claim_date <= fy.end_date)
        )
    ).scalar_one()

    due_soon_and_overdue = sorted(
        [p for p in periods if p.status in ("DUE_SOON", "OVERDUE")], key=lambda p: p.due_date,
    )

    # ACTIVE and not yet claimed — a perfectly-matched (variance=0) certificate
    # sitting unclaimed is the everyday §3.2 "chase" case this table exists
    # for, and a claimed certificate (which never changes cert.status away
    # from ACTIVE — only void_certificate does) must drop off once settled.
    # The old `variance != 0` filter inverted both of these: it showed only
    # the comparatively rare mismatch case and never excluded claimed rows.
    claimed_cert_ids = select(CreditClaim.certificate_id)
    outstanding_certs = (
        await db.execute(
            select(WithholdingCertificate)
            .where(WithholdingCertificate.status == "ACTIVE", WithholdingCertificate.id.not_in(claimed_cert_ids))
            .order_by(WithholdingCertificate.certificate_date)
        )
    ).scalars().all()

    return OverviewOut(
        has_obligation_heads_configured=await obligation_engine.has_any_liability_head(db),
        has_credit_heads_configured=await credits_engine.has_any_credit_head(db),
        withheld_not_yet_remitted=withheld_not_remitted, due_within_7_days=due_within_7, overdue_remittances=overdue,
        remitted_this_fy=remitted_this_fy, withheld_by_customers_this_fy=withheld_by_customers,
        certificate_outstanding=certificate_outstanding, certified_not_yet_claimed=certified_unclaimed,
        credit_claimed_this_fy=claimed_this_fy,
        due_soon_and_overdue=[_period_to_out(p) for p in due_soon_and_overdue],
        certificates_outstanding_oldest_first=await _certificates_to_out(db, outstanding_certs),
    )


# =============================================================== OBLIGATIONS
_OBLIGATIONS_COLUMNS = [
    ColumnSpec("tax_head_name", "Tax Head"),
    ColumnSpec("remitted_to", "Remitted To"),
    ColumnSpec("source_label", "Source"),
    ColumnSpec("period_label", "Period"),
    ColumnSpec("period_from", "Period From"),
    ColumnSpec("period_to", "Period To"),
    ColumnSpec("documents", "Documents", align="right"),
    ColumnSpec("withheld", "Withheld", align="left"),
    ColumnSpec("remitted", "Remitted", align="left"),
    ColumnSpec("outstanding", "Outstanding", align="left"),
    ColumnSpec("due_date", "Due Date"),
    ColumnSpec("status", "Status"),
    ColumnSpec("authority_reference", "Authority Reference"),
]


@router.get("/obligations", response_model=None)
async def list_obligations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.obligations")),
    tax_head_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    source: str | None = Query(None, description="Vendor | Employee"),
    due_date_from: date | None = Query(None),
    due_date_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches Tax Head, Remitted To, Authority Reference"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ObligationPeriodOut] | Response:
    periods = await _obligation_periods(db, tax_head_id=tax_head_id)
    if status_filter:
        periods = [p for p in periods if p.status in status_filter]
    if source:
        periods = [p for p in periods if p.source_label == source]
    if due_date_from:
        periods = [p for p in periods if p.due_date >= due_date_from]
    if due_date_to:
        periods = [p for p in periods if p.due_date <= due_date_to]
    if search:
        needle = search.lower()
        periods = [
            p for p in periods
            if needle in p.tax_head_name.lower() or needle in (p.remitted_to or "").lower() or needle in (p.authority_reference_label or "").lower()
        ]

    if format:
        export_rows = [
            {
                "tax_head_name": p.tax_head_name, "remitted_to": p.remitted_to or "", "source_label": p.source_label,
                "period_label": p.period_label, "period_from": p.period_from, "period_to": p.period_to, "documents": len(p.documents),
                "withheld": p.withheld, "remitted": p.remitted, "outstanding": p.outstanding, "due_date": p.due_date, "status": p.status,
                "authority_reference": p.authority_reference_label or "",
            }
            for p in periods
        ]
        filters_applied = {"tax_head_id": tax_head_id, "status": status_filter, "source": source, "due_date_from": due_date_from, "due_date_to": due_date_to, "search": search}
        return await list_export.build_export(format, db, current_user, "Obligations — Withheld on Payments", _OBLIGATIONS_COLUMNS, export_rows, filters_applied)

    return [_period_to_out(p) for p in periods]


_BY_DOCUMENT_COLUMNS = [
    ColumnSpec("document_label", "Document"),
    ColumnSpec("source_label", "Source"),
    ColumnSpec("counterparty", "Counterparty"),
    ColumnSpec("event_date", "Date"),
    ColumnSpec("tax_head_name", "Tax Head"),
    ColumnSpec("calculated_on", "Calculated On"),
    ColumnSpec("document_total", "Document Total", align="left"),
    ColumnSpec("withheld", "Withheld", align="left"),
    ColumnSpec("net_paid", "Net Paid", align="left"),
    ColumnSpec("period_label", "Period"),
    ColumnSpec("remittance_status", "Remittance Status"),
    ColumnSpec("authority_reference", "Authority Reference"),
]


@router.get("/obligations/by-document", response_model=None)
async def obligations_by_document(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.obligations_by_document")),
    tax_head_id: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches Document, Counterparty, Tax Head"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ObligationsByDocumentRow] | Response:
    periods = await _obligation_periods(db, tax_head_id=tax_head_id)
    all_source_ids = [d.source_id for p in periods for d in p.documents]
    allocated_rows = (
        await db.execute(select(RemittanceAllocation.source_id, RemittanceAllocation.amount_allocated).where(RemittanceAllocation.source_id.in_(all_source_ids)))
    ).all() if all_source_ids else []
    allocated_by_source: dict[str, Decimal] = {}
    for source_id, amt in allocated_rows:
        allocated_by_source[source_id] = allocated_by_source.get(source_id, Decimal("0")) + amt

    rows: list[ObligationsByDocumentRow] = []
    for p in periods:
        for d in p.documents:
            allocated = allocated_by_source.get(d.source_id, Decimal("0"))
            if allocated <= 0:
                rem_status = "OPEN"
            elif allocated >= d.amount:
                rem_status = "REMITTED"
            else:
                rem_status = "PART_REMITTED"
            rows.append(ObligationsByDocumentRow(
                source_type=d.source_type, source_id=d.source_id, document_label=d.document_label, source_label=p.source_label,
                counterparty=d.counterparty, event_date=d.event_date, tax_head_id=p.tax_head_id, tax_head_name=p.tax_head_name,
                calculated_on=d.calculated_on, document_total=d.document_total, withheld=d.amount, net_paid=d.document_total - d.amount,
                period_label=p.period_label, remittance_status=rem_status, authority_reference=p.authority_reference_label,
            ))
    if date_from:
        rows = [r for r in rows if r.event_date >= date_from]
    if date_to:
        rows = [r for r in rows if r.event_date <= date_to]
    if search:
        needle = search.lower()
        rows = [r for r in rows if needle in r.document_label.lower() or needle in r.counterparty.lower() or needle in r.tax_head_name.lower()]
    rows.sort(key=lambda r: r.event_date, reverse=True)

    if format:
        export_rows = [
            {
                "document_label": r.document_label, "source_label": r.source_label, "counterparty": r.counterparty,
                "event_date": r.event_date, "tax_head_name": r.tax_head_name, "calculated_on": r.calculated_on or "",
                "document_total": r.document_total, "withheld": r.withheld, "net_paid": r.net_paid, "period_label": r.period_label,
                "remittance_status": r.remittance_status, "authority_reference": r.authority_reference or "",
            }
            for r in rows
        ]
        return await list_export.build_export(format, db, current_user, "Obligations — By Document", _BY_DOCUMENT_COLUMNS, export_rows, {"tax_head_id": tax_head_id, "date_from": date_from, "date_to": date_to, "search": search})

    return rows


# =============================================================== REMITTANCES
_REMITTANCE_COLUMNS = [
    ColumnSpec("remittance_number", "Remittance ID"),
    ColumnSpec("tax_head_name_snapshot", "Tax Head"),
    ColumnSpec("remitted_to", "Remitted To"),
    ColumnSpec("period_label", "Period"),
    ColumnSpec("amount_remitted", "Amount Remitted", align="left"),
    ColumnSpec("paid_on", "Paid On"),
    ColumnSpec("paid_from", "Paid From"),
    ColumnSpec("mode", "Mode"),
    ColumnSpec("authority_reference", "Authority Reference"),
    ColumnSpec("documents_covered", "Documents Covered"),
    ColumnSpec("recorded_by", "Recorded By"),
]


async def _remittances_to_out(db: AsyncSession, rows: list[Remittance]) -> list[RemittanceOut]:
    """Shared by list_remittances/record_remittance/reverse_remittance so all
    three resolve names (Payment Mode, Bank Account, Recorded By) and
    Documents Covered identically, batched (no N+1 per remittance).
    """
    if not rows:
        return []
    mode_ids = {r.payment_mode_id for r in rows}
    bank_ids = {r.paid_from_bank_account_id for r in rows}
    user_ids = {r.recorded_by for r in rows}
    modes = {m.id: m.name for m in (await db.execute(select(PaymentMode).where(PaymentMode.id.in_(mode_ids)))).scalars().all()}
    banks = {b.id: b.nickname for b in (await db.execute(select(BankAccount).where(BankAccount.id.in_(bank_ids)))).scalars().all()}
    users = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}

    allocations = (
        await db.execute(select(RemittanceAllocation).where(RemittanceAllocation.remittance_id.in_([r.id for r in rows])))
    ).scalars().all()
    labels = await obligation_engine.resolve_document_labels(db, [(a.source_type, a.source_id) for a in allocations])
    allocs_by_remittance: dict[str, list] = {}
    for a in allocations:
        allocs_by_remittance.setdefault(a.remittance_id, []).append(
            RemittanceAllocationOut(
                source_type=a.source_type, source_id=a.source_id,
                document_label=labels.get((a.source_type, a.source_id), a.source_id), amount=a.amount_allocated,
            )
        )

    out = []
    for r in rows:
        out.append(RemittanceOut(
            id=r.id, remittance_number=r.remittance_number, financial_year_id=r.financial_year_id, tax_head_id=r.tax_head_id,
            tax_head_name_snapshot=r.tax_head_name_snapshot, remitted_to_snapshot=r.remitted_to_snapshot, period_label=r.period_label,
            period_from=r.period_from, period_to=r.period_to, amount_remitted=r.amount_remitted, paid_on=r.paid_on,
            paid_from_bank_account_id=r.paid_from_bank_account_id, paid_from_bank_account_name=banks.get(r.paid_from_bank_account_id, ""),
            payment_mode_id=r.payment_mode_id, payment_mode_name=modes.get(r.payment_mode_id, ""), authority_reference=r.authority_reference,
            receipt_file_id=r.receipt_file_id, notes=r.notes, recorded_by=r.recorded_by, recorded_by_name=users.get(r.recorded_by, ""),
            is_reversal=r.is_reversal, reverses_remittance_id=r.reverses_remittance_id, reversal_reason=r.reversal_reason,
            documents_covered=allocs_by_remittance.get(r.id, []), created_at=r.created_at,
        ))
    return out


@router.get("/remittances", response_model=None)
async def list_remittances(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.remittances")),
    tax_head_id: str | None = Query(None),
    paid_on_from: date | None = Query(None),
    paid_on_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches Remittance ID, Tax Head, Authority Reference"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[RemittanceOut] | Response:
    stmt = select(Remittance).order_by(Remittance.paid_on.desc())
    if tax_head_id:
        stmt = stmt.where(Remittance.tax_head_id == tax_head_id)
    if paid_on_from:
        stmt = stmt.where(Remittance.paid_on >= paid_on_from)
    if paid_on_to:
        stmt = stmt.where(Remittance.paid_on <= paid_on_to)
    raw_rows = (await db.execute(stmt)).scalars().all()
    rows = await _remittances_to_out(db, raw_rows)
    if search:
        needle = search.lower()
        rows = [
            r for r in rows
            if needle in r.remittance_number.lower() or needle in r.tax_head_name_snapshot.lower() or needle in r.authority_reference.lower()
        ]

    if format:
        export_rows = [
            {
                "remittance_number": r.remittance_number, "tax_head_name_snapshot": r.tax_head_name_snapshot,
                "remitted_to": r.remitted_to_snapshot or "", "period_label": r.period_label, "amount_remitted": r.amount_remitted,
                "paid_on": r.paid_on, "paid_from": r.paid_from_bank_account_name, "mode": r.payment_mode_name,
                "authority_reference": r.authority_reference,
                "documents_covered": "; ".join(f"{d.document_label} (₹{d.amount:,.2f})" for d in r.documents_covered),
                "recorded_by": r.recorded_by_name,
            }
            for r in rows
        ]
        filters_applied = {"tax_head_id": tax_head_id, "paid_on_from": paid_on_from, "paid_on_to": paid_on_to, "search": search}
        return await list_export.build_export(format, db, current_user, "Remittances", _REMITTANCE_COLUMNS, export_rows, filters_applied)

    return rows


@router.get("/remittances/documents-in-period", response_model=list[RemittanceEligibleDocumentOut])
async def remittance_documents_in_period(
    tax_head_id: str,
    period_from: date,
    period_to: date,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("compliance.remittances")),
) -> list[dict]:
    fy = await get_current_financial_year(db)
    return await obligation_engine.documents_in_period(db, tax_head_id, period_from, period_to, fy_start_month=fy.start_date.month)


@router.post("/remittances", response_model=RemittanceOut, status_code=status.HTTP_201_CREATED)
async def record_remittance(
    body: RemittanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.remittances", action="record")),
) -> RemittanceOut:
    head = await db.get(TaxHead, body.tax_head_id)
    if head is None or not head.creates_onward_liability:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Tax head not found or does not create an onward liability")
    if body.paid_on > date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Paid On cannot be in the future")
    if body.amount_remitted <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Amount Remitted must be positive")
    # §6.1 "Require an Attachment Before Recording a Remittance" — OFF by
    # default: Receipt Attachment stays optional, same posture as every
    # other document in this CMS before its own toggle was built (Purchase
    # Bill's "Require Attachment Before Marking a Bill Paid" is the direct
    # precedent). Checked against the INCOMING body, not a stored has_
    # attachment column — unlike Purchase Bill, Record Remittance is a
    # single-step create, so there is no prior record to inspect.
    if not body.receipt_file_id and await _toggle_enabled(db, "Require an Attachment Before Recording a Remittance"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A receipt attachment is required before this remittance can be recorded")

    fy = await get_current_financial_year(db)
    eligible = {
        d["source_id"]: d
        for d in await obligation_engine.documents_in_period(db, body.tax_head_id, body.period_from, body.period_to, fy_start_month=fy.start_date.month)
    }
    # Running remaining-outstanding per source_id, decremented as each
    # documents_covered entry consumes it — found missing by the close-out
    # audit: checking every entry against the same static `eligible`
    # snapshot let two entries for the SAME document each pass individually
    # (e.g. 700 + 700 against a document only ever outstanding 1000), writing
    # allocation rows that summed past what was ever actually withheld.
    remaining = {source_id: doc["outstanding"] for source_id, doc in eligible.items()}
    covered_total = Decimal("0")
    for alloc in body.documents_covered:
        doc = eligible.get(alloc.source_id)
        if doc is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Document {alloc.source_id} is not an eligible outstanding document for this period")
        if alloc.amount <= 0 or alloc.amount > remaining[alloc.source_id]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Allocation for {alloc.source_id} exceeds its remaining outstanding withheld amount")
        remaining[alloc.source_id] -= alloc.amount
        covered_total += alloc.amount
    # §2.5: "the ticked total must equal Amount Remitted, and a part-allocation
    # on the final ticked document is permitted" — the exact-match requirement
    # itself, not which document carries the remainder.
    if covered_total != body.amount_remitted:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Documents Covered must sum to exactly Amount Remitted")

    number = await allocate_number(db, "RMT", fy.id, fy.label)
    pay_cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    period_label = obligation_engine.resolve_period_bounds(
        body.period_from, head.remittance_period, head.period_aligns_to, head.deposit_due_days_after_period_end,
        pay_cycle=pay_cycle, fy_start_month=fy.start_date.month,
    )[2]

    row = Remittance(
        id=str(uuid.uuid4()), remittance_number=number, financial_year_id=fy.id, tax_head_id=head.id,
        tax_head_name_snapshot=head.tax_name, remitted_to_snapshot=head.remitted_to_authority, period_label=period_label,
        period_from=body.period_from, period_to=body.period_to, amount_remitted=body.amount_remitted, paid_on=body.paid_on,
        paid_from_bank_account_id=body.paid_from_bank_account_id, payment_mode_id=body.payment_mode_id,
        authority_reference=body.authority_reference, receipt_file_id=body.receipt_file_id, notes=body.notes,
        recorded_by=current_user.id, created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    try:
        # Same reason as log_certificate: the flush, not just the commit,
        # is where a constraint violation can actually fire.
        await db.flush()
        for alloc in body.documents_covered:
            db.add(RemittanceAllocation(id=str(uuid.uuid4()), remittance_id=row.id, source_type=alloc.source_type, source_id=alloc.source_id, amount_allocated=alloc.amount))
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return (await _remittances_to_out(db, [row]))[0]


@router.post("/remittances/{remittance_id}/reverse", response_model=RemittanceOut, status_code=status.HTTP_201_CREATED)
async def reverse_remittance(
    remittance_id: str,
    body: RemittanceReverseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.remittances", action="reverse")),
) -> RemittanceOut:
    original = await db.get(Remittance, remittance_id)
    if original is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if original.is_reversal:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="A reversal record cannot itself be reversed")
    already_reversed = (
        await db.execute(select(Remittance).where(Remittance.reverses_remittance_id == remittance_id))
    ).scalar_one_or_none()
    if already_reversed is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This remittance has already been reversed")

    fy = await get_current_financial_year(db)
    number = await allocate_number(db, "RMT", fy.id, fy.label)
    # §3.3: "writes a negative-signed record referencing the original" — every
    # descriptive field (head/period/authority reference/bank/mode) is a plain
    # snapshot of what's being undone, not a new independent transaction;
    # paid_on is today, when the correction was actually made.
    reversal = Remittance(
        id=str(uuid.uuid4()), remittance_number=number, financial_year_id=fy.id, tax_head_id=original.tax_head_id,
        tax_head_name_snapshot=original.tax_head_name_snapshot, remitted_to_snapshot=original.remitted_to_snapshot,
        period_label=original.period_label, period_from=original.period_from, period_to=original.period_to,
        amount_remitted=-original.amount_remitted, paid_on=date.today(), paid_from_bank_account_id=original.paid_from_bank_account_id,
        payment_mode_id=original.payment_mode_id, authority_reference=original.authority_reference, notes=body.reason,
        recorded_by=current_user.id, is_reversal=True, reverses_remittance_id=original.id, reversal_reason=body.reason,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(reversal)
    await db.flush()

    # Mirror the original's allocations with negated amounts against the
    # reversal's own remittance_id — otherwise the covered documents stay
    # permanently "fully allocated" (documents_in_period/by-document would
    # never show them as outstanding again) even though the period itself
    # correctly reopens via _remitted_totals summing in this negative row.
    original_allocations = (
        await db.execute(select(RemittanceAllocation).where(RemittanceAllocation.remittance_id == original.id))
    ).scalars().all()
    for alloc in original_allocations:
        db.add(RemittanceAllocation(
            id=str(uuid.uuid4()), remittance_id=reversal.id, source_type=alloc.source_type,
            source_id=alloc.source_id, amount_allocated=-alloc.amount_allocated,
        ))

    await db.commit()
    await db.refresh(reversal)
    return (await _remittances_to_out(db, [reversal]))[0]


# ==================================================================== CREDITS
_CREDITS_COLUMNS = [
    ColumnSpec("invoice_number", "Invoice Number"),
    ColumnSpec("customer_name", "Customer"),
    ColumnSpec("payment_date", "Payment Date"),
    ColumnSpec("invoice_total", "Invoice Total", align="left"),
    ColumnSpec("amount_received", "Amount Received", align="left"),
    ColumnSpec("withheld", "Withheld", align="left"),
    ColumnSpec("certificate", "Certificate"),
    ColumnSpec("certificate_reference", "Certificate Ref"),
    ColumnSpec("credit_claimed", "Credit Claimed"),
    ColumnSpec("status", "Status"),
]


@router.get("/credits", response_model=None)
async def list_credits(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.credits")),
    status_filter: list[str] | None = Query(None, alias="status"),
    customer_id: str | None = Query(None),
    payment_date_from: date | None = Query(None),
    payment_date_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches Invoice Number, Customer, Certificate Ref"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[CreditRowOut] | Response:
    rows = await credits_engine.build_credit_rows(db)
    # A VOIDED certificate is not this receipt's certificate any more:
    # build_credit_rows already reverts the row to certificate_id=None /
    # AWAITING_CERTIFICATE, but it still carries the voided reference, so the
    # row read "Awaiting Certificate" while displaying a certificate number,
    # and the documented search ("Matches ... Certificate Ref") still matched
    # a voided number. Gate the reference on the same certificate_id the
    # engine kept, so all three uses below — search, export, response — agree.
    def _cert_ref(r) -> str | None:
        return r.certificate_reference if r.certificate_id else None

    if status_filter:
        rows = [r for r in rows if r.status in status_filter]
    if customer_id:
        rows = [r for r in rows if r.customer_id == customer_id]
    if payment_date_from:
        rows = [r for r in rows if r.payment_date >= payment_date_from]
    if payment_date_to:
        rows = [r for r in rows if r.payment_date <= payment_date_to]
    if search:
        needle = search.lower()
        rows = [
            r for r in rows
            if needle in r.invoice_number.lower() or needle in r.customer_name.lower() or needle in (_cert_ref(r) or "").lower()
        ]

    if format:
        export_rows = [
            {
                "invoice_number": r.invoice_number, "customer_name": r.customer_name, "payment_date": r.payment_date,
                "invoice_total": r.invoice_total, "amount_received": r.amount_received, "withheld": r.withheld,
                "certificate": "Yes" if r.certificate_id else "No", "certificate_reference": _cert_ref(r) or "",
                "credit_claimed": "Yes" if r.credit_claimed else "No", "status": r.status,
            }
            for r in rows
        ]
        filters_applied = {"status": status_filter, "customer_id": customer_id, "payment_date_from": payment_date_from, "payment_date_to": payment_date_to, "search": search}
        return await list_export.build_export(format, db, current_user, "Credits — Withheld from Receipts", _CREDITS_COLUMNS, export_rows, filters_applied)

    return [
        CreditRowOut(
            invoice_payment_id=r.invoice_payment_id, invoice_number=r.invoice_number, customer_id=r.customer_id,
            customer_name=r.customer_name, payment_date=r.payment_date, invoice_total=r.invoice_total,
            amount_received=r.amount_received, withheld=r.withheld, tax_head_id=r.tax_head_id, certificate_id=r.certificate_id,
            certificate_reference=_cert_ref(r), credit_claimed=r.credit_claimed, status=r.status,
        )
        for r in rows
    ]


# ================================================================ CERTIFICATES
_CERTIFICATE_COLUMNS = [
    ColumnSpec("certificate_reference", "Certificate Reference"),
    ColumnSpec("customer_name", "Customer"),
    ColumnSpec("certificate_date", "Certificate Date"),
    ColumnSpec("covered_from", "Covered From"),
    ColumnSpec("covered_to", "Covered To"),
    ColumnSpec("tax_head_name_snapshot", "Tax Head"),
    ColumnSpec("amount_on_certificate", "Amount on Certificate", align="left"),
    ColumnSpec("amount_matched", "Amount Matched", align="left"),
    ColumnSpec("variance", "Variance", align="left"),
    ColumnSpec("receipts_covered", "Receipts Covered"),
    ColumnSpec("status", "Status"),
]


async def _customer_names(db: AsyncSession, customer_ids: set[str]) -> dict[str, str]:
    if not customer_ids:
        return {}
    return {c.id: (c.display_name or c.company_name) for c in (await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))).scalars().all()}


async def _certificates_to_out(db: AsyncSession, rows: list[WithholdingCertificate]) -> list[CertificateOut]:
    """Shared by list_certificates/log_certificate/void_certificate so all
    three carry Receipts Covered (§2.7/§2.9) identically, batched.
    """
    if not rows:
        return []
    receipts = (
        await db.execute(select(CertificateReceipt).where(CertificateReceipt.certificate_id.in_([c.id for c in rows])))
    ).scalars().all()
    payment_ids = {r.invoice_payment_id for r in receipts}
    invoice_numbers: dict[str, str] = {}
    if payment_ids:
        for payment_id, invoice_number in (
            await db.execute(select(InvoicePayment.id, Invoice.invoice_number).join(Invoice, Invoice.id == InvoicePayment.invoice_id).where(InvoicePayment.id.in_(payment_ids)))
        ).all():
            invoice_numbers[payment_id] = invoice_number
    receipts_by_cert: dict[str, list] = {}
    for r in receipts:
        receipts_by_cert.setdefault(r.certificate_id, []).append(
            CertificateReceiptOut(invoice_payment_id=r.invoice_payment_id, invoice_number=invoice_numbers.get(r.invoice_payment_id, ""), amount=r.amount)
        )

    out = []
    for c in rows:
        out.append(CertificateOut(
            id=c.id, certificate_reference=c.certificate_reference, customer_id=c.customer_id, certificate_date=c.certificate_date,
            covered_from=c.covered_from, covered_to=c.covered_to, tax_head_id=c.tax_head_id, tax_head_name_snapshot=c.tax_head_name_snapshot,
            amount_on_certificate=c.amount_on_certificate, amount_matched=c.amount_matched, variance=c.variance,
            attachment_file_id=c.attachment_file_id, status=c.status, voided_at=c.voided_at, voided_by=c.voided_by,
            void_reason=c.void_reason, receipts_covered=receipts_by_cert.get(c.id, []), created_at=c.created_at,
        ))
    return out


@router.get("/certificates", response_model=None)
async def list_certificates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.certificates")),
    customer_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    certificate_date_from: date | None = Query(None),
    certificate_date_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches Certificate Reference, Customer"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[CertificateOut] | Response:
    stmt = select(WithholdingCertificate).order_by(WithholdingCertificate.certificate_date)
    if customer_id:
        stmt = stmt.where(WithholdingCertificate.customer_id == customer_id)
    if status_filter:
        stmt = stmt.where(WithholdingCertificate.status.in_(status_filter))
    if certificate_date_from:
        stmt = stmt.where(WithholdingCertificate.certificate_date >= certificate_date_from)
    if certificate_date_to:
        stmt = stmt.where(WithholdingCertificate.certificate_date <= certificate_date_to)
    raw_rows = (await db.execute(stmt)).scalars().all()
    customers = await _customer_names(db, {c.customer_id for c in raw_rows})
    rows = await _certificates_to_out(db, raw_rows)
    if search:
        needle = search.lower()
        raw_by_id = {c.id: c for c in raw_rows}
        rows = [
            r for r in rows
            if needle in r.certificate_reference.lower() or needle in customers.get(raw_by_id[r.id].customer_id, "").lower()
        ]

    if format:
        export_rows = [
            {
                "certificate_reference": c.certificate_reference, "customer_name": customers.get(c.customer_id, ""),
                "certificate_date": c.certificate_date, "covered_from": c.covered_from, "covered_to": c.covered_to,
                "tax_head_name_snapshot": c.tax_head_name_snapshot, "amount_on_certificate": c.amount_on_certificate,
                "amount_matched": c.amount_matched, "variance": c.variance,
                "receipts_covered": "; ".join(f"{r.invoice_number} (₹{r.amount:,.2f})" for r in c.receipts_covered), "status": c.status,
            }
            for c in rows
        ]
        filters_applied = {"customer_id": customer_id, "status": status_filter, "certificate_date_from": certificate_date_from, "certificate_date_to": certificate_date_to, "search": search}
        return await list_export.build_export(format, db, current_user, "Certificates", _CERTIFICATE_COLUMNS, export_rows, filters_applied)

    return rows


@router.post("/certificates", response_model=CertificateOut, status_code=status.HTTP_201_CREATED)
async def log_certificate(
    body: CertificateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.certificates", action="log")),
) -> CertificateOut:
    head = await db.get(TaxHead, body.tax_head_id)
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax head not found")
    customer = await db.get(Customer, body.customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
    if body.certificate_date > date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Certificate Date cannot be in the future")
    if body.covered_to < body.covered_from:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Covered To cannot be before Covered From")
    if body.amount_on_certificate <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Amount on Certificate must be positive")

    payment_ids = [r.invoice_payment_id for r in body.receipts_covered]
    payments = {
        p.id: p for p in (
            await db.execute(select(InvoicePayment).join(Invoice, Invoice.id == InvoicePayment.invoice_id).where(InvoicePayment.id.in_(payment_ids), Invoice.customer_id == body.customer_id))
        ).scalars().all()
    }
    # Already-certified-elsewhere totals, across EVERY existing certificate —
    # found missing by the close-out audit: the only DB guard
    # (ux_certreceipts_cert_payment) is scoped to one certificate, so without
    # this a receipt could be certified in full on two separate certificates
    # and both later independently marked Claimed, doubling the credit taken.
    already_certified: dict[str, Decimal] = {}
    if payment_ids:
        for pid, amt in (
            await db.execute(select(CertificateReceipt.invoice_payment_id, CertificateReceipt.amount).where(CertificateReceipt.invoice_payment_id.in_(payment_ids)))
        ).all():
            already_certified[pid] = already_certified.get(pid, Decimal("0")) + amt

    amount_matched = Decimal("0")
    for r in body.receipts_covered:
        payment = payments.get(r.invoice_payment_id)
        if payment is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Receipt {r.invoice_payment_id} does not belong to this customer")
        remaining = payment.withheld_amount - already_certified.get(r.invoice_payment_id, Decimal("0"))
        if r.amount <= 0 or r.amount > remaining:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Amount for receipt {r.invoice_payment_id} exceeds its remaining un-certified withheld amount")
        amount_matched += r.amount

    row = WithholdingCertificate(
        id=str(uuid.uuid4()), certificate_reference=body.certificate_reference, customer_id=body.customer_id,
        certificate_date=body.certificate_date, covered_from=body.covered_from, covered_to=body.covered_to,
        tax_head_id=head.id, tax_head_name_snapshot=head.tax_name, amount_on_certificate=body.amount_on_certificate,
        amount_matched=amount_matched, attachment_file_id=body.attachment_file_id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    try:
        # The flush (not just the later commit) is where the unique
        # (customer_id, certificate_reference) violation actually fires —
        # it has to be inside the try/except too, or a duplicate reference
        # 500s instead of a clean 409 (found live).
        await db.flush()
        for r in body.receipts_covered:
            db.add(CertificateReceipt(id=str(uuid.uuid4()), certificate_id=row.id, invoice_payment_id=r.invoice_payment_id, amount=r.amount))
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A certificate with this reference already exists for this customer") from exc
    await db.refresh(row)
    return (await _certificates_to_out(db, [row]))[0]


@router.post("/certificates/{certificate_id}/void", response_model=CertificateOut)
async def void_certificate(
    certificate_id: str,
    body: CertificateVoidRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.certificates", action="void")),
) -> CertificateOut:
    cert = await db.get(WithholdingCertificate, certificate_id)
    if cert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if cert.status == "VOIDED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already voided")
    claimed = (await db.execute(select(CreditClaim).where(CreditClaim.certificate_id == certificate_id))).scalar_one_or_none()
    if claimed is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Cannot void a certificate whose credit has already been claimed")

    cert.status = "VOIDED"
    cert.voided_at = datetime.now(timezone.utc)
    cert.voided_by = current_user.id
    cert.void_reason = body.reason
    cert.updated_by = current_user.id
    await db.commit()
    await db.refresh(cert)
    return (await _certificates_to_out(db, [cert]))[0]


@router.post("/certificates/{certificate_id}/claim", response_model=CreditClaimOut, status_code=status.HTTP_201_CREATED)
async def mark_credit_claimed(
    certificate_id: str,
    body: CreditClaimCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("compliance.certificates", action="claim")),
) -> CreditClaim:
    cert = await db.get(WithholdingCertificate, certificate_id)
    if cert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if cert.status != "ACTIVE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only an active certificate can be claimed")
    if body.claim_date > date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Claim Date cannot be in the future")

    # §7.4/§2.9: "Amount Claimable is the certified figure" — the
    # certificate's own amount_on_certificate, never the company's
    # recorded/matched figure, whenever the two differ.
    row = CreditClaim(
        id=str(uuid.uuid4()), certificate_id=certificate_id, amount_claimable=cert.amount_on_certificate,
        claimed_in=body.claimed_in, claim_reference=body.claim_reference, claim_date=body.claim_date, notes=body.notes,
        claimed_by=current_user.id, created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This certificate has already been claimed") from exc
    await db.refresh(row)
    return row
