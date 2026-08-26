"""Payroll §2.1 Run Payroll (+ Payroll History), §3.1/3.1a/3.1b. The core
monthly hour-basis calculation — A115's unpaid-leave formula, A116's
per-employee+month already-Processed skip, and the 27-07-2026 pay-cycle
carryover all come together here, on top of app/services/payroll_engine.py,
app/services/hour_reconciliation.py, leave_engine.calculate_working_days
and tax_engine.calculate_tax (unchanged, reused exactly as Employee's
Salary Structure already does).

Preview-before-confirm (UI/UX Notes §4: "must be impossible to skip") is
structural here, not a UI convention this API could violate: create_run
ALWAYS lands in DRAFT with the full calculation already done; there is no
endpoint that goes straight from a Month/Year selection to generated
payslips. Only confirm_run (a separate, explicit call) generates them.
"""

import calendar
import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Employee, EmployeeInsuranceEnrollment, SalaryStructureStatutoryLine, TaxDeclaration, TaxDeclarationLine
from app.models.leave import LeaveRequest
from app.models.masters import Department, Designation, EmploymentType, PayCycle, TaxHead, TaxHeadReliefRule, TaxHeadSlabBand, WorkWeekPolicy
from app.models.numbering import FinancialYear
from app.models.payroll import (
    AdhocAdjustmentEmployee,
    AdhocPayslipAdjustment,
    MonthlyHourReconciliation,
    Payslip,
    PayslipAdjustmentLine,
    PayslipEarningLine,
    PayslipStatutoryLine,
    PayrollRun,
    PayrollRunEmployee,
)
from app.models.employee import SalaryStructure
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.payroll import PayrollRunCreate, PayrollRunOut
from app.services import email_transport, list_export, tax_engine
from app.services.hour_reconciliation import reconcile_employee_period
from app.services.notify import notify
from app.services.payroll_engine import calculate_unpaid_leave_deduction, compute_income_tax, convert_shortfall, prorate_gross_for_partial_period, resolve_pay_period
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/payroll/runs", tags=["payroll"])
SCREEN = "payroll.run"

_LIST_COLUMNS = [
    ColumnSpec("period", "Period"),
    ColumnSpec("status", "Status"),
    ColumnSpec("total_gross", "Total Gross", align="left"),
    ColumnSpec("total_net", "Total Net", align="left"),
    ColumnSpec("employee_count", "Employee Count", align="right"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _tax_head_snapshot(db: AsyncSession, head: TaxHead) -> tax_engine.TaxHeadSnapshot:
    bands = (await db.execute(select(TaxHeadSlabBand).where(TaxHeadSlabBand.tax_head_id == head.id))).scalars().all()
    reliefs = (await db.execute(select(TaxHeadReliefRule).where(TaxHeadReliefRule.tax_head_id == head.id, TaxHeadReliefRule.is_active.is_(True)))).scalars().all()
    return tax_engine.TaxHeadSnapshot(
        tax_name=head.tax_name, tax_type=head.tax_type, applies_from=head.applies_from, applies_until=head.applies_until,
        rate_pct=head.rate_pct, fixed_amount=head.fixed_amount, slab_application=head.slab_application,
        slab_bands=tuple(tax_engine.SlabBand(b.sequence_no, b.band_from, b.band_to, b.rate_or_amount) for b in bands),
        relief_rules=tuple(tax_engine.ReliefRule(r.relief_name, r.applies_if_base_at_or_below, r.relief_type, r.relief_amount) for r in reliefs),
        print_label=head.print_label,
    )


async def _in_force_heads(db: AsyncSession, scopes: tuple[str, ...], as_of: date_type, scheme_id: str | None = None) -> list[TaxHead]:
    heads = (
        await db.execute(select(TaxHead).where(TaxHead.scope.in_(scopes), TaxHead.is_active.is_(True), TaxHead.applies_from <= as_of))
    ).scalars().all()
    heads = [h for h in heads if h.applies_until is None or h.applies_until >= as_of]
    # A125/Appendix B ("STATUTORY APPLICABILITY... the employee's tax scheme
    # if schemes are in use"): a head tied to a specific scheme
    # (tax_scheme_id set) only applies to someone who actually elected that
    # scheme; a scheme-agnostic head (NULL) applies regardless. Previously
    # unfiltered — every head applied to every employee no matter which
    # scheme (if any) they'd elected via EmployeeTaxSchemeElection.
    return [h for h in heads if h.tax_scheme_id is None or h.tax_scheme_id == scheme_id]


async def _resolve_employee_tax_scheme_id(db: AsyncSession, employee_id: str, financial_year_id: str) -> str | None:
    from app.models.employee import EmployeeTaxSchemeElection

    return (
        await db.execute(
            select(EmployeeTaxSchemeElection.tax_scheme_id).where(
                EmployeeTaxSchemeElection.employee_id == employee_id, EmployeeTaxSchemeElection.financial_year_id == financial_year_id,
                EmployeeTaxSchemeElection.superseded_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def _working_days_for_employee_in_range(db: AsyncSession, employee: Employee, from_date: date_type, to_date: date_type) -> Decimal:
    """Recomputes a working-day count for an arbitrary sub-range using the
    exact same policy-resolution + Holiday/SaturdayOverride construction
    leave_requests.py's create endpoint uses for the full request — needed
    to clip a leave request's days_requested to the portion actually inside
    a given pay period. Appendix B's cutoff-reconciliation rule ("any event
    with a date falling after the End Day belongs to the NEXT pay period...
    applies UNIFORMLY to EVERY dated input Payroll reads") is not special to
    single-day events; a multi-day request spanning a cutoff must be split
    between the two periods it touches, never counted in full by both.
    """
    if from_date > to_date:
        return Decimal("0")
    from app.models.masters import Holiday, SaturdayOverride
    from app.services.attendance_engine import WorkWeekPolicySnapshot
    from app.services.leave_engine import calculate_working_days
    from app.services.policy_resolution import resolve_policy_for_employee

    policy = await resolve_policy_for_employee(db, employee, from_date)
    if policy is None:
        return Decimal("0")
    mandatory_dates = set(
        (await db.execute(select(Holiday.holiday_date).where(Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True), Holiday.holiday_date >= from_date, Holiday.holiday_date <= to_date))).scalars()
    )
    overrides = (
        await db.execute(select(SaturdayOverride).where(SaturdayOverride.saturday_date >= from_date, SaturdayOverride.saturday_date <= to_date, (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None))))
    ).scalars().all()
    override_dates = {o.saturday_date: (o.override_to == "WORKING") for o in overrides}
    snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day, grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours, weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule, working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours, mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )
    return calculate_working_days(from_date, to_date, False, snapshot, mandatory_dates, override_dates)


async def _resolve_financial_year(db: AsyncSession, as_of: date_type) -> FinancialYear:
    fy = (await db.execute(select(FinancialYear).where(FinancialYear.start_date <= as_of, FinancialYear.end_date >= as_of))).scalar_one_or_none()
    if fy is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"No Financial Year covers {as_of} — Super Admin must add one in Masters first")
    return fy


class _EmployeeCalculation:
    def __init__(self):
        self.earning_lines: list[dict] = []
        self.statutory_lines: list[dict] = []
        self.adjustment_lines: list[dict] = []


async def _calculate_employee(
    db: AsyncSession, employee: Employee, run: PayrollRun, fy: FinancialYear, *, skip_already_processed_check: bool = False,
) -> tuple[PayrollRunEmployee, _EmployeeCalculation]:
    calc = _EmployeeCalculation()

    # Reissue's RECALCULATED method (payslips.py) calls this on a payslip
    # that is, by definition, already Processed for this employee+period —
    # the whole point is to recompute it, not to have the A116 guard treat
    # its own target row as a reason to skip. Draft/Recalculate/Confirm all
    # want the guard active (skip_already_processed_check=False, default).
    already_processed = (
        None if skip_already_processed_check else (
            await db.execute(
                select(PayrollRunEmployee.id).where(
                    PayrollRunEmployee.employee_id == employee.id, PayrollRunEmployee.period_year == run.period_year,
                    PayrollRunEmployee.period_month == run.period_month, PayrollRunEmployee.status == "PROCESSED",
                )
            )
        ).first()
    )
    structure = (
        await db.execute(select(SalaryStructure).where(SalaryStructure.employee_id == employee.id, SalaryStructure.effective_to.is_(None)))
    ).scalar_one_or_none()

    row = PayrollRunEmployee(
        id=str(uuid.uuid4()), payroll_run_id=run.id, employee_id=employee.id, financial_year_id=fy.id,
        period_month=run.period_month, period_year=run.period_year, total_days_in_period=run.total_days_in_period,
        working_days=run.working_days_effective, calculated_at=datetime.now(timezone.utc),
    )
    if already_processed:
        row.inclusion_status = "SKIPPED_ALREADY_PROCESSED"
        row.skip_reason = f"Already Processed for {run.period_month}/{run.period_year}"
        return row, calc
    if structure is None:
        row.inclusion_status = "EXCLUDED_NO_SALARY_STRUCTURE"
        row.skip_reason = "No active Salary Structure"
        return row, calc

    row.salary_structure_id = structure.id
    row.gross_monthly_snapshot = structure.gross_monthly

    # Moved ahead of everything else that prices off it (shortfall
    # conversion, earning lines) — was previously computed only just before
    # unpaid_leave_deduction, so those earlier steps priced off the full
    # unprorated structure.gross_monthly for a mid-period joiner/exit.
    days_employed = run.total_days_in_period
    if employee.joining_date > run.pay_period_start:
        days_employed = Decimal((run.pay_period_end - employee.joining_date).days + 1)
    if employee.exit_date is not None and employee.exit_date < run.pay_period_end:
        days_employed = min(days_employed, Decimal((employee.exit_date - max(employee.joining_date, run.pay_period_start)).days + 1))
    if days_employed <= 0:
        # An explicitly-selected employee (SPECIFIC_EMPLOYEES mode) whose
        # employment window doesn't overlap this pay period at all — joined
        # after it ended, or fully exited before it began. Deliberately NOT
        # a blanket employment_status=='ACTIVE' check: someone who exits
        # mid-period (status already flipped to EXITED by the time payroll
        # runs) still has real days_employed > 0 and is correctly INCLUDED
        # for their final prorated pay below.
        row.inclusion_status = "EXCLUDED_NOT_ACTIVE"
        row.skip_reason = "No overlap between employment window and this pay period"
        return row, calc
    row.gross_pay = prorate_gross_for_partial_period(structure.gross_monthly, run.total_days_in_period, days_employed)

    recon = await reconcile_employee_period(db, employee, run.pay_period_start, run.pay_period_end)
    policy = recon.policy if recon else None
    if policy is not None:
        row.work_week_policy_id = policy.id
        row.required_hours = recon.required_hours
        row.worked_hours = recon.worked_hours
        row.comp_credit_hours = recon.comp_credit_hours
        row.leave_credit_hours = recon.leave_credit_hours
        row.comp_pending_hours = recon.comp_pending_hours
        hours_short = max(recon.required_hours - (recon.worked_hours + recon.leave_credit_hours), Decimal("0"))
        row.net_short_hours = max(hours_short - recon.comp_pending_hours, Decimal("0"))

    # Leave §2.1: days-based accounting for the payslip's own Paid/Unpaid
    # split — approved leave requests overlapping this period.
    leave_requests = (
        await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == employee.id, LeaveRequest.status == "APPROVED",
                LeaveRequest.from_date <= run.pay_period_end, LeaveRequest.to_date >= run.pay_period_start,
            )
        )
    ).scalars().all()
    row.paid_leave_days = Decimal("0")
    row.unpaid_leave_days = Decimal("0")
    for lr in leave_requests:
        days = lr.days_requested
        # Appendix B's cutoff-reconciliation rule applies uniformly to every
        # dated input, not just single-day events: a multi-day request that
        # spans a pay-cycle cutoff must be split between the two periods it
        # touches, never counted in full by both. A single-day/half-day
        # request can't partially overlap a period by construction (it's
        # either fully inside or fully outside), so this only re-derives
        # when the request's own range isn't fully inside the period.
        if lr.from_date < run.pay_period_start or lr.to_date > run.pay_period_end:
            days = await _working_days_for_employee_in_range(db, employee, max(lr.from_date, run.pay_period_start), min(lr.to_date, run.pay_period_end))
        if lr.paid_type_snapshot == "PAID":
            row.paid_leave_days += days
        else:
            row.unpaid_leave_days += days

    shortfall = convert_shortfall(
        net_short_hours=row.net_short_hours, net_hours_per_day=(policy.net_working_hours_per_day if policy else Decimal("0")),
        gross_pay=row.gross_pay, total_days_in_period=run.total_days_in_period,
        rule=(policy.uncompensated_shortfall_becomes if policy else "IGNORE"),
    )
    row.lop_days = shortfall.lop_days
    row.lop_deduction = shortfall.lop_deduction
    row.uncompensated_shortfall_rule_snapshot = policy.uncompensated_shortfall_becomes if policy else None

    row.present_days = max(run.working_days_effective - row.paid_leave_days - row.unpaid_leave_days - row.lop_days, Decimal("0"))

    row.unpaid_leave_deduction = calculate_unpaid_leave_deduction(row.gross_pay, run.total_days_in_period, row.unpaid_leave_days)

    # ---------------------------------------------------------- Earnings
    # Each component is prorated by the SAME days_employed/total_days_in_period
    # ratio as row.gross_pay (via the identical prorate_gross_for_partial_period
    # call) — for a full period this returns the amount unchanged, exactly as
    # before. Previously these used the full structure.* amounts unconditionally,
    # so a mid-period joiner/exit's total_earnings (and therefore net_pay,
    # which derives from it) came out roughly double what row.gross_pay
    # correctly prorated to.
    def _prorated(amount: Decimal) -> Decimal:
        return prorate_gross_for_partial_period(amount, run.total_days_in_period, days_employed)

    if structure.basic_salary_monthly > 0:
        calc.earning_lines.append({"component_type": "BASIC", "label": "Basic Salary", "amount": _prorated(structure.basic_salary_monthly), "is_taxable": True, "source": "SALARY_STRUCTURE"})
    if structure.dearness_allowance_monthly > 0:
        calc.earning_lines.append({"component_type": "DEARNESS_ALLOWANCE", "label": "Dearness Allowance", "amount": _prorated(structure.dearness_allowance_monthly), "is_taxable": True, "source": "SALARY_STRUCTURE"})
    if structure.hra_monthly > 0:
        calc.earning_lines.append({"component_type": "HRA", "label": "House Rent Allowance", "amount": _prorated(structure.hra_monthly), "is_taxable": True, "source": "SALARY_STRUCTURE"})
    if structure.lta_amount > 0 and structure.lta_payout_basis == "MONTHLY":
        calc.earning_lines.append({"component_type": "LTA", "label": "Leave Travel Allowance", "amount": _prorated(structure.lta_amount), "is_taxable": True, "source": "SALARY_STRUCTURE"})
    if structure.special_allowance_monthly > 0:
        calc.earning_lines.append({"component_type": "SPECIAL_ALLOWANCE", "label": "Special Allowance", "amount": _prorated(structure.special_allowance_monthly), "is_taxable": True, "source": "SALARY_STRUCTURE"})
    if structure.other_earnings_monthly > 0:
        calc.earning_lines.append({"component_type": "OTHER_EARNINGS", "label": "Other Earnings", "amount": _prorated(structure.other_earnings_monthly), "is_taxable": True, "source": "SALARY_STRUCTURE"})
    row.total_earnings = sum((l["amount"] for l in calc.earning_lines), Decimal("0"))

    # ---------------------------------------------------------- Statutory
    scheme_id = await _resolve_employee_tax_scheme_id(db, employee.id, fy.id)
    row.tax_scheme_id = scheme_id
    heads = await _in_force_heads(db, ("PAYROLL_EMPLOYEE_DEDUCTION", "PAYROLL_EMPLOYER_CONTRIBUTION"), run.pay_period_end, scheme_id)
    structure_lines = (
        await db.execute(select(SalaryStructureStatutoryLine).where(SalaryStructureStatutoryLine.salary_structure_id == structure.id))
    ).scalars().all()
    applicability = {l.tax_head_id: l.is_applicable for l in structure_lines}

    total_employee_statutory = Decimal("0")
    total_employer_statutory = Decimal("0")
    for head in heads:
        if not applicability.get(head.id, True):
            continue
        snapshot = await _tax_head_snapshot(db, head)
        result = tax_engine.calculate_tax(snapshot, row.gross_pay)
        behaviour = head.behaviour or {}
        borne_by = behaviour.get("borne_by") or ("EMPLOYEE" if head.scope == "PAYROLL_EMPLOYEE_DEDUCTION" else "EMPLOYER")
        line = {
            "tax_head_id": head.id, "head_name_snapshot": head.tax_name, "print_label_snapshot": head.print_label or head.tax_name,
            "scope_snapshot": head.scope, "tax_type_snapshot": head.tax_type, "rate_snapshot": head.rate_pct, "fixed_amount_snapshot": head.fixed_amount,
            "slab_application_snapshot": head.slab_application, "computed_base": row.gross_pay, "computed_amount": result.computed_amount,
            "borne_by": borne_by, "reduces_taxable_income_snapshot": bool(behaviour.get("reduces_taxable_income", False)),
            "include_in_ctc_snapshot": bool(behaviour.get("include_in_ctc", False)), "show_on_payslip_snapshot": bool(behaviour.get("show_on_payslip", True)),
            "per_employee_applicable_snapshot": applicability.get(head.id, True),
        }
        calc.statutory_lines.append(line)
        if borne_by == "EMPLOYEE":
            total_employee_statutory += result.computed_amount
        else:
            total_employer_statutory += result.computed_amount
    row.total_employee_statutory = total_employee_statutory
    row.total_employer_statutory = total_employer_statutory

    # ------------------------------------------------------------ Insurance
    enrollments = (
        await db.execute(select(EmployeeInsuranceEnrollment).where(EmployeeInsuranceEnrollment.employee_id == employee.id, EmployeeInsuranceEnrollment.status == "ACTIVE"))
    ).scalars().all()
    row.insurance_employee_contribution = sum((e.employee_contribution_monthly_snapshot for e in enrollments), Decimal("0"))
    row.insurance_employer_contribution = sum((e.company_contribution_monthly_snapshot for e in enrollments), Decimal("0"))

    # ---------------------------------------------------------- Ad-hoc
    # Known, deliberately deferred gap: Appendix B ("AD-HOC AMOUNT... Additions
    # land on Gross Pay or Net Pay depending on how each one was configured")
    # implies GROSS-tagged additions should be able to widen the statutory
    # base and NET-tagged ones shouldn't — applies_to_component is captured
    # on every adjustment_line (for display/audit) but doesn't branch
    # anything below. It CAN'T safely without a schema change first: net_pay
    # is a MySQL GENERATED column driven off total_earnings alone (see
    # models/payroll.py), so a NET-tagged item that bypassed total_earnings
    # would need its own tracked column to still reach net_pay — attempting
    # that without one risks silently losing money, which is worse than the
    # current gap. Today GROSS and NET produce identical, money-correct
    # figures (every addition folds into total_earnings the same way, and
    # nothing downstream computes off total_earnings' composition except
    # is_taxable, a separate field already respected) — this is a real
    # display-categorization gap, not a money-correctness one.
    pending_targets = (
        await db.execute(
            select(AdhocAdjustmentEmployee, AdhocPayslipAdjustment)
            .join(AdhocPayslipAdjustment, AdhocPayslipAdjustment.id == AdhocAdjustmentEmployee.adhoc_payslip_adjustment_id)
            .where(
                AdhocAdjustmentEmployee.employee_id == employee.id, AdhocAdjustmentEmployee.status == "PENDING",
                AdhocPayslipAdjustment.status == "ACTIVE", AdhocPayslipAdjustment.effective_from <= run.pay_period_end,
                (AdhocPayslipAdjustment.effective_until.is_(None)) | (AdhocPayslipAdjustment.effective_until >= run.pay_period_start),
            )
        )
    ).all()
    adhoc_addition_total = Decimal("0")
    adhoc_subtraction_total = Decimal("0")
    annual_taxable_adhoc_this_period = Decimal("0")
    for target, adjustment in pending_targets:
        line = {
            "target_id": target.id, "adjustment_id": adjustment.id, "label_snapshot": adjustment.label, "adjustment_type": adjustment.adjustment_type,
            "amount": adjustment.amount, "applies_to_component": adjustment.applies_to_component, "is_taxable_snapshot": adjustment.is_taxable,
            "is_recurring_snapshot": adjustment.is_recurring, "note_snapshot": adjustment.note,
        }
        calc.adjustment_lines.append(line)
        if adjustment.adjustment_type == "ADDITION":
            adhoc_addition_total += adjustment.amount
            calc.earning_lines.append({"component_type": "ADHOC_ADDITION", "label": adjustment.label, "amount": adjustment.amount, "is_taxable": adjustment.is_taxable, "source": "ADHOC_ADJUSTMENT", "adhoc_payslip_adjustment_id": adjustment.id})
            if adjustment.is_taxable:
                annual_taxable_adhoc_this_period += adjustment.amount
        else:
            adhoc_subtraction_total += adjustment.amount
    row.adhoc_addition_total = adhoc_addition_total
    row.adhoc_subtraction_total = adhoc_subtraction_total
    row.total_earnings += adhoc_addition_total

    # ---------------------------------------------------------- Income tax
    income_heads = await _in_force_heads(db, ("PAYROLL_INCOME_TAX",), run.pay_period_end, scheme_id)
    if income_heads:
        remaining_months = max(1, min(12, (fy.end_date.year - run.period_year) * 12 + (fy.end_date.month - run.period_month) + 1))
        row.remaining_payroll_months = remaining_months

        declarations = (
            await db.execute(select(TaxDeclaration).where(TaxDeclaration.employee_id == employee.id, TaxDeclaration.financial_year_id == fy.id))
        ).scalar_one_or_none()
        annual_declared_reductions = Decimal("0")
        # Appendix B (emphatic): "The calculation uses SUBMITTED figures all
        # year regardless of Verified status — Verified is an audit trail...
        # NOT a blocking gate on Payroll." A Draft declaration (spec: "not
        # used in the tax calculation") must be excluded entirely; once
        # Submitted, always use amount_declared — never
        # amount_accepted_for_calculation, a separately-settable figure a
        # verifier can adjust that must never silently change what's withheld.
        if declarations is not None and declarations.status != "DRAFT":
            decl_lines = (await db.execute(select(TaxDeclarationLine).where(TaxDeclarationLine.tax_declaration_id == declarations.id, TaxDeclarationLine.reduces_taxable_income_snapshot.is_(True)))).scalars().all()
            for dl in decl_lines:
                annual_declared_reductions += dl.amount_declared
        # Employee-borne statutory lines whose head also reduces taxable income, annualized.
        for head in heads:
            if not applicability.get(head.id, True):
                continue
            behaviour = head.behaviour or {}
            if behaviour.get("reduces_taxable_income") and head.scope == "PAYROLL_EMPLOYEE_DEDUCTION":
                matching = next((sl for sl in calc.statutory_lines if sl["tax_head_id"] == head.id), None)
                if matching:
                    annual_declared_reductions += matching["computed_amount"] * 12

        income_head = income_heads[0]
        snapshot = await _tax_head_snapshot(db, income_head)
        result = compute_income_tax(
            annual_gross=structure.gross_monthly * 12, annual_taxable_adhoc=annual_taxable_adhoc_this_period,
            annual_variable_pay=structure.variable_pay_annualised, annual_declared_reductions=annual_declared_reductions,
            calculate_tax_fn=tax_engine.calculate_tax, snapshot=snapshot, remaining_payroll_months=remaining_months,
        )
        row.income_tax_amount = result.monthly_amount
        row.annualised_taxable_income = result.annualized_taxable_income
        row.annual_tax_computed = result.annual_tax_computed
        calc.statutory_lines.append({
            "tax_head_id": income_head.id, "head_name_snapshot": income_head.tax_name, "print_label_snapshot": income_head.print_label or income_head.tax_name,
            "scope_snapshot": income_head.scope, "tax_type_snapshot": income_head.tax_type, "rate_snapshot": income_head.rate_pct,
            "fixed_amount_snapshot": income_head.fixed_amount, "slab_application_snapshot": income_head.slab_application,
            "computed_base": result.annualized_taxable_income, "computed_amount": result.monthly_amount, "borne_by": "EMPLOYEE",
            "reduces_taxable_income_snapshot": False, "include_in_ctc_snapshot": False, "show_on_payslip_snapshot": True,
            "per_employee_applicable_snapshot": True, "annual_taxable_income": result.annualized_taxable_income,
            "annual_declared_reductions": annual_declared_reductions, "annual_tax_before_relief": result.annual_tax_before_relief,
            "remaining_payroll_months": remaining_months,
        })

    row.inclusion_status = "INCLUDED"
    return row, calc


async def _resolve_company_wide_working_days(db: AsyncSession, pay_period_start: date_type, pay_period_end: date_type) -> tuple[Decimal, WorkWeekPolicy | None, str | None]:
    policy = (
        await db.execute(
            select(WorkWeekPolicy).where(WorkWeekPolicy.applies_to == "COMPANY_WIDE", WorkWeekPolicy.is_active.is_(True), WorkWeekPolicy.effective_from <= pay_period_start)
            .order_by(WorkWeekPolicy.effective_from.desc())
        )
    ).scalars().first()
    if policy is None:
        return Decimal("0"), None, None
    from app.models.masters import Holiday, SaturdayOverride
    from app.services.attendance_engine import WorkWeekPolicySnapshot
    from app.services.leave_engine import calculate_working_days

    mandatory_dates = set(
        (await db.execute(select(Holiday.holiday_date).where(Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True), Holiday.holiday_date >= pay_period_start, Holiday.holiday_date <= pay_period_end))).scalars()
    )
    overrides = (await db.execute(select(SaturdayOverride).where(SaturdayOverride.saturday_date >= pay_period_start, SaturdayOverride.saturday_date <= pay_period_end, (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None))))).scalars().all()
    override_dates = {o.saturday_date: (o.override_to == "WORKING") for o in overrides}
    snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day, grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours, weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule, working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours, mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )
    working_days = calculate_working_days(pay_period_start, pay_period_end, False, snapshot, mandatory_dates, override_dates)
    note = f"{policy.policy_name} — Saturday rule {policy.saturday_rule} — {working_days} working days in this period"
    return working_days, policy, note


async def _target_employees(db: AsyncSession, mode: str, employee_ids: list[str]) -> list[Employee]:
    if mode == "ALL_ACTIVE":
        rows = (await db.execute(select(Employee).where(Employee.employment_status == "ACTIVE"))).scalars().all()
        return list(rows)
    if not employee_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="employee_ids is required for SPECIFIC_EMPLOYEES")
    rows = (await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))).scalars().all()
    return list(rows)


async def _refresh_computed(db: AsyncSession, results: list[tuple[PayrollRunEmployee, _EmployeeCalculation]]) -> None:
    """paid_days/credited_hours/balance_hours/total_deductions/net_pay are
    real MySQL STORED GENERATED columns (Computed()) — expired right after
    INSERT/UPDATE, with no value loaded into the ORM instance. Reading one
    synchronously (as _apply_run_totals and the Payslip-build loop both do)
    trips MissingGreenlet, the same async-ORM/Computed() interaction as
    run.working_days_effective above and Phase 2's _get_or_create_balance.

    Refreshing here ONCE is not enough on its own — SQLAlchemy re-expires
    Computed()/server-computed columns after EVERY subsequent flush, not
    just the one that touched them (it can't know in general whether a
    later flush's server-side effects changed them), and confirm_payroll_run
    dirties `run` right after this call (_apply_run_totals' own attribute
    writes), which autoflushes on the very next db.get()/db.execute() in the
    Payslip-build loop. Each row is refreshed a second time, immediately
    before its own computed columns are actually read, for exactly this
    reason — see that loop's own comment at the point it does so.
    """
    for row, _calc in results:
        await db.refresh(row)


def _apply_run_totals(run: PayrollRun, results: list[tuple[PayrollRunEmployee, _EmployeeCalculation]]) -> None:
    included = [r for r, _ in results if r.inclusion_status == "INCLUDED"]
    run.employee_count = len(included)
    run.total_gross = sum((r.gross_pay for r in included), Decimal("0"))
    run.total_employee_deductions = sum((r.total_deductions for r in included), Decimal("0"))
    run.total_employer_contributions = sum((r.total_employer_statutory + r.insurance_employer_contribution for r in included), Decimal("0"))
    run.total_net = sum((r.net_pay for r in included), Decimal("0"))


def _effective_status(run: PayrollRun) -> str:
    """A discarded run reads as DISCARDED everywhere this API reports a
    status. discarded_at is the stored fact (payroll_runs.status itself is
    pinned to ('DRAFT','PROCESSED') by ck_prun_status, so it physically
    cannot hold a third value without a migration) — but a run the accountant
    threw away must never keep presenting itself as a live Draft, which is
    what it did: it stayed status=DRAFT, was unreachable through the
    status=DISCARDED filter, and — because recalculate/confirm guarded only
    on status — could still be confirmed into real payslips.
    """
    return "DISCARDED" if run.discarded_at is not None else run.status


async def _load_run_out(db: AsyncSession, run: PayrollRun) -> PayrollRunOut:
    employees = (await db.execute(select(PayrollRunEmployee).where(PayrollRunEmployee.payroll_run_id == run.id))).scalars().all()
    out = PayrollRunOut.model_validate(run)
    out.status = _effective_status(run)
    out.employees = list(employees)
    return out


async def _run_employees(db: AsyncSession, run_ids: set[str]) -> dict[str, list[PayrollRunEmployee]]:
    """Batch run-employee lookup for the Run History — one `.in_()` query
    grouped in Python, the same shape as expenses.py's _employee_names/
    _vendor_names.

    The order_by is not a new ordering, it PINS the one the per-run query
    already produced: `WHERE payroll_run_id = ?` reads through
    ux_prempl_run_employee (payroll_run_id, employee_id), so a run's
    employees always came back in employee_id order. Naming that index's own
    columns keeps each run's slice byte-identical AND keeps MySQL reading the
    same index instead of sorting.
    """
    if not run_ids:
        return {}
    rows = (
        await db.execute(
            select(PayrollRunEmployee).where(PayrollRunEmployee.payroll_run_id.in_(run_ids))
            .order_by(PayrollRunEmployee.payroll_run_id, PayrollRunEmployee.employee_id)
        )
    ).scalars().all()
    grouped: dict[str, list[PayrollRunEmployee]] = {}
    for row in rows:
        grouped.setdefault(row.payroll_run_id, []).append(row)
    return grouped


async def _load_run_outs(db: AsyncSession, runs: list[PayrollRun]) -> list[PayrollRunOut]:
    """List counterpart to _load_run_out: 1 query in TOTAL rather than 1 per
    run. Same output, row for row — a run with no employees still gets the
    empty list, and _effective_status still speaks for every run (a
    discarded one must not read as a live Draft just because it was
    rendered in a batch).
    """
    employees_by_run = await _run_employees(db, {run.id for run in runs})
    outs = []
    for run in runs:
        out = PayrollRunOut.model_validate(run)
        out.status = _effective_status(run)
        out.employees = list(employees_by_run.get(run.id, ()))
        outs.append(out)
    return outs


@router.get("", response_model=None)
async def list_payroll_runs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    financial_year_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),  # Appendix B: status filters are multi-select, never single-select
    # §2.1's own "Month range" — pay_period_start already IS the real calendar
    # date each run covers (resolved from the Pay Cycle, not the bare
    # period_month/period_year integers), so a plain date range against it is
    # simpler and more correct than reconstructing one from two int columns.
    date_from: date_type | None = Query(None, description="Pay Period Start, inclusive"),
    date_to: date_type | None = Query(None, description="Pay Period Start, inclusive"),
    run_by: str | None = Query(None),
    run_on_from: date_type | None = Query(None),
    run_on_to: date_type | None = Query(None),
    employee_count_min: int | None = Query(None),
    employee_count_max: int | None = Query(None),
    search: str | None = Query(None, description="Matches the resolved period label, e.g. 'July 2026'"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[PayrollRunOut] | Response:
    # DISCARDED is a reported status (see _effective_status), not a stored
    # one — a discarded run stays out of the history by default, but asking
    # for status=DISCARDED must actually find it. Previously discarded runs
    # were unconditionally excluded, so a run that had been thrown away was
    # not findable under ANY status filter.
    statuses = list(status_filter or [])
    want_discarded = "DISCARDED" in statuses
    stored_statuses = [s for s in statuses if s != "DISCARDED"]
    stmt = select(PayrollRun)
    if want_discarded and stored_statuses:
        stmt = stmt.where(PayrollRun.discarded_at.is_not(None) | (PayrollRun.discarded_at.is_(None) & PayrollRun.status.in_(stored_statuses)))
    elif want_discarded:
        stmt = stmt.where(PayrollRun.discarded_at.is_not(None))
    else:
        stmt = stmt.where(PayrollRun.discarded_at.is_(None))
        if stored_statuses:
            stmt = stmt.where(PayrollRun.status.in_(stored_statuses))
    if financial_year_id:
        stmt = stmt.where(PayrollRun.financial_year_id == financial_year_id)
    if date_from:
        stmt = stmt.where(PayrollRun.pay_period_start >= date_from)
    if date_to:
        stmt = stmt.where(PayrollRun.pay_period_start <= date_to)
    if run_by:
        stmt = stmt.where(PayrollRun.run_by == run_by)
    if run_on_from:
        stmt = stmt.where(PayrollRun.created_at >= run_on_from)
    if run_on_to:
        stmt = stmt.where(PayrollRun.created_at < run_on_to + timedelta(days=1))
    if employee_count_min is not None:
        stmt = stmt.where(PayrollRun.employee_count >= employee_count_min)
    if employee_count_max is not None:
        stmt = stmt.where(PayrollRun.employee_count <= employee_count_max)
    runs = (await db.execute(stmt.order_by(PayrollRun.period_year.desc(), PayrollRun.period_month.desc()))).scalars().all()
    # Period-label search has no backing text column (period_month/
    # period_year are ints) — filtered in Python against the same resolved
    # label the list/export rows already print, same "server does what it
    # can" convention as every other free-text search with no dedicated
    # column, harmless here since a run history is at most a few dozen rows.
    if search:
        needle = search.strip().lower()
        runs = [r for r in runs if needle in f"{calendar.month_name[r.period_month]} {r.period_year}".lower()]

    if format:
        # RBAC §2.2(f): export exactly the filtered set on screen, same rows
        # the JSON branch below would return, just re-shaped.
        export_rows = [
            {
                "period": f"{r.period_month}/{r.period_year}", "status": _effective_status(r),
                "total_gross": r.total_gross, "total_net": r.total_net, "employee_count": r.employee_count,
            }
            for r in runs
        ]
        filters_applied = {
            "financial_year_id": financial_year_id, "status": status_filter, "date_from": date_from, "date_to": date_to,
            "run_by": run_by, "run_on_from": run_on_from, "run_on_to": run_on_to,
            "employee_count_min": employee_count_min, "employee_count_max": employee_count_max, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Payroll Run History", _LIST_COLUMNS, export_rows, filters_applied)

    return await _load_run_outs(db, list(runs))


@router.get("/{run_id}", response_model=PayrollRunOut)
async def get_payroll_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> PayrollRunOut:
    run = await db.get(PayrollRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await _load_run_out(db, run)


@router.post("", response_model=PayrollRunOut, status_code=status.HTTP_201_CREATED)
async def create_payroll_run(
    body: PayrollRunCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="run")),
) -> PayrollRunOut:
    from app.models.masters import CompanyProfile

    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    if profile is not None and profile.payroll_basis == "DAY_BASIS":
        # A121: Day Basis has a legal home on Company Profile but no engine
        # behind it — only Hour Basis (this whole module) is implemented.
        # Reject explicitly rather than silently running the hour-basis
        # calculation as if the selection had no effect.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Day Basis is not implemented — this company must use Hour Basis (Company Profile → Payroll Basis)")

    cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    if cycle is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No active Pay Cycle configured — Super Admin must set one in Masters first")

    resolution = resolve_pay_period(body.period_month, body.period_year, cycle.cycle_type, cycle.start_day, cycle.end_day, cycle.salary_credit_day)
    fy = await _resolve_financial_year(db, resolution.period_start)
    total_days = Decimal((resolution.period_end - resolution.period_start).days + 1)
    working_days_auto, _policy, note = await _resolve_company_wide_working_days(db, resolution.period_start, resolution.period_end)

    run = PayrollRun(
        id=str(uuid.uuid4()), financial_year_id=fy.id, period_month=body.period_month, period_year=body.period_year,
        pay_period_start=resolution.period_start, pay_period_end=resolution.period_end, salary_credit_date=resolution.salary_credit_date,
        pay_cycle_type_snapshot=cycle.cycle_type, pay_cycle_start_day_snapshot=cycle.start_day, pay_cycle_end_day_snapshot=cycle.end_day,
        salary_credit_day_snapshot=cycle.salary_credit_day, total_days_in_period=total_days, working_days_auto=working_days_auto,
        working_days_override=body.working_days_override, employee_selection_mode=body.employee_selection_mode,
        work_week_policy_note=note, run_by=current_user.id, run_on=datetime.now(timezone.utc),
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(run)
    await db.flush()
    # working_days_effective is a real MySQL STORED GENERATED column
    # (Computed()) — expired after INSERT, and _calculate_employee reads
    # run.working_days_effective synchronously below. Without this refresh,
    # that first access trips MissingGreenlet (the same async-ORM/Computed()
    # interaction already found and fixed in Phase 2's _get_or_create_balance).
    await db.refresh(run)

    employees = await _target_employees(db, body.employee_selection_mode, body.employee_ids)
    results = []
    for employee in employees:
        row, calc = await _calculate_employee(db, employee, run, fy)
        row.created_by = current_user.id
        row.updated_by = current_user.id
        db.add(row)
        results.append((row, calc))
    await db.flush()
    await _refresh_computed(db, results)
    _apply_run_totals(run, results)

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(run)
    return await _load_run_out(db, run)


@router.post("/{run_id}/recalculate", response_model=PayrollRunOut)
async def recalculate_payroll_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="run")),
) -> PayrollRunOut:
    run = await db.get(PayrollRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if run.discarded_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This run was discarded — start a new run for this period instead")
    if run.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft run can be recalculated")
    fy = await db.get(FinancialYear, run.financial_year_id)

    existing = (await db.execute(select(PayrollRunEmployee).where(PayrollRunEmployee.payroll_run_id == run.id))).scalars().all()
    employee_ids = [e.employee_id for e in existing]
    for e in existing:
        await db.delete(e)
    await db.flush()

    employees = (await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))).scalars().all()
    results = []
    for employee in employees:
        row, calc = await _calculate_employee(db, employee, run, fy)
        row.created_by = current_user.id
        row.updated_by = current_user.id
        row.recalculated_count = 1
        db.add(row)
        results.append((row, calc))
    await db.flush()
    await _refresh_computed(db, results)
    _apply_run_totals(run, results)
    run.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(run)
    return await _load_run_out(db, run)


@router.post("/{run_id}/discard", response_model=PayrollRunOut)
async def discard_payroll_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="run")),
) -> PayrollRunOut:
    run = await db.get(PayrollRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if run.discarded_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This run was already discarded")
    if run.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft run can be discarded — a Processed run is permanent")
    run.discarded_at = datetime.now(timezone.utc)
    run.updated_by = current_user.id
    await db.commit()
    await db.refresh(run)
    return await _load_run_out(db, run)


@router.post("/{run_id}/confirm", response_model=PayrollRunOut)
async def confirm_payroll_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="confirm")),
) -> PayrollRunOut:
    run = await db.get(PayrollRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # A discarded run must never generate payslips: discard is the
    # accountant deliberately throwing this calculation away, and confirming
    # it afterwards wrote real money against a run whose own row said it had
    # been discarded (status PROCESSED with discarded_at set — a
    # self-contradictory record).
    if run.discarded_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This run was discarded — it cannot generate payslips. Start a new run for this period instead")
    if run.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already Processed")
    fy = await db.get(FinancialYear, run.financial_year_id)

    existing = (await db.execute(select(PayrollRunEmployee).where(PayrollRunEmployee.payroll_run_id == run.id))).scalars().all()
    employee_ids = {e.employee_id: e for e in existing}
    employees = (await db.execute(select(Employee).where(Employee.id.in_(employee_ids.keys())))).scalars().all()

    results = []
    for employee in employees:
        row, calc = await _calculate_employee(db, employee, run, fy)
        old_row = employee_ids[employee.id]
        row.id = old_row.id  # preserve identity — same run-employee row, recomputed figures
        for field, value in vars(row).items():
            if not field.startswith("_"):
                setattr(old_row, field, value)
        results.append((old_row, calc))
    await db.flush()
    await _refresh_computed(db, results)
    _apply_run_totals(run, results)

    # 06-payroll-module.md, "On Confirm & Generate Payslips": "...every
    # employee is notified that a new payslip is available." notify() below
    # already fires the in-app half at the right point (per audit); this
    # collects the email half's targets as plain values (not ORM refs) so
    # they survive the commit further down untouched, then the emails are
    # sent right after that commit — same "commit main state, then
    # side-effect actions" pattern email_transport's own module docstring
    # describes, since send_templated_email() commits internally.
    payslip_email_targets: list[dict] = []

    for row, calc in results:
        if row.inclusion_status != "INCLUDED":
            continue
        row.status = "PROCESSED"
        row.updated_by = current_user.id
        employee = next(e for e in employees if e.id == row.employee_id)

        # Snapshotted the same way request_salary_certificate() (payslips.py)
        # already does it — found missing here entirely: department_id/
        # employment_type_id (raw FKs) were being stored, but the three
        # human-readable *_snapshot strings PayslipOut/the PDF actually read
        # were never populated, so Department/Designation always rendered
        # blank on every real payslip.
        department = await db.get(Department, employee.department_id) if employee.department_id else None
        designation = await db.get(Designation, employee.designation_id) if employee.designation_id else None
        employment_type = await db.get(EmploymentType, employee.employment_type_id) if employee.employment_type_id else None

        # _refresh_computed's own upfront refresh (above) is already stale by
        # this point: _apply_run_totals' writes onto `run` dirtied the
        # session, and the three db.get() calls just above this line
        # autoflushed that change — which re-expires row's own Computed()
        # columns (paid_days/credited_hours/balance_hours/total_deductions/
        # net_pay) as a side effect, the same way any flush does. Refreshed
        # again here, right before they're actually read below, so the
        # MissingGreenlet this was already worked around for once doesn't
        # reappear from a SECOND, later expiry this function didn't know to
        # guard against.
        await db.refresh(row)

        payslip = Payslip(
            id=str(uuid.uuid4()), payroll_run_id=run.id, payroll_run_employee_id=row.id, employee_id=employee.id, financial_year_id=fy.id,
            pay_period_start=run.pay_period_start, pay_period_end=run.pay_period_end, salary_credit_date=run.salary_credit_date,
            pay_cycle_type_snapshot=run.pay_cycle_type_snapshot, pay_cycle_start_day_snapshot=run.pay_cycle_start_day_snapshot,
            pay_cycle_end_day_snapshot=run.pay_cycle_end_day_snapshot, salary_credit_day_snapshot=run.salary_credit_day_snapshot,
            period_month=run.period_month, period_year=run.period_year, employee_code_snapshot=employee.employee_code,
            # department_id/employment_type_id: only ever the RESOLVED row's
            # own id, never employee.department_id/employment_type_id
            # copied blind — an employee record can carry a stale FK a
            # reseed left behind (department/employment_type already came
            # back None above for exactly that id), and Payslip's own FK
            # constraint rejects a dangling reference outright; None here
            # matches the *_snapshot fields' own already-correct null
            # handling two lines down rather than crashing the whole run.
            employee_name_snapshot=f"{employee.first_name} {employee.last_name or ''}".strip(),
            department_id=department.id if department else None,
            employment_type_id=employment_type.id if employment_type else None, joining_date_snapshot=employee.joining_date,
            department_snapshot=department.name if department else None, designation_snapshot=designation.name if designation else None,
            employment_type_snapshot=employment_type.name if employment_type else None,
            employee_bank_name_snapshot=employee.bank_name,
            employee_bank_account_masked_snapshot=(employee.bank_account_number[-4:] if employee.bank_account_number else None),
            gross_pay=row.gross_pay, total_earnings=row.total_earnings, total_deductions=row.total_deductions, net_pay=row.net_pay,
            unpaid_leave_deduction=row.unpaid_leave_deduction, lop_deduction=row.lop_deduction, income_tax_amount=row.income_tax_amount,
            insurance_employee_contribution=row.insurance_employee_contribution, paid_days=row.paid_days, unpaid_leave_days=row.unpaid_leave_days,
            lop_days=row.lop_days, has_adhoc_adjustments=bool(calc.adjustment_lines), generated_at=datetime.now(timezone.utc),
            generated_by=current_user.id, created_by=current_user.id, updated_by=current_user.id,
        )
        db.add(payslip)
        await db.flush()

        for seq, line in enumerate(calc.earning_lines, start=1):
            db.add(PayslipEarningLine(id=str(uuid.uuid4()), payslip_id=payslip.id, sequence=seq, show_on_payslip=True, created_by=current_user.id, updated_by=current_user.id, **line))
        for seq, line in enumerate(calc.statutory_lines, start=1):
            db.add(PayslipStatutoryLine(id=str(uuid.uuid4()), payslip_id=payslip.id, sequence=seq, created_by=current_user.id, updated_by=current_user.id, **line))
        for seq, line in enumerate(calc.adjustment_lines, start=1):
            target_id = line.pop("target_id")
            adjustment_id = line.pop("adjustment_id")
            db.add(PayslipAdjustmentLine(
                id=str(uuid.uuid4()), payslip_id=payslip.id, sequence=seq, adhoc_payslip_adjustment_id=adjustment_id,
                adhoc_adjustment_employee_id=target_id, created_by=current_user.id, updated_by=current_user.id, **line,
            ))
            target = await db.get(AdhocAdjustmentEmployee, target_id)
            target.times_applied += 1
            target.total_applied_amount += line["amount"]
            target.first_applied_on = target.first_applied_on or run.pay_period_start
            target.last_applied_on = run.pay_period_start
            target.last_applied_period_month = run.period_month
            target.last_applied_period_year = run.period_year
            target.last_applied_payslip_id = payslip.id
            target.last_applied_payroll_run_id = run.id
            target.updated_by = current_user.id
            adjustment = await db.get(AdhocPayslipAdjustment, adjustment_id)
            if not adjustment.is_recurring:
                target.status = "APPLIED"
                adjustment.status = "CONSUMED"
            adjustment.applied_employee_count += 1
            adjustment.updated_by = current_user.id

        # Materialize + lock the hour reconciliation this run consumed, so a
        # later Work Week Policy edit never rewrites what Attendance & Time
        # Basis shows for a period already Processed (§2.4) — previously
        # this only ever LOOKED for an existing row and never created one,
        # so the lock never actually fired (monthly_summary always
        # recomputed live, with no protection against drifting away from
        # what actually produced this payslip).
        hour_calc = await reconcile_employee_period(db, employee, run.pay_period_start, run.pay_period_end)
        if hour_calc is not None:
            hr_policy = hour_calc.policy
            hr_row = (
                await db.execute(
                    select(MonthlyHourReconciliation).where(MonthlyHourReconciliation.employee_id == employee.id, MonthlyHourReconciliation.period_year == run.period_year, MonthlyHourReconciliation.period_month == run.period_month)
                )
            ).scalar_one_or_none()
            if hr_row is None:
                hr_row = MonthlyHourReconciliation(
                    id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id, period_month=run.period_month, period_year=run.period_year,
                    pay_period_start=run.pay_period_start, pay_period_end=run.pay_period_end, created_by=current_user.id, updated_by=current_user.id,
                )
                db.add(hr_row)
            if not hr_row.is_locked:
                # ck_hourrecon_status permits exactly these three machine
                # codes (not the spec's own display prose) — attendance_
                # reconciliation.py's monthly_summary maps this back to the
                # display string when reading a locked row.
                hour_status = "MET" if row.net_short_hours <= 0 else ("SHORT_COMPENSABLE" if row.net_short_hours <= hr_policy.net_working_hours_per_day else "SHORT_PAYROLL_IMPACT")
                hr_row.work_week_policy_id = hr_policy.id
                hr_row.policy_name_snapshot = hr_policy.policy_name
                hr_row.gross_hours_per_day_snapshot = hr_policy.gross_hours_per_day
                hr_row.unpaid_break_hours_snapshot = hr_policy.unpaid_break_hours
                hr_row.net_hours_per_day_snapshot = hr_policy.net_working_hours_per_day
                hr_row.grace_window_minutes_snapshot = hr_policy.grace_window_minutes
                hr_row.half_day_threshold_hours_snapshot = hr_policy.half_day_threshold_hours
                hr_row.saturday_rule_snapshot = hr_policy.saturday_rule
                hr_row.weekday_count = hour_calc.weekday_count
                hr_row.working_saturdays_count = hour_calc.working_saturdays_count
                hr_row.mandatory_holidays_count = hour_calc.mandatory_holidays_count
                hr_row.working_days = hour_calc.working_days
                hr_row.worked_hours = hour_calc.worked_hours
                hr_row.comp_credit_hours = hour_calc.comp_credit_hours
                hr_row.leave_credit_hours = hour_calc.leave_credit_hours
                hr_row.comp_pending_hours = hour_calc.comp_pending_hours
                hr_row.comp_approved_hours = hour_calc.comp_approved_hours
                hr_row.comp_rejected_hours = hour_calc.comp_rejected_hours
                hr_row.payable_days = row.present_days
                hr_row.lop_days = row.lop_days
                hr_row.lop_days_net_of_pending = row.lop_days
                hr_row.estimated_deduction = row.lop_deduction
                hr_row.uncompensated_shortfall_rule_snapshot = row.uncompensated_shortfall_rule_snapshot or "IGNORE"
                hr_row.status = hour_status
                hr_row.next_step_note = hour_calc.header_note
                hr_row.updated_by = current_user.id
            hr_row.is_locked = True
            hr_row.consumed_by_payroll_run_employee_id = row.id
            await db.flush()
            row.monthly_hour_reconciliation_id = hr_row.id

        notify(
            db, recipient_user_id=employee.user_id, notification_type="PAYSLIP", actor_user_id=current_user.id,
            title="New payslip available", body=f"Your payslip for {run.period_month}/{run.period_year} is now available.",
            source_module="payroll", source_record_id=payslip.id,
        )
        payslip_email_targets.append({"email": employee.email, "first_name": employee.first_name, "payslip_id": payslip.id})

    run.status = "PROCESSED"
    run.processed_by = current_user.id
    run.processed_at = datetime.now(timezone.utc)
    run.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint — an employee in this run may already have a Processed payslip for this period") from exc
    await db.refresh(run)

    period_label = f"{calendar.month_name[run.period_month]} {run.period_year}"
    for target in payslip_email_targets:
        if target["email"]:
            await email_transport.send_templated_email(
                db, "payslip_available", target["email"], {"first_name": target["first_name"], "month": period_label},
                related_record_type="payslip", related_record_id=target["payslip_id"],
            )

    return await _load_run_out(db, run)
