"""Invoice (11-invoice-module.md) — Dashboard (§2.1), List (§2.2), New/Edit
(§2.3), Record Payment (§2.4). The Paid lock (§2.3, verbatim: "once an
invoice reaches Status = Paid, it locks... nothing about a Paid invoice can
be edited from this screen again") is this phase's literal acceptance gate —
enforced here at the API layer (checked before every mutation) AND backed by
`trg_invoices_no_unlock` in the DB as defense in depth, same split as every
other lock this project has built.
"""

import logging
import uuid
from datetime import date as date_type, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.services import fy_lock
from app.models.customer import Customer
from app.models.finance import Invoice, InvoiceLineItem, InvoicePayment, InvoiceTaxLine
from app.models.masters import BankAccount, HsnSacCode, PaymentMode, TaxHead
from app.models.platform import User
from app.models.project import Project
from app.models.rbac import FeatureToggle, Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet, resolve_permission
from app.schemas.finance import InvoiceCreate, InvoiceOut, InvoicePaymentCreate, InvoicePaymentOut, InvoicePaymentReverse
from app.services import list_export, org_scope, pdf_engine, tax_engine
from app.services.finance_engine import ageing_bucket, apply_paid_confirmation_gate, resolve_invoice_status_after_payment
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec
from app.services.tax_head_lookup import build_tax_head_snapshot, validate_head_usable

_LIST_COLUMNS = [
    ColumnSpec("invoice_number", "Invoice Number"),
    ColumnSpec("customer", "Customer"),
    ColumnSpec("invoice_date", "Invoice Date"),
    ColumnSpec("due_date", "Due Date"),
    ColumnSpec("status", "Status"),
    ColumnSpec("subtotal", "Subtotal", align="left"),
    ColumnSpec("tax_amount", "Tax", align="left"),
    ColumnSpec("grand_total", "Grand Total", align="left"),
    ColumnSpec("amount_received", "Received", align="left"),
    ColumnSpec("balance_due", "Balance Due", align="left"),
]

router = APIRouter(prefix="/invoices", tags=["invoice"])
SCREEN = "invoice.list"
_TAX_SCOPES = ("SALES_BILLING", "SALES_AND_PURCHASE")
_WITHHOLDING_SCOPES = ("WITHHOLDING_AT_SOURCE",)


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _manager_led_project_ids(db: AsyncSession, current_user: User) -> set[str]:
    """§6.2 "Allow Manager Read-Only Access to Their Projects' Invoices" —
    deliberately Project LEAD only (project_lead_id), the same narrower-than
    -team-member reading project.py's own "Restrict Manager to Only Projects
    They Manage" toggle uses for the identical phrase ("projects they
    manage"/"their projects"), not Lead-or-Member.
    """
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return set()
    ids = (await db.execute(select(Project.id).where(Project.project_lead_id == own_id))).scalars().all()
    return set(ids)


async def _resolve_invoice_perms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_preview_role: str | None = Header(None),
) -> PermissionSet:
    """Same resolution require_screen(SCREEN) does (preview-role header
    included), but never raises on an invisible screen — list_invoices/
    get_invoice/download_invoice_pdf need the resolved PermissionSet even
    for Manager (mode='none') to decide whether §6.2's "Allow Manager
    Read-Only Access to Their Projects' Invoices" bypass applies.
    require_screen itself 404s before the route body ever runs, which would
    make that bypass unreachable — same reasoning as projects.py's/
    customers.py's/opportunities.py's own _resolve_*_perms helpers. Never
    used on create/edit/send/record_payment/confirm-paid/reverse — the
    toggle is explicit that Manager gets view only, "not edit or record
    payments on."
    """
    preview_role_id: str | None = None
    if x_preview_role:
        real_role = await db.get(Role, current_user.role_id)
        if real_role and real_role.code == "SUPER_ADMIN":
            preview_role_row = (await db.execute(select(Role).where(Role.code == x_preview_role))).scalar_one_or_none()
            if preview_role_row:
                preview_role_id = preview_role_row.id
    return await resolve_permission(db, current_user, SCREEN, preview_role_id=preview_role_id)


async def _load_invoice_out(db: AsyncSession, invoice: Invoice) -> InvoiceOut:
    lines = (await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id).order_by(InvoiceLineItem.sequence))).scalars().all()
    tax_lines = (await db.execute(select(InvoiceTaxLine).where(InvoiceTaxLine.invoice_id == invoice.id).order_by(InvoiceTaxLine.sequence))).scalars().all()
    out = InvoiceOut.model_validate(invoice)
    out.line_items = list(lines)
    out.tax_lines = list(tax_lines)
    return out


async def _invoice_line_items(db: AsyncSession, invoice_ids: set[str]) -> dict[str, list[InvoiceLineItem]]:
    """Batch line-item lookup for the List — one `.in_()` query grouped in
    Python, the same shape as expenses.py's _employee_names/_vendor_names.
    Ordered by (invoice_id, sequence) so each invoice's own slice comes back
    in exactly the sequence order _load_invoice_out's per-invoice query
    produced; the leading invoice_id only groups, it never reorders within.
    The trailing id is a tiebreak that cannot fire on data this app writes —
    sequence is allocated 1..n per invoice — but a batched query is the
    wrong place to leave an arbitrary order sitting, so it is pinned to the
    same id order ix_invlines_invoice's own entries carry.
    """
    if not invoice_ids:
        return {}
    rows = (
        await db.execute(
            select(InvoiceLineItem).where(InvoiceLineItem.invoice_id.in_(invoice_ids))
            .order_by(InvoiceLineItem.invoice_id, InvoiceLineItem.sequence, InvoiceLineItem.id)
        )
    ).scalars().all()
    grouped: dict[str, list[InvoiceLineItem]] = {}
    for row in rows:
        grouped.setdefault(row.invoice_id, []).append(row)
    return grouped


async def _invoice_tax_lines(db: AsyncSession, invoice_ids: set[str]) -> dict[str, list[InvoiceTaxLine]]:
    if not invoice_ids:
        return {}
    rows = (
        await db.execute(
            select(InvoiceTaxLine).where(InvoiceTaxLine.invoice_id.in_(invoice_ids))
            .order_by(InvoiceTaxLine.invoice_id, InvoiceTaxLine.sequence, InvoiceTaxLine.id)
        )
    ).scalars().all()
    grouped: dict[str, list[InvoiceTaxLine]] = {}
    for row in rows:
        grouped.setdefault(row.invoice_id, []).append(row)
    return grouped


async def _load_invoice_outs(db: AsyncSession, invoices: list[Invoice]) -> list[InvoiceOut]:
    """List counterpart to _load_invoice_out: 2 queries in TOTAL rather than
    2 per invoice. Same output, row for row — an invoice with no lines/no tax
    lines still gets the empty list the per-invoice query returned for it.
    """
    invoice_ids = {invoice.id for invoice in invoices}
    lines_by_invoice = await _invoice_line_items(db, invoice_ids)
    tax_lines_by_invoice = await _invoice_tax_lines(db, invoice_ids)
    outs = []
    for invoice in invoices:
        out = InvoiceOut.model_validate(invoice)
        out.line_items = list(lines_by_invoice.get(invoice.id, ()))
        out.tax_lines = list(tax_lines_by_invoice.get(invoice.id, ()))
        outs.append(out)
    return outs


async def _compute_tax(db: AsyncSession, tax_head_id: str | None, tax_amount_override: Decimal | None, subtotal: Decimal, as_of: date_type) -> tuple[Decimal, list[dict]]:
    """§2.3, verbatim: "Tax Amount = Subtotal x the selected head's
    calculation... If no billing tax is configured, hide the Tax dropdown
    entirely and set Grand Total = Subtotal — not a zero-rate placeholder."
    Unlike Purchase Bill, Invoice has no documented "type the amount
    directly with no head" path — an override with no head is rejected
    rather than silently accepted, closing the gap the Phase 4 audit found.
    Shared by create and update so the two can never drift.
    """
    if tax_head_id is None:
        if tax_amount_override is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Tax Amount cannot be set without a Tax head")
        return Decimal("0"), []
    head = await db.get(TaxHead, tax_head_id)
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax head not found")
    block_reason = await validate_head_usable(db, head, _TAX_SCOPES, as_of)
    if block_reason is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
    snapshot = await build_tax_head_snapshot(db, head)
    result = tax_engine.calculate_tax(snapshot, subtotal)
    tax_amount = tax_amount_override if tax_amount_override is not None else result.computed_amount
    tax_lines = [
        {
            "sequence": seq, "tax_head_id": head.id, "head_name_snapshot": head.tax_name, "print_label_snapshot": head.print_label or head.tax_name,
            "scope_snapshot": head.scope, "tax_type_snapshot": head.tax_type, "rate_snapshot": head.rate_pct,
            "cgst_rate_snapshot": head.cgst_rate_pct, "sgst_rate_snapshot": head.sgst_rate_pct, "fixed_amount_snapshot": head.fixed_amount,
            "computed_base": subtotal, "computed_amount": comp.amount, "component_name_snapshot": comp.component_name if result.components else None,
        }
        for seq, comp in enumerate(result.components or [tax_engine.ComponentAmount(head.tax_name, tax_amount)], start=1)
    ]
    return tax_amount, tax_lines


# =============================================================== DASHBOARD
@router.get("/dashboard")
async def invoice_dashboard(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("invoice.dashboard")),
) -> dict:
    from app.models.employee import Employee
    from app.models.finance import CompanyExpense, ExpenseClaim
    from app.models.ticket import Ticket

    # §2.1's own table: "Active Employees" and "Total Expenses" were
    # computable as of Phase 4 (Employee/Expense already existed). "Active
    # Projects"/"Open Tickets" were the genuine forward dependency at the
    # time — Project and Ticket now both exist as of Phase 5, so both are
    # wired here too (found stale by the Phase 6 research pass).
    active_employees = (
        await db.execute(select(Employee.id).where(Employee.employment_status == "ACTIVE"))
    ).all()
    active_projects = (await db.execute(select(Project.id).where(Project.status != "COMPLETED"))).all()
    open_tickets = (await db.execute(select(Ticket.id).where(Ticket.status.in_(("OPEN", "IN_PROGRESS"))))).all()

    # §6.2 "Show Non-Financial Dashboard Widgets to HR" — HR's own mode on
    # this screen only ever widens via that toggle's MODE_TOGGLE_GATES entry
    # (rbac/toggles.py), so reaching this point at all already means either
    # the toggle is on (HR) or the caller is Accountant/Super Admin. HR gets
    # exactly the 3 non-financial widgets named in §6.2 — "never the revenue
    # figures" — Total Expenses counts too, it's spend, not headcount/ops.
    if perms.role_code == "HR":
        return {
            "total_invoiced": None, "total_received": None, "outstanding": None,
            "overdue_count": None, "overdue_invoices": [], "recent_payments": [],
            "total_expenses": None,
            "active_employees": len(active_employees), "active_projects": len(active_projects), "open_tickets": len(open_tickets),
        }

    rows = (await db.execute(select(Invoice))).scalars().all()
    total_invoiced = sum((r.grand_total for r in rows), Decimal("0"))
    total_received = sum((r.amount_received for r in rows), Decimal("0"))
    outstanding = sum((r.balance_due for r in rows), Decimal("0"))
    today = date_type.today()
    # PEND_PAID (§6.2's second-approval gate) is settled in substance — see
    # list_invoices' own identical reasoning — so it's excluded from Overdue
    # here the same way PAID already is.
    overdue = [r for r in rows if r.status not in ("PAID", "PEND_PAID") and r.due_date is not None and r.due_date < today]
    # PaymentMode is LEFT joined, not inner: the widget's job is to show the
    # last 10 payments, and a payment whose mode row has since been deleted
    # must still appear (with an unresolved name) rather than vanish from
    # the dashboard entirely.
    recent_payments = (
        await db.execute(
            select(InvoicePayment, Invoice.customer_name_snapshot, PaymentMode.name).join(Invoice, Invoice.id == InvoicePayment.invoice_id)
            .outerjoin(PaymentMode, PaymentMode.id == InvoicePayment.payment_mode_id)
            .where(InvoicePayment.status == "RECORDED").order_by(InvoicePayment.payment_date.desc()).limit(10)
        )
    ).all()

    claim_spend = (
        await db.execute(
            select(ExpenseClaim.amount).where(ExpenseClaim.claim_type == "REIMBURSABLE", ExpenseClaim.status.in_(("APPROVED", "REIMBURSED")))
        )
    ).scalars().all()
    company_spend = (await db.execute(select(CompanyExpense.amount).where(CompanyExpense.status == "PAID"))).scalars().all()
    total_expenses = sum(claim_spend, Decimal("0")) + sum(company_spend, Decimal("0"))

    return {
        "total_invoiced": total_invoiced, "total_received": total_received, "outstanding": outstanding,
        "overdue_count": len(overdue),
        "overdue_invoices": [{"invoice_number": r.invoice_number, "customer": r.customer_name_snapshot, "amount": r.balance_due, "due_date": r.due_date} for r in overdue],
        # "mode" is a display field alongside the customer name and the
        # formatted amount — it carries the payment mode's NAME ("Cheque"/
        # "NEFT"), never the raw payment_mode_id it used to leak.
        "recent_payments": [
            {"customer": customer_name, "amount": p.amount_received, "mode": mode_name, "payment_mode_id": p.payment_mode_id, "date": p.payment_date}
            for p, customer_name, mode_name in recent_payments
        ],
        "active_employees": len(active_employees),
        "total_expenses": total_expenses,
        "active_projects": len(active_projects),
        "open_tickets": len(open_tickets),
    }


# =================================================================== LIST
@router.get("", response_model=None)
async def list_invoices(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_invoice_perms),
    customer_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    financial_year_id: str | None = Query(None),
    invoice_date_from: date_type | None = Query(None),
    invoice_date_to: date_type | None = Query(None),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    grand_total_min: Decimal | None = Query(None),
    grand_total_max: Decimal | None = Query(None),
    balance_due_min: Decimal | None = Query(None),
    balance_due_max: Decimal | None = Query(None),
    service_category_id: str | None = Query(None),
    tax_head_id: str | None = Query(None, description="Tax head applied to the invoice"),
    payment_mode_id: str | None = Query(None, description="Any payment recorded against the invoice used this mode"),
    created_by: str | None = Query(None, description="Super Admin only"),
    last_modified_by: str | None = Query(None, description="Super Admin only"),
    overdue: bool | None = Query(None),
    ageing: str | None = Query(None),
    search: str | None = Query(None, description="Matches Invoice Number, Customer Name, Reference"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[InvoiceOut] | Response:
    # §6.2 "Allow Manager Read-Only Access to Their Projects' Invoices" —
    # OFF by default (Manager's seeded mode stays 'none'); ON, a Manager
    # sees exactly the invoices tied to projects they lead — never a wider
    # grant, and never through the edit/send/record_payment/confirm-paid/
    # reverse actions, which all stay gated on the strict require_screen
    # dependency below, untouched by this bypass.
    manager_bypass_project_ids: set[str] | None = None
    if not perms.visible:
        if perms.role_code == "MANAGER" and await _toggle_enabled(db, "Allow Manager Read-Only Access to Their Projects' Invoices"):
            manager_bypass_project_ids = await _manager_led_project_ids(db, current_user)
        else:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    stmt = select(Invoice)
    if manager_bypass_project_ids is not None:
        stmt = stmt.where(Invoice.project_id.in_(manager_bypass_project_ids)) if manager_bypass_project_ids else stmt.where(Invoice.id.is_(None))
    if customer_id:
        stmt = stmt.where(Invoice.customer_id == customer_id)
    if status_filter:
        stmt = stmt.where(Invoice.status.in_(status_filter))
    if financial_year_id:
        stmt = stmt.where(Invoice.financial_year_id == financial_year_id)
    if invoice_date_from:
        stmt = stmt.where(Invoice.invoice_date >= invoice_date_from)
    if invoice_date_to:
        stmt = stmt.where(Invoice.invoice_date <= invoice_date_to)
    if due_date_from:
        stmt = stmt.where(Invoice.due_date >= due_date_from)
    if due_date_to:
        stmt = stmt.where(Invoice.due_date <= due_date_to)
    if grand_total_min is not None:
        stmt = stmt.where(Invoice.grand_total >= grand_total_min)
    if grand_total_max is not None:
        stmt = stmt.where(Invoice.grand_total <= grand_total_max)
    if balance_due_min is not None:
        stmt = stmt.where(Invoice.balance_due >= balance_due_min)
    if balance_due_max is not None:
        stmt = stmt.where(Invoice.balance_due <= balance_due_max)
    if service_category_id:
        stmt = stmt.where(Invoice.service_category_id == service_category_id)
    if tax_head_id:
        stmt = stmt.where(Invoice.tax_head_id == tax_head_id)
    if payment_mode_id:
        paid_invoice_ids = (await db.execute(select(InvoicePayment.invoice_id).where(InvoicePayment.payment_mode_id == payment_mode_id))).scalars().all()
        stmt = stmt.where(Invoice.id.in_(set(paid_invoice_ids))) if paid_invoice_ids else stmt.where(Invoice.id.is_(None))
    if created_by:
        stmt = stmt.where(Invoice.created_by == created_by)
    if last_modified_by:
        stmt = stmt.where(Invoice.updated_by == last_modified_by)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(Invoice.invoice_number.ilike(pattern) | Invoice.customer_name_snapshot.ilike(pattern) | Invoice.reference.ilike(pattern))
    rows = (await db.execute(stmt.order_by(Invoice.invoice_date.desc()))).scalars().all()

    today = date_type.today()
    filtered = []
    for inv in rows:
        # PEND_PAID (§6.2's second-approval gate) is settled in substance —
        # the balance is at zero, only Super Admin's confirmation is
        # pending — so it ages out of Overdue/the ageing buckets exactly
        # like PAID does, not while it sits waiting for a rubber stamp.
        bucket = ageing_bucket(inv.due_date, today, inv.status in ("PAID", "PEND_PAID"))
        if overdue is not None:
            is_overdue = bucket is not None and bucket.label != "Current"
            if overdue != is_overdue:
                continue
        if ageing is not None and (bucket is None or bucket.label != ageing):
            continue
        filtered.append(inv)

    if format:
        # RBAC §2.2(f): export exactly the filtered/searched set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        export_rows = [
            {
                "invoice_number": inv.invoice_number, "customer": inv.customer_name_snapshot, "invoice_date": inv.invoice_date,
                "due_date": inv.due_date, "status": inv.status, "subtotal": inv.subtotal, "tax_amount": inv.tax_amount,
                "grand_total": inv.grand_total, "amount_received": inv.amount_received, "balance_due": inv.balance_due,
            }
            for inv in filtered
        ]
        filters_applied = {
            "customer_id": customer_id, "status": status_filter, "financial_year_id": financial_year_id,
            "invoice_date_from": invoice_date_from, "invoice_date_to": invoice_date_to,
            "due_date_from": due_date_from, "due_date_to": due_date_to,
            "grand_total_min": grand_total_min, "grand_total_max": grand_total_max,
            "balance_due_min": balance_due_min, "balance_due_max": balance_due_max,
            "service_category_id": service_category_id, "tax_head_id": tax_head_id, "payment_mode_id": payment_mode_id,
            "created_by": created_by, "last_modified_by": last_modified_by,
            "overdue": overdue, "ageing": ageing, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Invoices", _LIST_COLUMNS, export_rows, filters_applied)

    return await _load_invoice_outs(db, filtered)


@router.post("", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    body: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> InvoiceOut:
    if not body.line_items:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="An invoice needs at least one line item")
    if body.invoice_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invoice Date cannot be in the future")
    customer = await db.get(Customer, body.customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
    if body.project_id is not None:
        project = await db.get(Project, body.project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
        if project.customer_id != body.customer_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project does not belong to this Customer")
    fy = await get_current_financial_year(db)
    # THE LOCK RULE covers ADDING too, not just editing: "nothing dated inside
    # it can be added, edited or deleted by anyone". Guarded before the number
    # is allocated, so a refused create does not burn a running number.
    await fy_lock.assert_fy_not_locked(db, fy.id, what="A new invoice")
    number = await allocate_number(db, "INV", fy.id, fy.label)

    subtotal = sum((li.quantity * li.rate for li in body.line_items), Decimal("0"))
    tax_amount, tax_lines = await _compute_tax(db, body.tax_head_id, body.tax_amount_override, subtotal, body.invoice_date)

    invoice = Invoice(
        id=str(uuid.uuid4()), invoice_number=number, financial_year_id=fy.id, customer_id=customer.id, project_id=body.project_id,
        invoice_date=body.invoice_date, due_date=body.due_date, reference=body.reference, notes=body.notes,
        customer_name_snapshot=customer.company_name, customer_address_snapshot=customer.address, customer_gstin_snapshot=customer.gstin,
        service_category_id=body.service_category_id, bank_account_id=body.bank_account_id, subtotal=subtotal,
        tax_head_id=body.tax_head_id, tax_amount=tax_amount, created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(invoice)
    await db.flush()

    for seq, li in enumerate(body.line_items, start=1):
        hsn_snapshot = None
        if li.hsn_code_id is not None:
            hsn = await db.get(HsnSacCode, li.hsn_code_id)
            hsn_snapshot = hsn.code if hsn else None
        db.add(InvoiceLineItem(
            id=str(uuid.uuid4()), invoice_id=invoice.id, sequence=seq, description=li.description, hsn_code_id=li.hsn_code_id,
            hsn_code_snapshot=hsn_snapshot, quantity=li.quantity, rate=li.rate, created_by=current_user.id, updated_by=current_user.id,
        ))
    for line in tax_lines:
        db.add(InvoiceTaxLine(id=str(uuid.uuid4()), invoice_id=invoice.id, created_by=current_user.id, updated_by=current_user.id, **line))

    # Customer rollup — plain, API-written (0005_finance.py's docstring).
    customer.total_invoiced += (subtotal + tax_amount)
    if body.bank_account_id is not None:
        customer.collected_into_bank_account_id = body.bank_account_id
    customer.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(invoice)
    return await _load_invoice_out(db, invoice)


async def _get_invoice_scoped(db: AsyncSession, current_user: User, perms: PermissionSet, invoice_id: str) -> Invoice:
    """Shared choke point for "may this caller see THIS invoice" — mirrors
    list_invoices' own §6.2 Manager-bypass check so a Manager who can see
    the list (their led projects' invoices) can also open one, and nobody
    else with an invisible screen and no bypass gets past a 404.
    """
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not perms.visible:
        allowed = False
        if perms.role_code == "MANAGER" and await _toggle_enabled(db, "Allow Manager Read-Only Access to Their Projects' Invoices"):
            allowed = invoice.project_id is not None and invoice.project_id in await _manager_led_project_ids(db, current_user)
        if not allowed:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
    return invoice


@router.get("/{invoice_id}", response_model=InvoiceOut)
async def get_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_invoice_perms),
) -> InvoiceOut:
    invoice = await _get_invoice_scoped(db, current_user, perms, invoice_id)
    return await _load_invoice_out(db, invoice)


@router.get("/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_invoice_perms),
) -> Response:
    """§2.3: "'Download' button: produces a PDF using the invoice template
    set in Company Profile" — Company Profile only stores which stored file
    is the template (`invoice_template_file_id`), not a layout engine, so
    "using the template" is read as "using the same letterhead treatment"
    (matches the identical language already resolved for Credit Note/
    Payslip/Salary Certificate — see the OFFICIAL DOCUMENT RULE, Appendix B).
    """
    invoice = await _get_invoice_scoped(db, current_user, perms, invoice_id)
    lines = (await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id).order_by(InvoiceLineItem.sequence))).scalars().all()
    tax_lines = (await db.execute(select(InvoiceTaxLine).where(InvoiceTaxLine.invoice_id == invoice.id).order_by(InvoiceTaxLine.sequence))).scalars().all()
    company, logo = await pdf_engine.company_logo_bytes(db)

    line_columns = [
        ColumnSpec("description", "Description"),
        ColumnSpec("hsn_code_snapshot", "HSN/SAC"),
        ColumnSpec("quantity", "Qty", align="right"),
        ColumnSpec("rate", "Rate", align="left"),
        ColumnSpec("line_total", "Line Total", align="left"),
    ]
    line_rows = [{"description": li.description, "hsn_code_snapshot": li.hsn_code_snapshot, "quantity": li.quantity, "rate": li.rate, "line_total": li.line_total} for li in lines]
    subtotal_line = f"Subtotal: ₹{invoice.subtotal:,.2f}"
    # 11-invoice-module.md, Tax Amount: "If the head has Split Components,
    # the invoice prints one line per component under its own name, and
    # this figure is their total." — a single tax line still prints as one
    # combined "Tax: ₹X" line on the subtotal row.
    tax_header_lines: list[str] = []
    if len(tax_lines) > 1:
        for tl in tax_lines:
            label = tl.print_label_snapshot or tl.head_name_snapshot or "Tax"
            # component_name_snapshot ("CGST"/"SGST") is what actually
            # distinguishes each split row — print_label_snapshot alone is
            # identical for every component of the same tax head.
            if tl.component_name_snapshot:
                label = f"{label} ({tl.component_name_snapshot})"
            tax_header_lines.append(f"{label}: ₹{tl.computed_amount:,.2f}")
    elif tax_lines:
        subtotal_line += f" | Tax: ₹{invoice.tax_amount:,.2f}"

    bank_lines: list[str] = []
    if invoice.bank_account_id is not None:
        bank_account = await db.get(BankAccount, invoice.bank_account_id)
        if bank_account is not None:
            bank_lines.append(f"Pay Into: {bank_account.bank_name} — {bank_account.account_number}")

    header_lines = [
        f"Invoice: {invoice.invoice_number}", f"Bill To: {invoice.customer_name_snapshot}",
        f"Invoice Date: {invoice.invoice_date} | Due Date: {invoice.due_date or '—'}",
        subtotal_line,
        *tax_header_lines,
        f"Grand Total: ₹{invoice.grand_total:,.2f} | Balance Due: ₹{invoice.balance_due:,.2f} | Status: {invoice.status}",
        *bank_lines,
    ]
    content = pdf_engine.render_table_pdf(f"Invoice {invoice.invoice_number}", line_columns, line_rows, header_lines, company, logo)
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{invoice.invoice_number}.pdf"'})


@router.put("/{invoice_id}", response_model=InvoiceOut)
async def update_invoice(
    invoice_id: str,
    body: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> InvoiceOut:
    if not body.line_items:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="An invoice needs at least one line item")
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if invoice.is_locked:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="A Paid invoice is locked — corrections go through a Credit Note, never a direct edit")
    # Invoice.is_locked is the PAID lock, a different rule from THE LOCK RULE.
    # This route checked the first and never the second, so an invoice inside a
    # frozen Financial Year was editable as long as it was unpaid.
    await fy_lock.assert_fy_not_locked(db, invoice.financial_year_id, what="This invoice")
    if body.customer_id != invoice.customer_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Customer cannot be changed after creation")
    # project_id gets the same "locked after creation" treatment as
    # customer_id — it's an internal field the create-from-project prefill
    # sets once, and §6.2's Manager-invoices visibility keys off it, so an
    # edit must not be able to move an invoice between projects. It used to
    # be locked SILENTLY (the value was simply never read), which meant a
    # caller clearing or changing it got a 200 and an unchanged value with
    # nothing saying the field was ignored. Now it says so, exactly like
    # customer_id does. Omitting the field entirely still means "leave it
    # alone" — the "starting blank" callers InvoiceCreate's own comment
    # describes never send it, and must keep working.
    if "project_id" in body.model_fields_set and body.project_id != invoice.project_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project cannot be changed after creation")
    # invoice_date was ACCEPTED and then silently dropped: the caller got a 200
    # and the old date back. Found by the Layer 2 round-trip check, and exactly
    # the class of bug that check exists for — accepted, acknowledged, not
    # stored.
    #
    # Refused rather than applied, because the rest of this route already
    # treats the date as immutable and would be inconsistent if it moved:
    # invoice_number embeds the FY label and was allocated from the FY current
    # at creation, financial_year_id is snapshotted alongside it, and the tax
    # recomputation below deliberately effective-dates against
    # invoice.invoice_date rather than the body. Letting the date cross into
    # another financial year would leave the number, the snapshot and the date
    # disagreeing — and could walk the invoice into or out of a locked year.
    # Same "locked after creation" treatment as customer_id and project_id
    # above; the model_fields_set guard means omitting the field still reads as
    # "leave it alone".
    if "invoice_date" in body.model_fields_set and body.invoice_date != invoice.invoice_date:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invoice Date cannot be changed after creation — the invoice number and financial year were issued from it",
        )

    old_subtotal = invoice.subtotal
    old_tax = invoice.tax_amount
    subtotal = sum((li.quantity * li.rate for li in body.line_items), Decimal("0"))
    # tax_head_id IS editable here ("Customizable per invoice", §2.3) — unlike
    # the prior version, which never read body.tax_head_id at all and left
    # tax_amount frozen at its old value while deleting the tax lines that
    # justified it. Recomputed exactly like create, from the (possibly new)
    # head and the (possibly changed) subtotal.
    tax_amount, tax_lines = await _compute_tax(db, body.tax_head_id, body.tax_amount_override, subtotal, invoice.invoice_date)

    for row in (await db.execute(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id))).scalars().all():
        await db.delete(row)
    for row in (await db.execute(select(InvoiceTaxLine).where(InvoiceTaxLine.invoice_id == invoice.id))).scalars().all():
        await db.delete(row)
    await db.flush()

    for seq, li in enumerate(body.line_items, start=1):
        hsn_snapshot = None
        if li.hsn_code_id is not None:
            hsn = await db.get(HsnSacCode, li.hsn_code_id)
            hsn_snapshot = hsn.code if hsn else None
        db.add(InvoiceLineItem(
            id=str(uuid.uuid4()), invoice_id=invoice.id, sequence=seq, description=li.description, hsn_code_id=li.hsn_code_id,
            hsn_code_snapshot=hsn_snapshot, quantity=li.quantity, rate=li.rate, created_by=current_user.id, updated_by=current_user.id,
        ))
    for line in tax_lines:
        db.add(InvoiceTaxLine(id=str(uuid.uuid4()), invoice_id=invoice.id, created_by=current_user.id, updated_by=current_user.id, **line))

    invoice.due_date = body.due_date
    invoice.reference = body.reference
    invoice.notes = body.notes
    invoice.service_category_id = body.service_category_id
    invoice.bank_account_id = body.bank_account_id
    invoice.subtotal = subtotal
    invoice.tax_head_id = body.tax_head_id
    invoice.tax_amount = tax_amount
    # claim_amount is a Computed column (subtotal + tax_amount -
    # credit_note_total) — mirrored here in Python rather than round-tripped
    # through a mid-transaction refresh, so status reflects the new totals
    # in the same pass an edit while Sent/Part-Paid is allowed to legitimately
    # move status (e.g. reducing line items can newly reach Paid, §2.3).
    # ...but only for an invoice that has actually been Sent.
    # resolve_invoice_status_after_payment's floor is SENT ("Draft->Sent is a
    # separate, explicit action, never payment-derived") so calling it on a
    # DRAFT silently promoted every edited draft to SENT with sent_at/sent_by
    # left null — and, since POST /send only accepts a DRAFT, permanently
    # locked that invoice out of ever being legitimately sent.
    if invoice.status != "DRAFT":
        new_claim_amount = subtotal + tax_amount - invoice.credit_note_total
        resolved_status = resolve_invoice_status_after_payment(invoice.amount_received, invoice.withheld_total, new_claim_amount)
        new_status = apply_paid_confirmation_gate(resolved_status, await _toggle_enabled(db, "Require Second Approval Before an Invoice Locks as Paid"))
        if new_status == "PAID" and invoice.status != "PAID":
            invoice.paid_at = datetime.now(timezone.utc)
        invoice.status = new_status
    invoice.updated_by = current_user.id

    customer = await db.get(Customer, invoice.customer_id)
    customer.total_invoiced += (subtotal + tax_amount) - (old_subtotal + old_tax)
    customer.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(invoice)
    return await _load_invoice_out(db, invoice)


@router.post("/{invoice_id}/send", response_model=InvoiceOut)
async def send_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="send")),
) -> InvoiceOut:
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if invoice.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft invoice can be Sent")
    has_line_items = (await db.execute(select(InvoiceLineItem.id).where(InvoiceLineItem.invoice_id == invoice.id).limit(1))).first()
    if has_line_items is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="An invoice needs at least one line item before it can be Sent")
    invoice.status = "SENT"
    invoice.sent_at = datetime.now(timezone.utc)
    invoice.sent_by = current_user.id
    invoice.updated_by = current_user.id
    await db.commit()
    await db.refresh(invoice)
    return await _load_invoice_out(db, invoice)


@router.post("/{invoice_id}/payments", response_model=InvoicePaymentOut, status_code=status.HTTP_201_CREATED)
async def record_payment(
    invoice_id: str,
    body: InvoicePaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="record_payment")),
) -> InvoicePayment:
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if invoice.status not in ("SENT", "PART_PAID"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Record Payment is only available on a Sent or Part-Paid invoice")
    if body.payment_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payment Date cannot be in the future")
    tax_head_name = print_label = None
    # §2.4: "Conditional — required once a Customer Withheld Tax is
    # selected... Defaults to Invoice Subtotal." The selected head's own rate
    # is what computes the figure — withheld_amount from the client is only
    # ever an explicit override, exactly the way Purchase Bill's mirror-image
    # withholding_amount_override works (purchase_bills.py). Before, the head
    # was loaded only for its name/label snapshots and the rate was never
    # read at all, so a payment where the customer withheld at source
    # under-settled the invoice by the withheld amount and stranded it at
    # Part-Paid with a phantom balance forever.
    withholding_calculated_on = body.withholding_calculated_on
    withheld_amount = body.withheld_amount or Decimal("0")
    if body.customer_withheld_tax_head_id is not None:
        head = await db.get(TaxHead, body.customer_withheld_tax_head_id)
        if head is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Withholding tax head not found")
        block_reason = await validate_head_usable(db, head, _WITHHOLDING_SCOPES, body.payment_date, required_direction="ON_PAYMENTS_RECEIVED")
        if block_reason is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
        tax_head_name = head.tax_name
        print_label = head.print_label or head.tax_name
        withholding_calculated_on = body.withholding_calculated_on or "SUBTOTAL"  # persist what actually drove the calc
        basis = invoice.subtotal if withholding_calculated_on == "SUBTOTAL" else invoice.grand_total
        snapshot = await build_tax_head_snapshot(db, head)
        result = tax_engine.calculate_tax(snapshot, basis)
        withheld_amount = body.withheld_amount if body.withheld_amount is not None else result.computed_amount

    if body.amount_received + withheld_amount > invoice.balance_due:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Amount cannot exceed the balance due of {invoice.balance_due}")

    payment = InvoicePayment(
        id=str(uuid.uuid4()), invoice_id=invoice.id, financial_year_id=invoice.financial_year_id, amount_received=body.amount_received,
        balance_due_at_entry=invoice.balance_due, customer_withheld_tax_head_id=body.customer_withheld_tax_head_id,
        tax_head_name_snapshot=tax_head_name, print_label_snapshot=print_label,
        withholding_calculated_on=withholding_calculated_on, withheld_amount=withheld_amount, payment_mode_id=body.payment_mode_id,
        received_into_bank_account_id=body.received_into_bank_account_id or invoice.bank_account_id, payment_date=body.payment_date,
        reference=body.reference, recorded_by=current_user.id, recorded_at=datetime.now(timezone.utc),
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(payment)

    invoice.amount_received += body.amount_received
    invoice.withheld_total += withheld_amount
    resolved_status = resolve_invoice_status_after_payment(invoice.amount_received, invoice.withheld_total, invoice.claim_amount)
    invoice.status = apply_paid_confirmation_gate(resolved_status, await _toggle_enabled(db, "Require Second Approval Before an Invoice Locks as Paid"))
    if invoice.status == "PAID":
        invoice.paid_at = datetime.now(timezone.utc)
    invoice.updated_by = current_user.id

    customer = await db.get(Customer, invoice.customer_id)
    customer.received += body.amount_received
    customer.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(payment)
    return payment


@router.get("/{invoice_id}/payments", response_model=list[InvoicePaymentOut])
async def list_payments(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[InvoicePayment]:
    return list(
        (await db.execute(select(InvoicePayment).where(InvoicePayment.invoice_id == invoice_id).order_by(InvoicePayment.payment_date.desc())))
        .scalars().all()
    )


@router.post("/{invoice_id}/payments/{payment_id}/reverse", response_model=InvoicePaymentOut)
async def reverse_payment(
    invoice_id: str,
    payment_id: str,
    body: InvoicePaymentReverse,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="record_payment")),
) -> InvoicePayment:
    """Schema-ready since Phase 4 (InvoicePayment.status/reversed_at/
    reversed_by/reversal_reason) but never wired to an endpoint — closes
    that gap. Deliberately NOT available once PAID: the invoice is locked
    at that point (trg_invoices_no_unlock blocks any status un-set at the
    storage layer, defense in depth against exactly this), so undoing a
    payment that already locked the invoice goes through a Credit Note like
    every other post-lock correction, never a reversal. PEND_PAID (§6.2's
    second-approval gate) IS reversible — nothing is locked yet there, and
    catching a mis-recorded payment before Super Admin confirms is exactly
    what this exists for.
    """
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if invoice.status not in ("SENT", "PART_PAID", "PEND_PAID"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="A payment can only be reversed while the invoice is not yet Paid")
    payment = await db.get(InvoicePayment, payment_id)
    if payment is None or payment.invoice_id != invoice_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Payment not found on this invoice")
    if payment.status != "RECORDED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Recorded payment can be reversed")

    payment.status = "REVERSED"
    payment.reversed_at = datetime.now(timezone.utc)
    payment.reversed_by = current_user.id
    payment.reversal_reason = body.reason
    payment.updated_by = current_user.id

    invoice.amount_received -= payment.amount_received
    invoice.withheld_total -= payment.withheld_amount
    # A reversal only ever shrinks settled — it can never newly resolve to
    # PAID — but the gate is applied anyway for the same reason every other
    # status-resolution call site in this file does: one rule, everywhere,
    # not "safe to skip because I reasoned it can't matter here."
    resolved_status = resolve_invoice_status_after_payment(invoice.amount_received, invoice.withheld_total, invoice.claim_amount)
    invoice.status = apply_paid_confirmation_gate(resolved_status, await _toggle_enabled(db, "Require Second Approval Before an Invoice Locks as Paid"))
    invoice.updated_by = current_user.id

    customer = await db.get(Customer, invoice.customer_id)
    customer.received -= payment.amount_received
    customer.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(payment)
    return payment


@router.post("/{invoice_id}/confirm-paid", response_model=InvoiceOut)
async def confirm_paid(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="confirm_paid")),
) -> InvoiceOut:
    """§6.2 "Require Second Approval Before an Invoice Locks as Paid" — the
    confirmation step itself. Only reachable from PEND_PAID; confirming
    moves the invoice to PAID and locks it, same as an unconfirmed payment
    would have done directly with the toggle off.
    """
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if invoice.status != "PEND_PAID":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only an invoice pending paid-confirmation can be confirmed")
    invoice.status = "PAID"
    invoice.paid_at = datetime.now(timezone.utc)
    invoice.updated_by = current_user.id
    await db.commit()
    await db.refresh(invoice)
    return await _load_invoice_out(db, invoice)
