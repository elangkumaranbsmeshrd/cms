"""Instantiates the 15 simple lookup sub-masters' routers from the generic
factory (masters_lookup.py) — one line of field-shape config each, instead of
fifteen files repeating the same list/add/edit/delete/deactivate pattern.
`combined_router` is what main.py includes.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.masters_lookup import build_lookup_router
from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.models.masters import (
    AssetCategory,
    CustomerSource,
    CustomerStatus,
    Department,
    Designation,
    EmploymentType,
    ExpenseType,
    Holiday,
    HsnSacCode,
    InsurancePlan,
    LeaveType,
    PaymentMode,
    ServiceCategory,
    TaxHead,
    TicketCategory,
    UnitOfMeasure,
    WorkWeekPolicy,
)
# §3a's `referenced_by` — real FK consumers of the 9 lookups gaining
# `is_referenced` this pass, found by an exhaustive grep across app/models/
# (not guessed): every one of these already has working create+read routes
# today, so a row genuinely can be "in use" even though most of these
# modules have no frontend yet.
from app.models.asset import Asset
from app.models.compliance import Remittance
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.finance import (
    CompanyExpense,
    ExpenseClaim,
    ExpenseReimbursement,
    Invoice,
    InvoiceLineItem,
    InvoicePayment,
    PurchaseBillLineItem,
    PurchaseBillPayment,
)
from app.models.leave import LeaveBalance, LeaveBalanceAdjustment, LeaveCarryForwardLine, LeaveRequest
from app.models.payroll import Payslip
from app.models.ticket import Ticket
from app.models.employee import AnnouncementTarget, AttendanceRecord, EmployeeInsuranceEnrollment

combined_router = APIRouter()


async def _expense_type_before_write(data: dict, db: AsyncSession, existing: ExpenseType | None) -> dict:
    """Masters §3.3: "Changing Claim Type on a type already in use is not a
    silent edit ... it applies from that point forward, never retroactively."
    The frontend shows the warning with the affected-record count; this is
    what actually stamps the audit trail those fields exist for
    (claim_type_changed_at/previous_claim_type) — found missing entirely by
    the Phase 1 audit, since neither field was even reachable via the API.
    """
    if existing is not None and data.get("claim_type") != existing.claim_type:
        data["previous_claim_type"] = existing.claim_type
        data["claim_type_changed_at"] = datetime.now(timezone.utc)
    return data


combined_router.include_router(
    build_lookup_router(
        prefix="/masters/expense-types", tag="masters", screen_key="masters.expense_types", model=ExpenseType,
        fields={
            "name": (str, ...),
            "short_code": (str | None, None),
            "claim_type": (str, ...),  # REIMBURSABLE | COMPANY_PAID
            "is_recurring": (bool, False),
            "default_bank_account_id": (str | None, None),
            "description": (str | None, None),
        },
        read_only_fields={
            "claim_type_changed_at": (datetime | None, None),
            "previous_claim_type": (str | None, None),
            "usage_count": (int, 0),
        },
        before_write=_expense_type_before_write,
        # §3.0's Used/Unused filter: the param was declared on every generated
        # list route but only APPLIED where `referenced_by` was passed, so this
        # sub-master accepted `?is_referenced=true|false` with a 200 and
        # returned the identical full row set either way. These are the real FK
        # consumers (exhaustive grep of app/models for `expense_type_id`).
        referenced_by=[(ExpenseClaim, "expense_type_id"), (CompanyExpense, "expense_type_id")],
        create_only_fields={"is_active": (bool, True)},
        # Expense Approvals' own Expense Type filter (Accountant) — see
        # masters_lookup.py's `label_field` docstring.
        label_field="name",
        # The single opted-in extra column in this app, and it clears the
        # docstring's bar: the Expense claim form RENDERS claim_type as §2.1's
        # read-only "Claim Type" field, carried from the selected type, and
        # offers Company-Paid types only to Super Admin/Accountant — so the
        # client needs the value per row, which a server-side filter cannot
        # supply. A two-value enum classifying a category; no person, no
        # amount. default_bank_account_id and usage_count stay unreachable.
        options_extra_fields=("claim_type",),
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/leave-types", tag="masters", screen_key="masters.leave_types", model=LeaveType,
        fields={
            "name": (str, ...),
            "short_code": (str | None, None),
            "is_paid": (bool, ...),
            "default_annual_quota_days": (Decimal, Decimal(0)),
            "carry_forward_allowed": (bool, False),
            "max_carry_forward_days": (Decimal | None, None),
            "is_quota_tracked": (bool, True),
        },
        # Used/Unused filter — same gap as Expense Types above. Every table in
        # app/models carrying a `leave_type_id`.
        referenced_by=[
            (LeaveRequest, "leave_type_id"), (LeaveBalance, "leave_type_id"),
            (LeaveCarryForwardLine, "leave_type_id"), (LeaveBalanceAdjustment, "leave_type_id"),
        ],
        create_only_fields={"is_active": (bool, True)},
        # Leave Approvals / Balance Management / Leave Reports all label a raw
        # leave_type_id and populate a Leave Type filter from this lookup.
        label_field="name",
    )
)

_holidays_router = build_lookup_router(
    prefix="/masters/holidays", tag="masters", screen_key="masters.holidays", model=Holiday,
    fields={
        "name": (str, ...),
        "holiday_date": (date, ...),
        "financial_year_id": (str, ...),
        "holiday_type": (str, ...),  # MANDATORY | OPTIONAL
        "recurring_every_year": (bool, False),
    },
    # Used/Unused filter — an attendance record stamped against a holiday is
    # the one FK pointing at this table (app/models/employee.py AttendanceRecord).
    referenced_by=[(AttendanceRecord, "holiday_id")],
    create_only_fields={"is_active": (bool, True)},
    # A holiday's own name only — never holiday_date/financial_year_id/
    # holiday_type, which is what the real screen is for.
    label_field="name",
)

class _HolidayImportRow(BaseModel):
    name: str
    holiday_date: date
    financial_year_id: str
    holiday_type: str
    recurring_every_year: bool = False


@_holidays_router.post("/import", status_code=201)
async def import_holidays(
    rows: list[_HolidayImportRow],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("masters.holidays", action="import")),
    skip_duplicates: bool = Query(True, description="§3.5: Yes skips a date already in the calendar (recommended); No overwrites its name/type/recurring"),
) -> dict:
    # Masters §3.5: the per-row summary/duplicate-flagging shown before this
    # call is a frontend pre-confirmation concern — this endpoint performs the
    # import the user already confirmed. is_active defaults True; the DB
    # trigger (0002_masters.py) rejects any date outside the linked FY's range.
    #
    # "Duplicate" per §3.5's own wording ("same date already in the calendar")
    # is (financial_year_id, holiday_date) — not the DB's own three-column
    # ux_holidays_fy_date_name unique key, which also folds in `name` and so
    # would let two differently-named holidays share a date. One row per date
    # is what the calendar (and this screen's own preview) actually shows.
    existing_by_date = {
        (h.financial_year_id, h.holiday_date): h
        for h in (
            await db.execute(
                select(Holiday).where(Holiday.financial_year_id.in_({r.financial_year_id for r in rows}))
            )
        ).scalars().all()
    }

    created = 0
    skipped = 0
    overwritten = 0
    for r in rows:
        existing = existing_by_date.get((r.financial_year_id, r.holiday_date))
        if existing is not None:
            if skip_duplicates:
                skipped += 1
                continue
            existing.name = r.name
            existing.holiday_type = r.holiday_type
            existing.recurring_every_year = r.recurring_every_year
            existing.updated_by = current_user.id
            overwritten += 1
            continue
        row = Holiday(
            id=str(uuid.uuid4()),
            name=r.name,
            holiday_date=r.holiday_date,
            financial_year_id=r.financial_year_id,
            holiday_type=r.holiday_type,
            recurring_every_year=r.recurring_every_year,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.add(row)
        # Tracked so a second row in the SAME import batch landing on the same
        # date is caught too, not only rows already in the database.
        existing_by_date[(r.financial_year_id, r.holiday_date)] = row
        created += 1
    await db.commit()
    return {"imported": created, "skipped": skipped, "overwritten": overwritten}


combined_router.include_router(_holidays_router)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/payment-modes", tag="masters", screen_key="masters.payment_modes", model=PaymentMode,
        fields={"name": (str, ...), "code": (str | None, None), "requires_reference_number": (bool, False)},
        search_field=["name", "code"],
        label_field="name",
        # Widest fan-in of the 9 (§3a) — every payment/reimbursement record
        # across Compliance, Purchase Bill, Invoice and Expense names one.
        referenced_by=[
            (Remittance, "payment_mode_id"), (PurchaseBillPayment, "payment_mode_id"),
            (InvoicePayment, "payment_mode_id"), (ExpenseReimbursement, "payment_mode_id"),
            (CompanyExpense, "payment_mode_id"),
        ],
        create_only_fields={"is_active": (bool, True)},
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/departments", tag="masters", screen_key="masters.departments", model=Department,
        fields={"name": (str, ...), "code": (str | None, None), "description": (str | None, None)},
        # §4.3 audit: §3.0's cross-cutting rule is "Search, across that
        # sub-master's name and code fields" — the factory's single-column
        # default left `code` unsearched. See masters_lookup.py's docstring.
        search_field=["name", "code"],
        create_only_fields={"is_active": (bool, True)},
        # §3a's own table names Department as missing Used too — found on a
        # second pass, since the first pass's registration only added `code`.
        # Widest fan-in found in this whole exercise: two other lookups
        # (Designation, WorkWeekPolicy) reference a department, on top of
        # real business records.
        referenced_by=[
            (Employee, "department_id"), (Asset, "department_id"), (Payslip, "department_id"),
            (Designation, "department_id"), (WorkWeekPolicy, "department_id"), (AnnouncementTarget, "department_id"),
        ],
        # The single widest dropdown fan-in in the app: Employee Directory /
        # Master Record / Onboarding, Asset Directory / Record / Reports /
        # Maintenance, Announcements, Payroll Payslips, Expense Approvals and
        # Leave's four report screens all need a Department picker, and none
        # of those roles may open Masters → Department (Super-Admin-only,
        # seed.py:108). See masters_lookup.py's `label_field` docstring.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/designations", tag="masters", screen_key="masters.designations", model=Designation,
        fields={"name": (str, ...), "code": (str | None, None), "department_id": (str | None, None), "level_grade": (str | None, None)},
        search_field=["name", "code"],
        referenced_by=[(Employee, "designation_id"), (WorkWeekPolicy, "designation_id")],
        create_only_fields={"is_active": (bool, True)},
        # `name` only — never department_id/level_grade, which is the org
        # structure the standalone screen exists to manage.
        label_field="name",
    )
)

async def _hsn_sac_before_write(data: dict, db: AsyncSession, existing: HsnSacCode | None) -> dict:
    """Masters §3.11: Linked Tax must be "built live from whatever heads
    currently exist in Taxes, Sales/Billing or Purchase scope, in force" —
    found unenforced by the Phase 1 audit (any tax_heads id of any scope,
    expired or not, passed the bare FK check).
    """
    linked_id = data.get("linked_tax_head_id")
    if linked_id is None:
        return data
    head = await db.get(TaxHead, linked_id)
    if head is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Linked Tax must reference an existing tax head")
    if head.scope not in ("SALES_BILLING", "PURCHASE", "SALES_AND_PURCHASE"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Linked Tax must be a Sales/Billing or Purchase scope head")
    today = date.today()
    in_force = head.is_active and head.applies_from <= today and (head.applies_until is None or head.applies_until >= today)
    if not in_force:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Linked Tax must be an in-force (active, currently applicable) tax head")
    return data


combined_router.include_router(
    build_lookup_router(
        prefix="/masters/hsn-sac-codes", tag="masters", screen_key="masters.hsn_sac_codes", model=HsnSacCode,
        fields={
            "code": (str, ...),
            "code_type": (str, ...),  # HSN | SAC
            "description": (str, ...),
            "linked_tax_head_id": (str | None, None),
            "is_custom": (bool, False),
            "custom_gst_type": (str | None, None),
            "custom_gst_rate_pct": (Decimal | None, None),
        },
        search_field="code",
        before_write=_hsn_sac_before_write,
        # Used/Unused filter — invoice and purchase-bill line items are what
        # actually consume an HSN/SAC code (both spell the FK `hsn_code_id`).
        referenced_by=[(InvoiceLineItem, "hsn_code_id"), (PurchaseBillLineItem, "hsn_code_id")],
        create_only_fields={"is_active": (bool, True)},
        label_field="code",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/service-categories", tag="masters", screen_key="masters.service_categories", model=ServiceCategory,
        fields={"name": (str, ...), "code": (str | None, None), "description": (str | None, None)},
        search_field=["name", "code"],
        referenced_by=[(Invoice, "service_category_id")],
        create_only_fields={"is_active": (bool, True)},
        # Invoice's own Service Category field (invoice.api.ts).
        label_field="name",
    )
)

# §3b BUILT — masters_lookup.py's build_lookup_router now has the create-only
# field concept this comment used to say was missing (`create_only_fields`,
# accepted by create_row, excluded from write_schema on update_row — so a
# role with plain 'edit' still cannot flip Status via PUT, only Super Admin's
# dedicated deactivate/activate actions can, per §4a).
combined_router.include_router(
    build_lookup_router(
        prefix="/masters/units-of-measure", tag="masters", screen_key="masters.units_of_measure", model=UnitOfMeasure,
        fields={"name": (str, ...), "code": (str | None, None)},
        search_field=["name", "code"],
        # Genuinely zero referencing tables exist anywhere in app/models
        # today (confirmed by an exhaustive grep, not assumed) — an empty
        # list, not None, so this is "checked, never referenced" rather than
        # "feature not requested".
        referenced_by=[],
        create_only_fields={"is_active": (bool, True)},
        # No consumer screen today (nothing references a unit yet — see the
        # empty `referenced_by` above), but the same contract as its siblings
        # so the first module that needs a UoM picker does not have to reopen
        # this file.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/ticket-categories", tag="masters", screen_key="masters.ticket_categories", model=TicketCategory,
        fields={"name": (str, ...), "code": (str | None, None), "description": (str | None, None)},
        search_field=["name", "code"],
        referenced_by=[(Ticket, "category_id")],
        create_only_fields={"is_active": (bool, True)},
        # Ticket List / Raise a Ticket, for all five roles (ticket.api.ts's
        # TICKET_CATEGORY_REF) — the second-widest gap after Financial Year.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/customer-statuses", tag="masters", screen_key="masters.customer_statuses", model=CustomerStatus,
        fields={"name": (str, ...), "code": (str | None, None)},
        search_field=["name", "code"],
        referenced_by=[(Customer, "status_id")],
        create_only_fields={"is_active": (bool, True)},
        # Customer Directory/Record's Status column and filter.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/customer-sources", tag="masters", screen_key="masters.customer_sources", model=CustomerSource,
        fields={"name": (str, ...), "code": (str | None, None)},
        search_field=["name", "code"],
        referenced_by=[(Customer, "source_id")],
        create_only_fields={"is_active": (bool, True)},
        # Customer Directory/Record's Source column and filter.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/asset-categories", tag="masters", screen_key="masters.asset_categories", model=AssetCategory,
        fields={
            "name": (str, ...), "code": (str | None, None), "description": (str | None, None),
            # gt=0, matching AssetSchema's own `useful_life_years` validator
            # ("Useful Life must be a positive number", app/schemas/asset.py):
            # this is the DEFAULT copied onto an asset in that column, and the
            # straight-line engine divides by it, so a negative (or zero) value
            # is either nonsense depreciation or a ZeroDivisionError downstream.
            # A -3 was accepted with a 201 before this constraint existed.
            "default_useful_life_years": (Annotated[int, Field(gt=0)] | None, None),
        },
        search_field=["name", "code"],
        referenced_by=[(Asset, "category_id")],
        create_only_fields={"is_active": (bool, True)},
        # Asset Directory / Record / Reports / Maintenance / Requests /
        # Reclaim and Employee's My Assets all label a raw category_id.
        # `default_useful_life_years` is deliberately NOT reachable here —
        # /options selects `name` and nothing else.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/employment-types", tag="masters", screen_key="masters.employment_types", model=EmploymentType,
        fields={"name": (str, ...), "code": (str | None, None)},
        search_field=["name", "code"],
        referenced_by=[(Employee, "employment_type_id"), (WorkWeekPolicy, "employment_type_id"), (Payslip, "employment_type_id")],
        create_only_fields={"is_active": (bool, True)},
        # Employee Directory / Master Record / My Profile, Payroll Payslips
        # and Leave's report filters.
        label_field="name",
    )
)

combined_router.include_router(
    build_lookup_router(
        prefix="/masters/insurance-plans", tag="masters", screen_key="masters.insurance_plans", model=InsurancePlan,
        fields={
            "plan_name": (str, ...),
            "plan_type": (str, ...),  # HEALTH | LIFE | PERSONAL_ACCIDENT
            "provider": (str | None, None),
            "coverage_amount": (Decimal, ...),
            "company_contribution_monthly": (Decimal, ...),
            "employee_contribution_monthly": (Decimal, Decimal(0)),
        },
        search_field="plan_name",
        # Used/Unused filter — an employee enrolled on the plan is what makes
        # it "used" (app/models/employee.py EmployeeInsuranceEnrollment).
        referenced_by=[(EmployeeInsuranceEnrollment, "insurance_plan_id")],
        create_only_fields={"is_active": (bool, True)},
        # The ONE sub-master on this factory carrying money columns
        # (coverage_amount / company_contribution_monthly /
        # employee_contribution_monthly), so masters_lookup.py's own caveat
        # about `apply_field_masking` being bypassed matters here more than
        # anywhere else on this page. Safe by construction and for the same
        # reason masters_bank_accounts.py's `/options` is: the route selects
        # `plan_name` and nothing else, so not one of those three figures is
        # reachable through it. Note this is NOT what Employee → Insurance &
        # Benefits' enrolment form reads — that one genuinely needs the
        # contribution figures and keeps using the full list route (which HR,
        # its only non-Super-Admin caller, already holds `view` on).
        label_field="plan_name",
    )
)
