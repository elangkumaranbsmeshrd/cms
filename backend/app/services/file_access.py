"""Per-file authorization for GET /api/v1/files/{file_id}.

Replaces the bet the download endpoint used to make. Its header comment
argued that a StoredFile id "is only ever discoverable through its own
already-screen-gated parent endpoint", so authenticating the caller was
enough. Nothing enforced that bet, and it does not survive contact with a
UUID that leaked anywhere else (a log line, a shared link, a stale API
response, an id the caller legitimately saw once and kept): a plain Employee
holding a payslip's `pdf_file_id` could download another employee's salary
document, an ID proof, or someone else's expense receipt.

There is no `purpose` column on `stored_files` to key an ACL off — `purpose`
exists only as a multipart Form field in files.py's upload path, used to pick
a MIME/size rule, and is never persisted. What the schema DOES already give
us is the reverse direction: 23 FK columns across 11 model modules point AT
`stored_files.id`. That is the ownership graph, already maintained by every
module that attaches a file, and it is what this module reads.

The rule: you may download a file if you can reach a record that references
it. Each `_Rule` below names one referencing column, the RBAC screen(s) whose
visibility grants the parent record, and how that screen narrows to a person.
Those screens and their scoping are transcribed from the parent routes
themselves, not invented here — so a role that can open the parent record can
still open its file, and one that cannot, cannot.

Three deliberate allowances sit outside the graph, each explicit rather than
accidental:
  * Super Admin keeps broad access (RBAC's own "Full, all records" reach).
  * The uploader can always re-read their own upload. Uploading returns an id
    BEFORE the parent record exists to reference it (upload, then save the
    form); without this, every create-with-attachment flow would break on its
    own preview.
  * `_ORG_WIDE` — files that are genuinely published to the whole org.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import AssetFile, AssetRequest
from app.models.compliance import Remittance, WithholdingCertificate
from app.models.customer import CustomerFile
from app.models.employee import (
    Employee,
    EmployeeDocument,
    OfferLetter,
    TaxDeclaration,
    TaxDeclarationLine,
    TaxDeclarationLineProof,
)
from app.models.finance import CompanyExpense, CreditNote, ExpenseClaim, Invoice, PurchaseBill
from app.models.masters import BankAccount, CompanyDocument, CompanyProfile
from app.models.opportunity import OpportunityFile
from app.models.payroll import Payslip, SalaryCertificateRequest
from app.models.platform import StoredFile, User
from app.models.rbac import Role
from app.models.ticket import Ticket, TicketEntry
from app.rbac.resolver import resolve_permission
from app.services import org_scope


@dataclass(frozen=True)
class _Screen:
    """One screen that can grant a file, and how that screen scopes rows.

    `always_own` is not a stylistic choice — it is required for correctness.
    The "my ..." screens (`expense.my_expenses`, `payroll.my_payslips`,
    `employee.my_assets`, `employee.my_tickets`) are seeded mode='full' for
    EVERY role, and their routes do NOT read that mode: each one hard-filters
    to `org_scope.get_own_employee_id(...)`. Trusting `perms.mode` on those
    four screens would re-open exactly the hole this module closes — every
    employee would pass a 'full' check and read anyone's payslip.

    `unlock_action` mirrors a parent route that waives ownership for holders
    of a named action rather than via mode — currently only Tax Declarations
    (`_guard_own_or_verify` in api/v1/tax_declarations.py: 'verify' unlocks
    reading any employee's declaration, for HR/Accountant/Super Admin).
    """

    key: str
    always_own: bool = False
    unlock_action: str | None = None


@dataclass(frozen=True)
class _Rule:
    """One column that references `stored_files.id`.

    `stmt(file_id)` selects the OWNING EMPLOYEE ID of every record holding
    that file (or the record's own id, when the record type has no per-person
    owner). Existence of any row means "this record type references the
    file"; the values are what an 'own'/'team' scope is matched against.
    """

    label: str
    screens: tuple[_Screen, ...]
    stmt: Callable[[str], Select]
    owned: bool


# Files published to the entire organisation by design, listed one by one so
# this is a decision rather than a side effect. Company branding is embedded
# in every generated PDF (invoice, payslip, offer letter) and rendered in the
# app shell, so any authenticated user already receives these bytes; gating
# them would break every PDF and every logged-in page. Employee photos are the
# avatar shown beside a person's name across the Directory, Announcements,
# ticket authorship and project boards — org-wide readable by construction.
# NOTE for review: the avatar entry is the one genuinely debatable member of
# this set. It is a face photo, not an ID proof (`employee_documents` is a
# separate rule below and stays strictly own/HR-scoped), and it is included to
# avoid breaking avatars everywhere. Drop `Employee.photo_file_id` from this
# tuple to make photos follow `employee.directory` scope instead.
_ORG_WIDE: tuple[Callable[[str], Select], ...] = (
    lambda fid: select(CompanyProfile.id).where(CompanyProfile.logo_file_id == fid),
    lambda fid: select(CompanyProfile.id).where(CompanyProfile.letterhead_file_id == fid),
    lambda fid: select(CompanyProfile.id).where(CompanyProfile.invoice_template_file_id == fid),
    lambda fid: select(Employee.id).where(Employee.photo_file_id == fid),
)


_RULES: tuple[_Rule, ...] = (
    # ---- Employee-owned records: the sensitive core this module exists for.
    _Rule(
        "employee_document",
        # employee.documents is seeded 'own' for Manager/Accountant/Employee
        # and 'full' for HR/Super Admin — exactly the split
        # api/v1/employee_documents.py enforces on the parent list.
        (_Screen("employee.documents"),),
        lambda fid: select(EmployeeDocument.employee_id).where(EmployeeDocument.file_id == fid),
        owned=True,
    ),
    _Rule(
        "expense_receipt",
        (
            _Screen("expense.my_expenses", always_own=True),
            _Screen("expense.all_expenses"),
            _Screen("expense.approvals"),
        ),
        lambda fid: select(ExpenseClaim.employee_id).where(ExpenseClaim.receipt_stored_file_id == fid),
        owned=True,
    ),
    _Rule(
        "payslip_pdf",
        (_Screen("payroll.my_payslips", always_own=True), _Screen("payroll.payslips_admin")),
        lambda fid: select(Payslip.employee_id).where(Payslip.pdf_file_id == fid),
        owned=True,
    ),
    _Rule(
        "salary_certificate_pdf",
        (_Screen("payroll.my_payslips", always_own=True), _Screen("payroll.payslips_admin")),
        lambda fid: select(SalaryCertificateRequest.employee_id).where(SalaryCertificateRequest.pdf_file_id == fid),
        owned=True,
    ),
    _Rule(
        "offer_letter_pdf",
        (_Screen("employee.offer_letters"),),
        lambda fid: select(OfferLetter.employee_id).where(OfferLetter.pdf_file_id == fid),
        owned=True,
    ),
    _Rule(
        "tax_declaration_proof",
        (_Screen("employee.tax_declarations", always_own=True, unlock_action="verify"),),
        lambda fid: (
            select(TaxDeclaration.employee_id)
            .join(TaxDeclarationLine, TaxDeclarationLine.tax_declaration_id == TaxDeclaration.id)
            .join(TaxDeclarationLineProof, TaxDeclarationLineProof.tax_declaration_line_id == TaxDeclarationLine.id)
            .where(TaxDeclarationLineProof.file_id == fid)
        ),
        owned=True,
    ),
    _Rule(
        "asset_request_photo",
        (_Screen("employee.my_assets", always_own=True), _Screen("asset.requests")),
        lambda fid: select(AssetRequest.employee_id).where(AssetRequest.photo_stored_file_id == fid),
        owned=True,
    ),
    _Rule(
        "ticket_attachment",
        # api/v1/tickets.py scopes 'own' as Ticket.assigned_to == own employee
        # id (both the main list and /employees/me/tickets).
        (_Screen("employee.my_tickets", always_own=True), _Screen("ticket.list")),
        lambda fid: (
            select(Ticket.assigned_to)
            .join(TicketEntry, TicketEntry.ticket_id == Ticket.id)
            .where(TicketEntry.attachment_stored_file_id == fid)
        ),
        owned=True,
    ),
    # ---- Company-wide records: no per-person owner. The parent routes apply
    # screen visibility only, so these do too.
    _Rule(
        "purchase_bill_attachment",
        (_Screen("purchase_bill.list"),),
        lambda fid: select(PurchaseBill.id).where(PurchaseBill.attachment_stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "invoice_pdf",
        (_Screen("invoice.list"), _Screen("invoice.dashboard")),
        lambda fid: select(Invoice.id).where(Invoice.pdf_stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "credit_note_pdf",
        (_Screen("credit_note.list"),),
        lambda fid: select(CreditNote.id).where(CreditNote.pdf_stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "company_expense_bill",
        (_Screen("expense.company"),),
        lambda fid: select(CompanyExpense.id).where(CompanyExpense.bill_stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "remittance_receipt",
        (_Screen("compliance.remittances"),),
        lambda fid: select(Remittance.id).where(Remittance.receipt_file_id == fid),
        owned=False,
    ),
    _Rule(
        "withholding_certificate_attachment",
        (_Screen("compliance.certificates"),),
        lambda fid: select(WithholdingCertificate.id).where(WithholdingCertificate.attachment_file_id == fid),
        owned=False,
    ),
    _Rule(
        "asset_file",
        (_Screen("asset.directory"),),
        lambda fid: select(AssetFile.id).where(AssetFile.stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "customer_file",
        (_Screen("customer.directory"),),
        lambda fid: select(CustomerFile.id).where(CustomerFile.stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "opportunity_file",
        (_Screen("opportunity.pipeline"),),
        lambda fid: select(OpportunityFile.id).where(OpportunityFile.stored_file_id == fid),
        owned=False,
    ),
    _Rule(
        "bank_upi_qr",
        (_Screen("masters.bank_accounts"),),
        lambda fid: select(BankAccount.id).where(BankAccount.upi_qr_file_id == fid),
        owned=False,
    ),
    _Rule(
        "company_document",
        (_Screen("masters.company_profile"),),
        lambda fid: select(CompanyDocument.id).where(CompanyDocument.file_id == fid),
        owned=False,
    ),
)


class _ScopeCache:
    """Resolves the caller's own employee id / direct reports at most once per
    download, however many rules end up asking for them."""

    def __init__(self, db: AsyncSession, user: User) -> None:
        self._db = db
        self._user = user
        self._own_id: str | None = None
        self._own_loaded = False
        self._team: list[str] | None = None

    async def own_employee_id(self) -> str | None:
        if not self._own_loaded:
            self._own_id = await org_scope.get_own_employee_id(self._db, self._user)
            self._own_loaded = True
        return self._own_id

    async def team_employee_ids(self) -> list[str]:
        if self._team is None:
            own_id = await self.own_employee_id()
            self._team = await org_scope.get_direct_report_employee_ids(self._db, own_id) if own_id else []
        return self._team


async def _is_super_admin(db: AsyncSession, user: User) -> bool:
    role = await db.get(Role, user.role_id)
    return role is not None and role.code == "SUPER_ADMIN"


async def _matches_any(db: AsyncSession, builders: tuple[Callable[[str], Select], ...], file_id: str) -> bool:
    for build in builders:
        if (await db.execute(build(file_id).limit(1))).first() is not None:
            return True
    return False


async def _rule_grants(db: AsyncSession, user: User, rule: _Rule, file_id: str, scope: _ScopeCache) -> bool:
    rows = (await db.execute(rule.stmt(file_id))).all()
    if not rows:
        return False  # no record of this kind references the file — rule is silent
    # Kept separate from `rows`: a nullable owner column (an unassigned
    # ticket) still means the record EXISTS, it just has nobody to match an
    # 'own' scope against. Collapsing the two would hide such a record from
    # the 'full'-scoped roles that can legitimately open it.
    owner_ids = {row[0] for row in rows if row[0] is not None}

    for screen in rule.screens:
        perms = await resolve_permission(db, user, screen.key)
        if not perms.visible:
            continue
        if not rule.owned:
            return True
        if screen.unlock_action is not None and perms.can(screen.unlock_action):
            return True
        mode = "own" if screen.always_own else perms.mode
        if mode in ("full", "view"):
            return True
        own_id = await scope.own_employee_id()
        if own_id is None:
            continue
        if mode == "own":
            if own_id in owner_ids:
                return True
        elif mode in ("team", "view_team"):
            if owner_ids & (set(await scope.team_employee_ids()) | {own_id}):
                return True
    return False


async def assert_can_download(db: AsyncSession, user: User, stored_file: StoredFile) -> None:
    """Raises 403 unless `user` can reach `stored_file` through a record they
    are allowed to see. Returns None when access is granted.

    Deliberately 403 and not 404: by the time this is called the row has been
    loaded, and the codebase's own precedent for "the record exists but your
    scope does not cover it" is 403 (org_scope.assert_employee_in_scope).
    404 stays reserved for a file id that does not exist at all.
    """
    if await _is_super_admin(db, user):
        return
    if stored_file.uploaded_by is not None and stored_file.uploaded_by == user.id:
        return
    if await _matches_any(db, _ORG_WIDE, stored_file.id):
        return

    scope = _ScopeCache(db, user)
    for rule in _RULES:
        if await _rule_grants(db, user, rule, stored_file.id, scope):
            return

    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You do not have access to this file")
