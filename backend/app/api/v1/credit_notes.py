"""Credit Note (11-invoice-module.md §2.5) — raised against a Paid/Part-Paid
invoice, Draft -> Pending Approval -> Approved (Super Admin only). Applying
a Credit Note only touches `invoices.credit_note_total`/`claim_amount` on
approval — the original invoice's own subtotal/tax/lines never change
(§2.5: "a Credit Note reduces what a customer owes as a correction... the
original invoice never becomes editable again").
"""

import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.customer import Customer
from app.models.finance import CreditNote, CreditNoteLineItem, Invoice, InvoiceLineItem
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.finance import CreditNoteCreate, CreditNoteOut
from app.services import list_export, pdf_engine
from app.services.finance_engine import resolve_invoice_status_after_payment
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.notify import notify
from app.services.pdf_engine import ColumnSpec

_LIST_COLUMNS = [
    ColumnSpec("credit_note_number", "Credit Note Number"),
    ColumnSpec("invoice_number", "Invoice Number"),
    ColumnSpec("customer", "Customer"),
    ColumnSpec("amount", "Amount", align="left"),
    ColumnSpec("status", "Status"),
]

router = APIRouter(prefix="/credit-notes", tags=["invoice"])
SCREEN = "credit_note.list"


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _load_credit_note_out(db: AsyncSession, row: CreditNote) -> CreditNoteOut:
    lines = (await db.execute(select(CreditNoteLineItem).where(CreditNoteLineItem.credit_note_id == row.id).order_by(CreditNoteLineItem.sequence))).scalars().all()
    out = CreditNoteOut.model_validate(row)
    out.line_items = list(lines)
    return out


async def _credit_note_line_items(db: AsyncSession, credit_note_ids: set[str]) -> dict[str, list[CreditNoteLineItem]]:
    """Batch line-item lookup for the List — one `.in_()` query grouped in
    Python, the same shape as expenses.py's _employee_names/_vendor_names.
    Ordered by (credit_note_id, sequence) so each note's own slice comes back
    in exactly the sequence order the per-note query produced; the leading
    credit_note_id only groups, it never reorders within.
    """
    if not credit_note_ids:
        return {}
    rows = (
        await db.execute(
            select(CreditNoteLineItem).where(CreditNoteLineItem.credit_note_id.in_(credit_note_ids))
            .order_by(CreditNoteLineItem.credit_note_id, CreditNoteLineItem.sequence, CreditNoteLineItem.id)
        )
    ).scalars().all()
    grouped: dict[str, list[CreditNoteLineItem]] = {}
    for row in rows:
        grouped.setdefault(row.credit_note_id, []).append(row)
    return grouped


async def _load_credit_note_outs(db: AsyncSession, credit_notes: list[CreditNote]) -> list[CreditNoteOut]:
    """List counterpart to _load_credit_note_out: 1 query in TOTAL rather
    than 1 per note. Same output, row for row — a note with no lines still
    gets the empty list its own query returned.
    """
    lines_by_note = await _credit_note_line_items(db, {note.id for note in credit_notes})
    outs = []
    for note in credit_notes:
        out = CreditNoteOut.model_validate(note)
        out.line_items = list(lines_by_note.get(note.id, ()))
        outs.append(out)
    return outs


async def _build_line_item_rows(db: AsyncSession, invoice_id: str, line_items_affected: list[str], credit_amount: Decimal) -> list[dict]:
    """Splits `credit_amount` proportionally to each selected line's own
    weight, not the full amount onto every line (the bug the audit found: a
    ₹700 credit against a ₹500 and ₹1000 line used to credit ₹500 AND ₹700,
    summing to ₹1200 instead of ₹700). The last line absorbs the rounding
    remainder so the parts always sum back to the whole.
    """
    lines = []
    for line_item_id in line_items_affected:
        line = await db.get(InvoiceLineItem, line_item_id)
        if line is None or line.invoice_id != invoice_id:
            continue
        lines.append(line)
    if not lines:
        return []

    total_affected = sum((l.line_total for l in lines), Decimal("0"))
    rows = []
    allocated = Decimal("0")
    for idx, line in enumerate(lines, start=1):
        if idx == len(lines):
            share = credit_amount - allocated  # remainder — keeps the split reconciling exactly
        else:
            share = (credit_amount * line.line_total / total_affected).quantize(Decimal("0.01"))
        share = min(share, line.line_total)
        allocated += share
        rows.append({
            "invoice_line_item_id": line.id, "sequence": idx, "description_snapshot": line.description,
            "quantity_snapshot": line.quantity, "rate_snapshot": line.rate, "line_total_snapshot": line.line_total, "credited_amount": share,
        })
    return rows


@router.get("", response_model=None)
async def list_credit_notes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    customer_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    reason: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    credit_amount_min: Decimal | None = Query(None),
    credit_amount_max: Decimal | None = Query(None),
    raised_by: str | None = Query(None),
    approved_by: str | None = Query(None),
    search: str | None = Query(None, description="Matches Credit Note Number, Invoice Number, Customer Name"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[CreditNoteOut] | Response:
    stmt = select(CreditNote)
    if customer_id:
        stmt = stmt.where(CreditNote.customer_id == customer_id)
    if status_filter:
        stmt = stmt.where(CreditNote.status.in_(status_filter))
    if reason:
        stmt = stmt.where(CreditNote.reason == reason)
    if date_from:
        stmt = stmt.where(CreditNote.credit_note_date >= date_from)
    if date_to:
        stmt = stmt.where(CreditNote.credit_note_date <= date_to)
    if credit_amount_min is not None:
        stmt = stmt.where(CreditNote.credit_amount >= credit_amount_min)
    if credit_amount_max is not None:
        stmt = stmt.where(CreditNote.credit_amount <= credit_amount_max)
    if raised_by:
        stmt = stmt.where(CreditNote.raised_by == raised_by)
    if approved_by:
        stmt = stmt.where(CreditNote.approved_by == approved_by)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            CreditNote.credit_note_number.ilike(pattern) | CreditNote.invoice_number_snapshot.ilike(pattern) | CreditNote.customer_name_snapshot.ilike(pattern)
        )
    rows = (await db.execute(stmt.order_by(CreditNote.credit_note_date.desc()))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered set on screen — same rows
        # the JSON branch below would return, just re-shaped.
        export_rows = [
            {
                "credit_note_number": row.credit_note_number, "invoice_number": row.invoice_number_snapshot,
                "customer": row.customer_name_snapshot, "amount": row.credit_amount, "status": row.status,
            }
            for row in rows
        ]
        filters_applied = {
            "customer_id": customer_id, "status": status_filter, "reason": reason,
            "date_from": date_from, "date_to": date_to, "credit_amount_min": credit_amount_min,
            "credit_amount_max": credit_amount_max, "raised_by": raised_by, "approved_by": approved_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Credit Notes", _LIST_COLUMNS, export_rows, filters_applied)

    return await _load_credit_note_outs(db, list(rows))


@router.post("", response_model=CreditNoteOut, status_code=status.HTTP_201_CREATED)
async def create_credit_note(
    body: CreditNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="raise")),
) -> CreditNoteOut:
    invoice = await db.get(Invoice, body.invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    if invoice.status not in ("PAID", "PART_PAID"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="A Credit Note can only be raised against a Paid or Part-Paid invoice")
    # §2.5: caps against what's still creditable, not the full Grand Total —
    # a second Credit Note on the same invoice must not be allowed to push
    # cumulative approved credits past the Grand Total (which would drive
    # claim_amount negative and force every future status resolution to PAID).
    remaining_creditable = invoice.grand_total - invoice.credit_note_total
    if body.credit_amount > remaining_creditable:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Credit Amount cannot exceed the remaining creditable amount of {remaining_creditable}")

    fy = await get_current_financial_year(db)
    number = await allocate_number(db, "CN", fy.id, fy.label)
    row = CreditNote(
        id=str(uuid.uuid4()), credit_note_number=number, invoice_id=invoice.id, customer_id=invoice.customer_id, financial_year_id=fy.id,
        invoice_number_snapshot=invoice.invoice_number, customer_name_snapshot=invoice.customer_name_snapshot, credit_note_date=date.today(),
        reason=body.reason, reason_detail=body.reason_detail, credit_amount=body.credit_amount, raised_by=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    # Guarded, not a bare flush: _build_line_item_rows below issues its own
    # queries, and SQLAlchemy's autoflush would otherwise emit this INSERT
    # from inside one of them — outside the commit-time DBAPIError guard, so
    # a constraint rejection escaped the endpoint as a 500 instead of the
    # 409 every other write in this module answers with. Flushing here puts
    # that INSERT back inside a guard.
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc

    for line in await _build_line_item_rows(db, invoice.id, body.line_items_affected, body.credit_amount):
        db.add(CreditNoteLineItem(id=str(uuid.uuid4()), credit_note_id=row.id, created_by=current_user.id, updated_by=current_user.id, **line))

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_credit_note_out(db, row)


@router.put("/{credit_note_id}", response_model=CreditNoteOut)
async def update_credit_note(
    credit_note_id: str,
    body: CreditNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="raise")),
) -> CreditNoteOut:
    """§2.5's own two-button workflow ("Save Draft" then "Submit for
    Approval") implies a Draft can be revised in between — Reason/Detail/
    Amount/Line Items, recomputed exactly like create. Only a Draft is
    editable; once Submitted the same "no correction after the fact,
    reverse and redo" rule the rest of this module lives by applies.
    """
    row = await db.get(CreditNote, credit_note_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft Credit Note can be edited")
    if body.invoice_id != row.invoice_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invoice cannot be changed after creation")

    invoice = await db.get(Invoice, row.invoice_id)
    remaining_creditable = invoice.grand_total - invoice.credit_note_total
    if body.credit_amount > remaining_creditable:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Credit Amount cannot exceed the remaining creditable amount of {remaining_creditable}")

    row.reason = body.reason
    row.reason_detail = body.reason_detail
    row.credit_amount = body.credit_amount
    row.updated_by = current_user.id
    # Same reason as create's guarded flush: the SELECT below would autoflush
    # this UPDATE outside the commit-time guard, turning a constraint
    # rejection into a 500.
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc

    for line in (await db.execute(select(CreditNoteLineItem).where(CreditNoteLineItem.credit_note_id == row.id))).scalars():
        await db.delete(line)
    await db.flush()
    for line in await _build_line_item_rows(db, invoice.id, body.line_items_affected, body.credit_amount):
        db.add(CreditNoteLineItem(id=str(uuid.uuid4()), credit_note_id=row.id, created_by=current_user.id, updated_by=current_user.id, **line))

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_credit_note_out(db, row)


@router.post("/{credit_note_id}/submit", response_model=CreditNoteOut)
async def submit_credit_note(
    credit_note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="raise")),
) -> CreditNote:
    row = await db.get(CreditNote, credit_note_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft Credit Note can be submitted for approval")
    row.status = "PENDING_APPROVAL"
    row.submitted_at = datetime.now(timezone.utc)
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return await _load_credit_note_out(db, row)


@router.post("/{credit_note_id}/approve", response_model=CreditNoteOut)
async def approve_credit_note(
    credit_note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="approve")),
) -> CreditNoteOut:
    row = await db.get(CreditNote, credit_note_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING_APPROVAL":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Credit Note Pending Approval can be approved")

    invoice = await db.get(Invoice, row.invoice_id)
    row.status = "APPROVED"
    row.approved_by = current_user.id
    row.approved_at = datetime.now(timezone.utc)
    row.applied_to_invoice_at = datetime.now(timezone.utc)
    row.updated_by = current_user.id

    invoice.credit_note_total += row.credit_amount
    # claim_amount is a Computed column (subtotal + tax_amount -
    # credit_note_total) — reading invoice.claim_amount here would still be
    # the STALE pre-increment value until a flush+refresh round-trip, which
    # silently strands a Part-Paid invoice that should now reach Paid (the
    # bug is invisible on an already-Paid invoice, since a credit note only
    # ever shrinks the claim and Paid can't un-reach itself). Mirrored in
    # Python instead, same fix as Invoice's own update_invoice.
    # §6.2's "Require Second Approval Before an Invoice Locks as Paid" gate
    # is deliberately NOT applied here, unlike invoices.py's own three call
    # sites of resolve_invoice_status_after_payment. That toggle's own words
    # name the risk it controls — "Accountant recording a payment... a
    # control for larger amounts" — and this path is already gated behind
    # the SAME bar the toggle would add: approve is Super-Admin-only on
    # credit_note.list (seed.py), unlike record_payment, which Accountant
    # holds outright. A second Super-Admin-only check in front of an
    # already-Super-Admin-only action controls nothing.
    new_claim_amount = invoice.subtotal + invoice.tax_amount - invoice.credit_note_total
    new_status = resolve_invoice_status_after_payment(invoice.amount_received, invoice.withheld_total, new_claim_amount)
    if new_status == "PAID" and invoice.status != "PAID":
        invoice.paid_at = datetime.now(timezone.utc)
    invoice.status = new_status
    invoice.updated_by = current_user.id

    # Write back onto the original invoice line items — an advertised
    # column (InvoiceLineItemOut.credited_amount) that nothing populated.
    for cn_line in (await db.execute(select(CreditNoteLineItem).where(CreditNoteLineItem.credit_note_id == row.id))).scalars():
        inv_line = await db.get(InvoiceLineItem, cn_line.invoice_line_item_id)
        if inv_line is not None:
            inv_line.credited_amount += cn_line.credited_amount
            inv_line.updated_by = current_user.id

    customer = await db.get(Customer, invoice.customer_id)
    customer.total_invoiced -= row.credit_amount
    customer.updated_by = current_user.id

    notify(
        db, recipient_user_id=row.raised_by, notification_type="CREDIT_NOTE", actor_user_id=current_user.id,
        title="Credit Note approved", body=f"{row.credit_note_number} for {row.customer_name_snapshot} has been approved.",
        source_module="invoice", source_record_id=row.id,
    )

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_credit_note_out(db, row)


@router.get("/{credit_note_id}", response_model=CreditNoteOut)
async def get_credit_note(
    credit_note_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> CreditNoteOut:
    row = await db.get(CreditNote, credit_note_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await _load_credit_note_out(db, row)


@router.get("/{credit_note_id}/pdf")
async def download_credit_note_pdf(
    credit_note_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> Response:
    """11-invoice-module.md §2.5: "generates a downloadable Credit Note PDF,
    using the same letterhead treatment as an invoice" — mirrors invoices.py's
    download_invoice_pdf exactly (same OFFICIAL DOCUMENT RULE, Appendix B).
    """
    row = await db.get(CreditNote, credit_note_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    lines = (await db.execute(select(CreditNoteLineItem).where(CreditNoteLineItem.credit_note_id == row.id).order_by(CreditNoteLineItem.sequence))).scalars().all()
    company, logo = await pdf_engine.company_logo_bytes(db)

    line_columns = [
        ColumnSpec("description_snapshot", "Description"),
        ColumnSpec("quantity_snapshot", "Qty", align="right"),
        ColumnSpec("rate_snapshot", "Rate", align="left"),
        ColumnSpec("line_total_snapshot", "Line Total", align="left"),
        ColumnSpec("credited_amount", "Credited Amount", align="left"),
    ]
    line_rows = [
        {
            "description_snapshot": li.description_snapshot, "quantity_snapshot": li.quantity_snapshot,
            "rate_snapshot": li.rate_snapshot, "line_total_snapshot": li.line_total_snapshot, "credited_amount": li.credited_amount,
        }
        for li in lines
    ]
    header_lines = [
        f"Credit Note: {row.credit_note_number}", f"Against Invoice: {row.invoice_number_snapshot}",
        f"Customer: {row.customer_name_snapshot}", f"Credit Note Date: {row.credit_note_date}",
        f"Reason: {row.reason}",
    ]
    if row.reason_detail:
        header_lines.append(f"Reason Detail: {row.reason_detail}")
    header_lines.append(f"Amount: ₹{row.credit_amount:,.2f} | Status: {row.status}")
    content = pdf_engine.render_table_pdf(f"Credit Note {row.credit_note_number}", line_columns, line_rows, header_lines, company, logo)
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{row.credit_note_number}.pdf"'})
