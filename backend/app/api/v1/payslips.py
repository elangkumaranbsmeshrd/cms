"""Payroll §2.2 Payslip — Employee View (baseline, every role, own pay
only), §2.3 Payslip — Accountant/HR View (full company-wide + Reissue),
§3.2/§3.3 workflows, and on-demand Salary Certificates.
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
from app.models.employee import Employee, SalaryStructure
from app.models.masters import CompanyProfile, Department, Designation
from app.models.numbering import FinancialYear
from app.models.payroll import Payslip, PayslipAdjustmentLine, PayslipEarningLine, PayslipReissue, PayslipStatutoryLine, PayrollRun, PayrollRunEmployee, SalaryCertificateRequest
from app.models.platform import User
from app.models.rbac import FeatureToggle
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet, resolve_permission
from app.rbac.scope import apply_scope
from app.schemas.payroll import PayslipOut, PayslipReissueOut, ReissueRequest, SalaryCertificateRequestCreate, SalaryCertificateRequestOut
from app.services import email_transport, file_storage, list_export, org_scope, pdf_engine
from app.services.notify import notify
from app.services.numbering import get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/payroll", tags=["payroll"])
MY_PAYSLIPS = "payroll.my_payslips"
ADMIN_PAYSLIPS = "payroll.payslips_admin"

_LIST_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("period", "Period"),
    ColumnSpec("gross", "Gross", align="left"),
    ColumnSpec("net", "Net", align="left"),
    ColumnSpec("status", "Status"),
]

# §2.2's own List section — "Pay Period, Net Pay, Date Processed" — no
# Employee column (every row is already the viewer's own), no Gross (not
# named for this screen, unlike the admin view above).
_MY_LIST_COLUMNS = [
    ColumnSpec("period", "Pay Period"),
    ColumnSpec("net", "Net Pay", align="left"),
    ColumnSpec("status", "Status"),
    ColumnSpec("date_processed", "Date Processed"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _hide_adhoc_labels_from_employee(db: AsyncSession) -> bool:
    row = (
        await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == "Hide Ad-hoc Adjustment Labels from Employee"))
    ).scalar_one_or_none()
    return bool(row)


async def _to_out(db: AsyncSession, payslip: Payslip, obscure_adhoc_labels: bool = False) -> PayslipOut:
    earning = (await db.execute(select(PayslipEarningLine).where(PayslipEarningLine.payslip_id == payslip.id, PayslipEarningLine.show_on_payslip.is_(True)).order_by(PayslipEarningLine.sequence))).scalars().all()
    statutory = (await db.execute(select(PayslipStatutoryLine).where(PayslipStatutoryLine.payslip_id == payslip.id, PayslipStatutoryLine.show_on_payslip_snapshot.is_(True)).order_by(PayslipStatutoryLine.sequence))).scalars().all()
    adjustment = (await db.execute(select(PayslipAdjustmentLine).where(PayslipAdjustmentLine.payslip_id == payslip.id).order_by(PayslipAdjustmentLine.sequence))).scalars().all()
    # §6.1 "Hide Ad-hoc Adjustment Labels from Employee" — OFF by default
    # (§2.1a's own transparency default: the real Label, "Diwali Bonus,"
    # shows). Only ever applied by SELF-SERVICE callers (obscure_adhoc_labels
    # is never passed True from the Accountant/HR view) — the toggle hides a
    # reason from the employee it's about, never from admin staff who need
    # it for audit. Mutated on the ORM rows in memory only, never committed.
    if obscure_adhoc_labels:
        for line in adjustment:
            line.label_snapshot = "Adjustment"
    out = PayslipOut.model_validate(payslip)
    out.earning_lines = list(earning)
    out.statutory_lines = list(statutory)
    out.adjustment_lines = list(adjustment)
    return out


async def _payslip_earning_lines(db: AsyncSession, payslip_ids: set[str]) -> dict[str, list[PayslipEarningLine]]:
    """Batch line lookup for the payslip Lists — one `.in_()` query grouped
    in Python, the same shape as expenses.py's _employee_names/_vendor_names.
    Carries the SAME show_on_payslip filter the per-payslip query applied
    (a hidden line must stay hidden), and orders by (payslip_id, sequence)
    so each payslip's own slice keeps the sequence order it had; the leading
    payslip_id only groups, it never reorders within.
    """
    if not payslip_ids:
        return {}
    rows = (
        await db.execute(
            select(PayslipEarningLine).where(PayslipEarningLine.payslip_id.in_(payslip_ids), PayslipEarningLine.show_on_payslip.is_(True))
            .order_by(PayslipEarningLine.payslip_id, PayslipEarningLine.sequence)
        )
    ).scalars().all()
    grouped: dict[str, list[PayslipEarningLine]] = {}
    for row in rows:
        grouped.setdefault(row.payslip_id, []).append(row)
    return grouped


async def _payslip_statutory_lines(db: AsyncSession, payslip_ids: set[str]) -> dict[str, list[PayslipStatutoryLine]]:
    if not payslip_ids:
        return {}
    rows = (
        await db.execute(
            select(PayslipStatutoryLine).where(PayslipStatutoryLine.payslip_id.in_(payslip_ids), PayslipStatutoryLine.show_on_payslip_snapshot.is_(True))
            .order_by(PayslipStatutoryLine.payslip_id, PayslipStatutoryLine.sequence)
        )
    ).scalars().all()
    grouped: dict[str, list[PayslipStatutoryLine]] = {}
    for row in rows:
        grouped.setdefault(row.payslip_id, []).append(row)
    return grouped


async def _payslip_adjustment_lines(db: AsyncSession, payslip_ids: set[str]) -> dict[str, list[PayslipAdjustmentLine]]:
    if not payslip_ids:
        return {}
    rows = (
        await db.execute(
            select(PayslipAdjustmentLine).where(PayslipAdjustmentLine.payslip_id.in_(payslip_ids))
            .order_by(PayslipAdjustmentLine.payslip_id, PayslipAdjustmentLine.sequence)
        )
    ).scalars().all()
    grouped: dict[str, list[PayslipAdjustmentLine]] = {}
    for row in rows:
        grouped.setdefault(row.payslip_id, []).append(row)
    return grouped


async def _to_outs(db: AsyncSession, payslips: list[Payslip], obscure_adhoc_labels: bool = False) -> list[PayslipOut]:
    """List counterpart to _to_out: 3 queries in TOTAL rather than 3 per
    payslip. The §6.1 "Hide Ad-hoc Adjustment Labels from Employee" masking
    is applied here too, on exactly the same rows and on the same
    SELF-SERVICE-only condition — batching must not be a way for a real
    Label to leak past a toggle that is on.
    """
    payslip_ids = {payslip.id for payslip in payslips}
    earning_by_payslip = await _payslip_earning_lines(db, payslip_ids)
    statutory_by_payslip = await _payslip_statutory_lines(db, payslip_ids)
    adjustment_by_payslip = await _payslip_adjustment_lines(db, payslip_ids)
    if obscure_adhoc_labels:
        for lines in adjustment_by_payslip.values():
            for line in lines:
                line.label_snapshot = "Adjustment"
    outs = []
    for payslip in payslips:
        out = PayslipOut.model_validate(payslip)
        out.earning_lines = list(earning_by_payslip.get(payslip.id, ()))
        out.statutory_lines = list(statutory_by_payslip.get(payslip.id, ()))
        out.adjustment_lines = list(adjustment_by_payslip.get(payslip.id, ()))
        outs.append(out)
    return outs


# ================================================================ MY PAYSLIPS
@router.get("/payslips/me", response_model=list[PayslipOut])
async def list_my_payslips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PAYSLIPS)),
    financial_year_id: str | None = Query(None),
    # numberrange filter kind's own naming convention (create-list-store.ts:
    # `${param}_min`/`${param}_max`) — §2.2's "Month range" is a plain
    # numeric range over period_month (1-12), not a calendar date range, so
    # 'daterange' (which suffixes _from/_to) doesn't fit; 'numberrange' does.
    period_month_min: int | None = Query(None),
    period_month_max: int | None = Query(None),
    net_pay_min: Decimal | None = Query(None),
    net_pay_max: Decimal | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),  # Appendix B: status filters are multi-select, never single-select
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[PayslipOut] | Response:
    filters_applied = {
        "financial_year_id": financial_year_id, "period_month_min": period_month_min, "period_month_max": period_month_max,
        "net_pay_min": net_pay_min, "net_pay_max": net_pay_max, "status": status_filter,
    }
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        if format:
            return await list_export.build_export(format, db, current_user, "My Payslips", _MY_LIST_COLUMNS, [], filters_applied)
        return []
    stmt = select(Payslip).where(Payslip.employee_id == own_id)
    if financial_year_id:
        stmt = stmt.where(Payslip.financial_year_id == financial_year_id)
    if period_month_min:
        stmt = stmt.where(Payslip.period_month >= period_month_min)
    if period_month_max:
        stmt = stmt.where(Payslip.period_month <= period_month_max)
    if net_pay_min is not None:
        stmt = stmt.where(Payslip.net_pay >= net_pay_min)
    if net_pay_max is not None:
        stmt = stmt.where(Payslip.net_pay <= net_pay_max)
    if status_filter:
        stmt = stmt.where(Payslip.status.in_(status_filter))
    rows = (await db.execute(stmt.order_by(Payslip.pay_period_end.desc()))).scalars().all()

    if format:
        # §2.2: "Export to PDF/Excel of the filtered payslip list — the
        # periods and totals" — separate from the per-payslip PDF Download,
        # answering a different question (list overview vs. one document).
        export_rows = [
            {
                "period": f"{r.period_month}/{r.period_year}", "net": r.net_pay, "status": r.status,
                "date_processed": r.generated_at,
            }
            for r in rows
        ]
        return await list_export.build_export(format, db, current_user, "My Payslips", _MY_LIST_COLUMNS, export_rows, filters_applied)

    obscure = await _hide_adhoc_labels_from_employee(db)
    return await _to_outs(db, list(rows), obscure_adhoc_labels=obscure)


@router.get("/payslips/me/{payslip_id}", response_model=PayslipOut)
async def get_my_payslip(
    payslip_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PAYSLIPS)),
) -> PayslipOut:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    row = await db.get(Payslip, payslip_id)
    if row is None or row.employee_id != own_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await _to_out(db, row, obscure_adhoc_labels=await _hide_adhoc_labels_from_employee(db))


# ============================================================ ADMIN PAYSLIPS
@router.get("/payslips", response_model=None)
async def list_all_payslips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(ADMIN_PAYSLIPS)),
    employee_id: str | None = Query(None),
    period_month: int | None = Query(None),
    financial_year_id: str | None = Query(None),
    department_id: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    # §2.3: "Designation (not yet wired)." No designation_id FK exists on
    # this table, only designation_snapshot (text, captured at generation
    # time — deliberately: it's what a payslip PRINTED, which can honestly
    # differ from an employee's CURRENT designation after a promotion). So
    # this matches the snapshot text against the chosen Designation's own
    # current name, same honest-snapshot reasoning as designation_snapshot's
    # own existence — not a schema gap to migrate around.
    designation: str | None = Query(None, description="Matches Designation snapshot exactly, by name"),
    status_filter: list[str] | None = Query(None, alias="status"),  # Appendix B: status filters are multi-select, never single-select
    net_pay_min: Decimal | None = Query(None),
    net_pay_max: Decimal | None = Query(None),
    has_adhoc_adjustments: bool | None = Query(None),
    has_unpaid_leave: bool | None = Query(None),
    # §2.3: Super Admin's own extra filters — "Created By" is generated_by
    # (whoever confirmed the run/reissue that brought this payslip into
    # existence), "Last Modified By" is AuditMixin's own updated_by.
    created_by: str | None = Query(None),
    updated_by: str | None = Query(None),
    search: str | None = Query(None, description="Matches Employee Name or Employee Code"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[PayslipOut] | Response:
    stmt = select(Payslip)
    if employee_id:
        stmt = stmt.where(Payslip.employee_id == employee_id)
    if period_month:
        stmt = stmt.where(Payslip.period_month == period_month)
    if financial_year_id:
        stmt = stmt.where(Payslip.financial_year_id == financial_year_id)
    if department_id:
        stmt = stmt.where(Payslip.department_id == department_id)
    if employment_type_id:
        stmt = stmt.where(Payslip.employment_type_id == employment_type_id)
    if designation:
        stmt = stmt.where(Payslip.designation_snapshot == designation)
    if status_filter:
        stmt = stmt.where(Payslip.status.in_(status_filter))
    if net_pay_min is not None:
        stmt = stmt.where(Payslip.net_pay >= net_pay_min)
    if net_pay_max is not None:
        stmt = stmt.where(Payslip.net_pay <= net_pay_max)
    if has_adhoc_adjustments is not None:
        stmt = stmt.where(Payslip.has_adhoc_adjustments == has_adhoc_adjustments)
    if has_unpaid_leave is not None:
        stmt = stmt.where(Payslip.has_unpaid_leave == has_unpaid_leave)
    if created_by:
        stmt = stmt.where(Payslip.generated_by == created_by)
    if updated_by:
        stmt = stmt.where(Payslip.updated_by == updated_by)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(Payslip.employee_name_snapshot.ilike(pattern) | Payslip.employee_code_snapshot.ilike(pattern))
    rows = (await db.execute(stmt.order_by(Payslip.pay_period_end.desc()))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered/searched set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        export_rows = [
            {
                "employee": r.employee_name_snapshot, "period": f"{r.period_month}/{r.period_year}",
                "gross": r.gross_pay, "net": r.net_pay, "status": r.status,
            }
            for r in rows
        ]
        filters_applied = {
            "employee_id": employee_id, "period_month": period_month, "financial_year_id": financial_year_id,
            "department_id": department_id, "employment_type_id": employment_type_id, "designation": designation,
            "status": status_filter, "net_pay_min": net_pay_min, "net_pay_max": net_pay_max,
            "has_adhoc_adjustments": has_adhoc_adjustments, "has_unpaid_leave": has_unpaid_leave,
            "created_by": created_by, "updated_by": updated_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Payslips", _LIST_COLUMNS, export_rows, filters_applied)

    return await _to_outs(db, list(rows))


@router.get("/payslips/{payslip_id}", response_model=PayslipOut)
async def get_payslip(
    payslip_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(ADMIN_PAYSLIPS)),
) -> PayslipOut:
    row = await db.get(Payslip, payslip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await _to_out(db, row)


@router.get("/payslips/{payslip_id}/pdf")
async def download_payslip_pdf(
    payslip_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PAYSLIPS)),
) -> Response:
    """§2.2's "Download" button (self-service) and §2.3's "View" (Accountant/
    HR/Super Admin) both resolve to this one formatted, letterheaded
    document, per the OFFICIAL DOCUMENT RULE (Appendix B) — gated here by
    ownership OR the admin screen, the same self-or-admin shape
    employee_lifecycle.py's withdraw_resignation already uses.
    """
    payslip = await db.get(Payslip, payslip_id)
    if payslip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id != payslip.employee_id:
        admin_perms = await resolve_permission(db, current_user, ADMIN_PAYSLIPS)
        if not admin_perms.visible:
            raise HTTPException(status.HTTP_404_NOT_FOUND)

    earning_lines = (
        await db.execute(select(PayslipEarningLine).where(PayslipEarningLine.payslip_id == payslip.id, PayslipEarningLine.show_on_payslip.is_(True)).order_by(PayslipEarningLine.sequence))
    ).scalars().all()
    statutory_lines = (
        await db.execute(
            select(PayslipStatutoryLine).where(
                PayslipStatutoryLine.payslip_id == payslip.id, PayslipStatutoryLine.show_on_payslip_snapshot.is_(True), PayslipStatutoryLine.borne_by == "EMPLOYEE",
            ).order_by(PayslipStatutoryLine.sequence)
        )
    ).scalars().all()
    adjustment_lines = (await db.execute(select(PayslipAdjustmentLine).where(PayslipAdjustmentLine.payslip_id == payslip.id).order_by(PayslipAdjustmentLine.sequence))).scalars().all()
    # Same "Hide Ad-hoc Adjustment Labels from Employee" toggle _to_out
    # applies (see that function's own comment) — this is the self-service
    # Download's own PDF row-building path, which reads label_snapshot
    # directly rather than going through _to_out, so it needs the same
    # in-memory mutation applied here. own_id == payslip.employee_id is
    # exactly the "this IS the self-service Download, not the admin View"
    # signal already computed above for the 404-vs-continue check.
    if own_id == payslip.employee_id and await _hide_adhoc_labels_from_employee(db):
        for line in adjustment_lines:
            line.label_snapshot = "Adjustment"
    company, logo = await pdf_engine.company_logo_bytes(db)

    # QUEUED / NOT FIXABLE YET — §6 "nothing hardcoded": every money figure
    # below (earnings, deductions, gross/net pay) is formatted with a
    # literal "₹", and this whole block bypasses pdf_engine._money (which
    # independently hardcodes the same "₹" literal — a separate, already-
    # tracked gap in that module) rather than sharing one formatter with it.
    # Not fixable now because there is nowhere dynamic to source the symbol
    # from: `CompanyProfile` (backend/app/models/masters.py:286
    # `class CompanyProfile(Base, AuditMixin)`) has no currency field at
    # all — no currency_code, no currency_symbol — so routing through
    # `company` here would still mean hardcoding. Needs, in order: (1) a
    # currency column added to CompanyProfile via migration, (2) a shared
    # `pdf_engine.money(value, company)` helper that reads it (replacing
    # both this file's inline f"₹{...}" literals and pdf_engine._money's
    # own hardcoded one), then this file's ~12 call sites (here, and the
    # Salary Certificate section below) switch to calling it.
    earning_rows = [(el.label, f"₹{el.amount:,.2f}") for el in earning_lines]
    for al in adjustment_lines:
        if al.adjustment_type == "ADDITION":
            earning_rows.append((al.label_snapshot, f"₹{al.amount:,.2f}"))
    earning_rows.append(("Total Earnings", f"₹{payslip.total_earnings:,.2f}"))

    deduction_rows = [(sl.print_label_snapshot, f"₹{sl.computed_amount:,.2f}") for sl in statutory_lines]
    if payslip.insurance_employee_contribution > 0:
        deduction_rows.append(("Insurance Employee Contribution", f"₹{payslip.insurance_employee_contribution:,.2f}"))
    if payslip.income_tax_amount > 0:
        deduction_rows.append(("Income Tax", f"₹{payslip.income_tax_amount:,.2f}"))
    if payslip.unpaid_leave_deduction > 0:
        deduction_rows.append(("Unpaid Leave Deduction", f"₹{payslip.unpaid_leave_deduction:,.2f}"))
    if payslip.lop_deduction > 0:
        deduction_rows.append(("Loss of Pay Deduction", f"₹{payslip.lop_deduction:,.2f}"))
    for al in adjustment_lines:
        if al.adjustment_type == "SUBTRACTION":
            deduction_rows.append((al.label_snapshot, f"₹{al.amount:,.2f}"))
    deduction_rows.append(("Total Deductions", f"₹{payslip.total_deductions:,.2f}"))

    sections = [
        (
            "Employee Details",
            [
                ("Employee Name", payslip.employee_name_snapshot),
                ("Employee Code", payslip.employee_code_snapshot),
                ("Department", payslip.department_snapshot or "—"),
                ("Designation", payslip.designation_snapshot or "—"),
                ("Pay Period Covers", f"{payslip.pay_period_start} to {payslip.pay_period_end}"),
                ("Salary Credit Date", str(payslip.salary_credit_date)),
            ],
        ),
        ("Earnings", earning_rows),
        ("Deductions", deduction_rows),
        (
            "Net Pay Summary",
            [
                ("Gross Pay", f"₹{payslip.gross_pay:,.2f}"),
                ("Total Earnings", f"₹{payslip.total_earnings:,.2f}"),
                ("Total Deductions", f"₹{payslip.total_deductions:,.2f}"),
                ("Net Pay", f"₹{payslip.net_pay:,.2f}"),
            ],
        ),
    ]
    content = pdf_engine.render_document_pdf(f"Payslip — {payslip.period_month}/{payslip.period_year}", company, sections, logo)

    stored = file_storage.save_upload(content, file_storage.content_hash_of(content), f"payslip_{payslip.employee_code_snapshot}_{payslip.period_month}_{payslip.period_year}.pdf", "application/pdf", current_user.id)
    db.add(stored)
    await db.flush()
    payslip.pdf_file_id = stored.id
    payslip.updated_by = current_user.id
    await db.commit()
    await db.refresh(payslip)

    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="Payslip_{payslip.employee_code_snapshot}_{payslip.period_month}_{payslip.period_year}.pdf"'})


@router.post("/payslips/{payslip_id}/reissue", response_model=PayslipReissueOut)
async def reissue_payslip(
    payslip_id: str,
    body: ReissueRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(ADMIN_PAYSLIPS, action="reissue")),
) -> PayslipReissue:
    """§2.3 / A119: recalculation OR manual figure adjustment, a required
    Reason either way, and a Reissue History entry (old figures alongside
    new). Recalculation reuses the SAME calculation pass Run Payroll itself
    uses (payroll_runs._calculate_employee), so a reissue can never drift
    from how a fresh run would compute the same period.

    §6.1 "Require Super Admin Approval to Reissue a Payslip" — OFF by
    default (Accountant/HR reissue directly, the historical behavior).
    ON: reissuing is restricted to Super Admin outright, rather than a genuine
    async "Accountant/HR requests, Super Admin approves later" queue —
    deliberately narrower than the doc's own "sign-off first" phrasing, and
    disclosed as such rather than silently built as something it isn't. The
    async version is blocked by two existing CHECK constraints from this
    table's original migration (0004_payroll.py): ck_reissue_approval
    requires approved_by to be set WHENEVER approval_required is true — so a
    row can never represent "required but not yet given" at insert time —
    and ck_payslip_status allows only ('PROCESSED','REISSUED'), no third
    "reissue pending" state for the payslip itself to sit in while it waits.
    payslip_reissues is also append-only (trg_reissue_append_only), so there
    is no later UPDATE that could add an approval after the fact either.
    Widening either constraint is a real migration touching a live-money
    table's existing rows, not something to do as a side effect of one
    toggle — Super-Admin-only reissuing is what §6.1's actual schema
    supports today: the approval IS Super Admin being the one who acts.
    """
    payslip = await db.get(Payslip, payslip_id)
    if payslip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not body.reason.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reissue a payslip")

    require_sa_approval = (
        await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == "Require Super Admin Approval to Reissue a Payslip"))
    ).scalar_one_or_none()
    approval_required = bool(require_sa_approval)
    if approval_required and perms.role_code != "SUPER_ADMIN":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="'Require Super Admin Approval to Reissue a Payslip' is on — only Super Admin may reissue a payslip while this is enabled.",
        )

    old_gross, old_earnings, old_deductions, old_net = payslip.gross_pay, payslip.total_earnings, payslip.total_deductions, payslip.net_pay
    old_income_tax, old_paid_days, old_lop_days = payslip.income_tax_amount, payslip.paid_days, payslip.lop_days

    if body.reissue_method == "RECALCULATED":
        from app.api.v1.payroll_runs import _calculate_employee

        run = await db.get(PayrollRun, payslip.payroll_run_id)
        run_employee = await db.get(PayrollRunEmployee, payslip.payroll_run_employee_id)
        employee = await db.get(Employee, payslip.employee_id)
        fy = await db.get(FinancialYear, payslip.financial_year_id)
        recomputed, _calc = await _calculate_employee(db, employee, run, fy, skip_already_processed_check=True)

        # _calculate_employee's ad-hoc block only sees CURRENTLY-PENDING
        # targets — it can't see what THIS payslip actually applied at its
        # original Confirm (a one-time adjustment is already
        # APPLIED/CONSUMED by then, so it silently drops out of the
        # recompute), and would fold in any adjustment that became pending
        # afterward without ever persisting a line for it or marking it
        # applied — a double-application risk on a later run/reissue.
        # Reissue's own spec wording is "recalculate from updated
        # attendance/leave data" (§2.3), not ad-hoc adjustments, so strip the
        # recompute's ad-hoc contribution back out and substitute this
        # payslip's own existing, already-persisted ad-hoc lines instead —
        # ad-hoc money must never move as a side effect of reissuing.
        existing_adjustment_lines = (
            await db.execute(select(PayslipAdjustmentLine).where(PayslipAdjustmentLine.payslip_id == payslip.id))
        ).scalars().all()
        existing_adhoc_addition = sum((l.amount for l in existing_adjustment_lines if l.adjustment_type == "ADDITION"), Decimal("0"))
        existing_adhoc_subtraction = sum((l.amount for l in existing_adjustment_lines if l.adjustment_type == "SUBTRACTION"), Decimal("0"))
        recomputed.total_earnings = recomputed.total_earnings - recomputed.adhoc_addition_total + existing_adhoc_addition
        recomputed.adhoc_addition_total = existing_adhoc_addition
        recomputed.adhoc_subtraction_total = existing_adhoc_subtraction

        # recomputed is a transient object _calculate_employee never adds/
        # flushes — paid_days/total_deductions/net_pay are real MySQL
        # GENERATED columns, so they're simply unset on it (None), not
        # lazy-loadable. Write the plain fields onto the real run_employee
        # row (same identity, same pattern as confirm_payroll_run), flush +
        # refresh so MySQL computes those columns, then copy from there.
        recomputed.id = run_employee.id
        for field, value in vars(recomputed).items():
            if not field.startswith("_"):
                setattr(run_employee, field, value)
        run_employee.updated_by = current_user.id
        await db.flush()
        await db.refresh(run_employee)

        payslip.gross_pay = run_employee.gross_pay
        payslip.total_earnings = run_employee.total_earnings
        payslip.total_deductions = run_employee.total_deductions
        payslip.net_pay = run_employee.net_pay
        payslip.income_tax_amount = run_employee.income_tax_amount
        payslip.unpaid_leave_deduction = run_employee.unpaid_leave_deduction
        payslip.lop_deduction = run_employee.lop_deduction
        payslip.paid_days = run_employee.paid_days
        payslip.unpaid_leave_days = run_employee.unpaid_leave_days
        payslip.lop_days = run_employee.lop_days
    elif body.reissue_method == "MANUAL_ADJUSTMENT":
        # ReissueRequest._manual_figures_must_reconcile (schemas/payroll.py)
        # has already guaranteed that the three figures below were supplied
        # together, are non-negative, and satisfy the same
        # net = earnings - deductions identity payroll_run_employees.net_pay
        # is a GENERATED column of — so this can no longer persist a payslip
        # whose stated Net Pay bears no relation to its own earnings and
        # deductions. gross_pay does not participate in that identity (it is
        # the structure's monthly gross, which ad-hoc additions legitimately
        # sit above), so it stays optional — bounded to >= 0 by the same
        # validator.
        if body.manual_gross_pay is not None:
            payslip.gross_pay = body.manual_gross_pay
        payslip.total_earnings = body.manual_total_earnings
        payslip.total_deductions = body.manual_total_deductions
        payslip.net_pay = body.manual_net_pay
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="reissue_method must be RECALCULATED or MANUAL_ADJUSTMENT")

    payslip.updated_by = current_user.id
    reissued_at = datetime.now(timezone.utc)
    payslip.status = "REISSUED"
    payslip.last_reissued_at = reissued_at

    # Captured into plain locals — send_templated_email() below commits
    # internally, which expires every attribute on `payslip`/`employee`;
    # reading one back off the ORM object afterwards (instead of these
    # locals) would trip MissingGreenlet, the same async-ORM/expire
    # interaction payroll_runs.py documents at length.
    new_gross, new_earnings, new_deductions, new_net = payslip.gross_pay, payslip.total_earnings, payslip.total_deductions, payslip.net_pay
    new_income_tax, new_paid_days, new_lop_days = payslip.income_tax_amount, payslip.paid_days, payslip.lop_days
    payslip_id, payslip_financial_year_id, payslip_employee_id = payslip.id, payslip.financial_year_id, payslip.employee_id
    period_label = f"{payslip.period_month}/{payslip.period_year}"

    employee = await db.get(Employee, payslip_employee_id)
    employee_user_id = employee.user_id if employee is not None else None
    employee_email = employee.email if employee is not None else None
    employee_first_name = employee.first_name if employee is not None else None

    # §2.3 / A119 / §6.1: "unless turned off — the employee is notified of
    # the correction." Gated on the same FeatureToggle row every other
    # payroll toggle in this file reads directly — default True
    # (TOGGLE_DEFAULTS), matching "ON by default" here. payslip_reissues is
    # append-only (a DB trigger rejects any UPDATE), so — unlike every other
    # trigger site in this codebase, which calls send_templated_email()
    # AFTER its own primary commit — this one must call it BEFORE building
    # the row and bake the real outcome into the one-time INSERT below:
    # there's no later UPDATE that could ever correct a pre-asserted
    # "notified=True" if the send had actually failed. When the toggle is
    # OFF, both the email and the in-app notify() below are skipped
    # entirely — a "silent correction" that only suppressed one of the two
    # channels would not actually be silent.
    notify_on_reissue = (
        await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == "Notify Employee When a Payslip Is Reissued"))
    ).scalar_one_or_none()
    notify_on_reissue = True if notify_on_reissue is None else notify_on_reissue

    employee_notified = False
    notified_at = None
    notification_email_send_log_id = None
    if notify_on_reissue and employee_email:
        email_log = await email_transport.send_templated_email(
            db, "payslip_reissued", employee_email, {"first_name": employee_first_name, "month": period_label},
            related_record_type="payslip", related_record_id=payslip_id,
        )
        if email_log is not None:
            notification_email_send_log_id = email_log.id
            if email_log.delivery_status == "SENT":
                employee_notified = True
                notified_at = email_log.sent_at

    # Re-queried after the email round trip (whose internal commit released
    # the WITH FOR UPDATE lock this select takes) so the sequence number
    # still reflects the latest state immediately before this INSERT.
    reissue_number = 1 + (
        await db.execute(select(PayslipReissue.id).where(PayslipReissue.payslip_id == payslip_id).with_for_update())
    ).scalars().all().__len__()
    payslip.reissue_count = reissue_number

    # payslip_reissues is append-only (DB trigger rejects any UPDATE) — every
    # field, including notified_at, must be set before the single INSERT,
    # never mutated on the object afterward. ck_reissue_approval requires
    # approved_by whenever approval_required is true (see this function's
    # own docstring) — satisfied here because Super Admin performing the
    # reissue IS the approval, recorded against themselves at the same
    # instant, never a separately-recorded sign-off.
    reissue = PayslipReissue(
        id=str(uuid.uuid4()), payslip_id=payslip_id, financial_year_id=payslip_financial_year_id, reissue_number=reissue_number,
        reason=body.reason, reissue_method=body.reissue_method, old_gross_pay=old_gross, new_gross_pay=new_gross,
        old_total_earnings=old_earnings, new_total_earnings=new_earnings, old_total_deductions=old_deductions,
        new_total_deductions=new_deductions, old_net_pay=old_net, new_net_pay=new_net,
        old_income_tax_amount=old_income_tax, new_income_tax_amount=new_income_tax, old_paid_days=old_paid_days,
        new_paid_days=new_paid_days, old_lop_days=old_lop_days, new_lop_days=new_lop_days,
        line_change_summary=f"Net Pay {old_net} -> {new_net} ({body.reissue_method})",
        reissued_by=current_user.id, reissued_at=reissued_at, employee_notified=employee_notified, notified_at=notified_at,
        notification_email_send_log_id=notification_email_send_log_id,
        approval_required=approval_required, approved_by=current_user.id if approval_required else None,
        approved_at=reissued_at if approval_required else None,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(reissue)

    if notify_on_reissue:
        notify(
            db, recipient_user_id=employee_user_id, notification_type="PAYSLIP", actor_user_id=current_user.id,
            title="Your payslip was corrected", body=f"Your payslip for {period_label} was reissued. New Net Pay: {new_net}.",
            source_module="payroll", source_record_id=payslip_id,
        )

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(reissue)
    return reissue


# ========================================================= SALARY CERTIFICATES
@router.post("/salary-certificates", response_model=SalaryCertificateRequestOut, status_code=status.HTTP_201_CREATED)
async def request_salary_certificate(
    body: SalaryCertificateRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PAYSLIPS)),
    employee_id: str | None = Query(None, description="Accountant/HR/Super Admin only — generate on behalf of a different employee; requires payroll.payslips_admin"),
) -> SalaryCertificateRequest:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    target_id = own_id
    if employee_id and employee_id != own_id:
        # Same self-or-admin shape as download_payslip_pdf above: the caller's
        # own self-service path (no employee_id) keeps working for every role
        # already granted payroll.my_payslips; requesting someone ELSE'S
        # certificate additionally requires the admin Payslip screen.
        admin_perms = await resolve_permission(db, current_user, ADMIN_PAYSLIPS)
        if not admin_perms.visible:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not permitted to generate a salary certificate for another employee")
        target_id = employee_id

    if target_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    employee = await db.get(Employee, target_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Employee not found")
    fy = await get_current_financial_year(db)
    structure = (await db.execute(select(SalaryStructure).where(SalaryStructure.employee_id == target_id, SalaryStructure.effective_to.is_(None)))).scalar_one_or_none()
    profile = (await db.execute(select(CompanyProfile))).scalars().first()
    department = await db.get(Department, employee.department_id)
    designation = await db.get(Designation, employee.designation_id)

    row = SalaryCertificateRequest(
        id=str(uuid.uuid4()), employee_id=target_id, financial_year_id=fy.id, requested_by=current_user.id,
        requested_at=datetime.now(timezone.utc), purpose=body.purpose, salary_structure_id=structure.id if structure else None,
        employee_name_snapshot=f"{employee.first_name} {employee.last_name or ''}".strip(), employee_code_snapshot=employee.employee_code,
        designation_snapshot=designation.name if designation else None, department_snapshot=department.name if department else None,
        joining_date_snapshot=employee.joining_date, basic_salary_snapshot=structure.basic_salary_monthly if structure else None,
        gross_monthly_snapshot=structure.gross_monthly if structure else None, net_monthly_snapshot=structure.net_monthly if structure else None,
        annual_ctc_snapshot=structure.annual_ctc if structure else None, company_name_snapshot=profile.legal_name if profile else None,
        generated_at=datetime.now(timezone.utc), created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    await db.flush()

    # §2.2's "Download Salary Certificate" — a formal letter pulling Employee
    # + Company Profile letterhead + the current Salary Structure, per the
    # OFFICIAL DOCUMENT RULE (Appendix B).
    _, logo = await pdf_engine.company_logo_bytes(db)
    sections = [
        (
            "",
            [
                ("Employee Name", row.employee_name_snapshot),
                ("Employee Code", row.employee_code_snapshot),
                ("Designation", row.designation_snapshot or "—"),
                ("Department", row.department_snapshot or "—"),
                ("Joining Date", str(row.joining_date_snapshot) if row.joining_date_snapshot else "—"),
                ("Purpose", row.purpose or "General Purpose"),
            ],
        ),
        (
            # Same hardcoded-"₹" gap as download_payslip_pdf above (see the
            # comment at that function's earning_rows line for the full
            # explanation) — CompanyProfile has no currency field to read
            # instead, so these four literals stay as-is until one exists.
            "Salary Details",
            [
                ("Basic Salary (Monthly)", f"₹{row.basic_salary_snapshot:,.2f}" if row.basic_salary_snapshot is not None else "—"),
                ("Gross Salary (Monthly)", f"₹{row.gross_monthly_snapshot:,.2f}" if row.gross_monthly_snapshot is not None else "—"),
                ("Net Salary (Monthly)", f"₹{row.net_monthly_snapshot:,.2f}" if row.net_monthly_snapshot is not None else "—"),
                ("Annual CTC", f"₹{row.annual_ctc_snapshot:,.2f}" if row.annual_ctc_snapshot is not None else "—"),
            ],
        ),
    ]
    content = pdf_engine.render_document_pdf(f"Salary Certificate — {row.employee_name_snapshot}", profile, sections, logo)
    stored = file_storage.save_upload(content, file_storage.content_hash_of(content), f"salary_certificate_{row.employee_code_snapshot}_{row.id}.pdf", "application/pdf", current_user.id)
    db.add(stored)
    await db.flush()
    row.pdf_file_id = stored.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.get("/salary-certificates/me", response_model=list[SalaryCertificateRequestOut])
async def list_my_salary_certificates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PAYSLIPS)),
) -> list[SalaryCertificateRequest]:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    rows = (await db.execute(select(SalaryCertificateRequest).where(SalaryCertificateRequest.employee_id == own_id).order_by(SalaryCertificateRequest.requested_at.desc()))).scalars().all()
    return list(rows)
