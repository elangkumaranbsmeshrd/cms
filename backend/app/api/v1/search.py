"""GET /search — a real cross-entity quick search, backing the topbar's own
Ctrl+K search box (frontend/src/app/layout/topbar.component.ts). Before this
existed, that box only matched against screen NAMES (a client-side nav
helper) — this searches actual record data: Employees, Customers, Vendors,
Invoices, Tickets, Purchase Bills, by name/number.

Deliberately gated on `mode == 'full'`, not just "visible": several of these
screens are genuinely SCOPE-narrowed per role (Employee Directory is
'team' for Manager — own + direct reports only), and this endpoint has no
per-entity scope-filtering logic of its own (each entity's own list endpoint
already re-implements that narrowing; duplicating it here risks getting it
wrong and leaking an out-of-scope row through search instead). Gating on
'full' means a scoped role simply doesn't get that entity type in quick
search results at all — a safe, conservative simplification, not a bug: the
real Directory/List screen (with its own correct scope narrowing already
applied) is still the authoritative way to browse those records.
"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.finance import Invoice, PurchaseBill
from app.models.platform import User
from app.models.ticket import Ticket
from app.models.vendor import Vendor
from app.rbac.resolver import resolve_permission

router = APIRouter(prefix="/search", tags=["search"])

_LIMIT_PER_TYPE = 5


class SearchHit(BaseModel):
    type: str
    id: str
    label: str
    sublabel: str | None = None


@router.get("", response_model=list[SearchHit])
async def search(
    q: str = Query(..., min_length=2, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SearchHit]:
    like = f"%{q}%"
    hits: list[SearchHit] = []

    if (await resolve_permission(db, current_user, "employee.directory")).mode == "full":
        rows = (
            await db.execute(
                select(Employee.id, Employee.first_name, Employee.last_name, Employee.employee_code)
                .where(or_(Employee.first_name.ilike(like), Employee.last_name.ilike(like), Employee.employee_code.ilike(like)))
                .limit(_LIMIT_PER_TYPE)
            )
        ).all()
        hits += [
            SearchHit(type="Employee", id=r.id, label=f"{r.first_name} {r.last_name or ''}".strip(), sublabel=r.employee_code)
            for r in rows
        ]

    if (await resolve_permission(db, current_user, "customer.directory")).mode == "full":
        rows = (
            await db.execute(
                select(Customer.id, Customer.company_name, Customer.customer_code)
                .where(or_(Customer.company_name.ilike(like), Customer.customer_code.ilike(like)))
                .limit(_LIMIT_PER_TYPE)
            )
        ).all()
        hits += [SearchHit(type="Customer", id=r.id, label=r.company_name, sublabel=r.customer_code) for r in rows]

    if (await resolve_permission(db, current_user, "vendor.directory")).mode == "full":
        rows = (
            await db.execute(select(Vendor.id, Vendor.vendor_name).where(Vendor.vendor_name.ilike(like)).limit(_LIMIT_PER_TYPE))
        ).all()
        hits += [SearchHit(type="Vendor", id=r.id, label=r.vendor_name) for r in rows]

    if (await resolve_permission(db, current_user, "invoice.list")).mode == "full":
        rows = (
            await db.execute(
                select(Invoice.id, Invoice.invoice_number, Invoice.customer_name_snapshot)
                .where(or_(Invoice.invoice_number.ilike(like), Invoice.customer_name_snapshot.ilike(like)))
                .limit(_LIMIT_PER_TYPE)
            )
        ).all()
        hits += [SearchHit(type="Invoice", id=r.id, label=r.invoice_number, sublabel=r.customer_name_snapshot) for r in rows]

    if (await resolve_permission(db, current_user, "ticket.list")).mode == "full":
        rows = (
            await db.execute(
                select(Ticket.id, Ticket.ticket_number, Ticket.subject)
                .where(or_(Ticket.ticket_number.ilike(like), Ticket.subject.ilike(like)))
                .limit(_LIMIT_PER_TYPE)
            )
        ).all()
        hits += [SearchHit(type="Ticket", id=r.id, label=r.ticket_number, sublabel=r.subject) for r in rows]

    if (await resolve_permission(db, current_user, "purchase_bill.list")).mode == "full":
        rows = (
            await db.execute(
                select(PurchaseBill.id, PurchaseBill.purchase_bill_code, PurchaseBill.vendor_bill_number)
                .where(or_(PurchaseBill.purchase_bill_code.ilike(like), PurchaseBill.vendor_bill_number.ilike(like)))
                .limit(_LIMIT_PER_TYPE)
            )
        ).all()
        hits += [SearchHit(type="Purchase Bill", id=r.id, label=r.purchase_bill_code, sublabel=r.vendor_bill_number) for r in rows]

    return hits
