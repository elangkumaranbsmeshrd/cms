"""Payroll module (06-payroll-module.md) — 11 tables. Portable generic
SQLAlchemy types only, per mixins.py's convention; alembic/versions/
0004_payroll.py is the schema source of truth.

Every simple same-row `GENERATED ALWAYS AS` column in the migration is
mirrored here wrapped in `Computed(...)` — never as a plain writable
column — per the live-MySQL bug found and fixed in Phase 2 (0003): a plain
column mirroring a real generated column makes MySQL reject the INSERT
(error 3105) the moment the API supplies a value for it. Cross-table rollup
totals (payroll_runs' four money totals, payroll_run_employees' component
totals, payslips' totals, adhoc_payslip_adjustments'/adhoc_adjustment_
employees' counts) are deliberately plain, API-written columns, NOT
GENERATED and NOT trigger-maintained — see the migration's own docstring
for why (the same "service computes and writes, DB triggers only backstop
simple universal invariants" split as Salary Structure and Taxes).
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Computed, Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class MonthlyHourReconciliation(Base, AuditMixin):
    __tablename__ = "monthly_hour_reconciliations"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    pay_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    pay_period_end: Mapped[date] = mapped_column(Date, nullable=False)
    work_week_policy_id: Mapped[str] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=False)
    policy_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    gross_hours_per_day_snapshot: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    unpaid_break_hours_snapshot: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    net_hours_per_day_snapshot: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    grace_window_minutes_snapshot: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    half_day_threshold_hours_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    saturday_rule_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    weekday_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    working_saturdays_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    mandatory_holidays_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    working_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    required_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("working_days * net_hours_per_day_snapshot"), nullable=False)
    worked_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    comp_credit_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    leave_credit_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    credited_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("worked_hours + leave_credit_hours"), nullable=False)
    balance_hours: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), Computed("worked_hours + leave_credit_hours - (working_days * net_hours_per_day_snapshot)"), nullable=False
    )
    hours_short: Mapped[Decimal] = mapped_column(
        Numeric(6, 2),
        Computed("CASE WHEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) > 0 THEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) ELSE 0 END"),
        nullable=False,
    )
    comp_pending_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    comp_approved_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    comp_rejected_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    net_short_hours: Mapped[Decimal] = mapped_column(
        Numeric(6, 2),
        Computed(
            "CASE WHEN (CASE WHEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) > 0 THEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) ELSE 0 END) - comp_pending_hours > 0 "
            "THEN (CASE WHEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) > 0 THEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) ELSE 0 END) - comp_pending_hours ELSE 0 END"
        ),
        nullable=False,
    )
    payable_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    lop_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    lop_days_net_of_pending: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    estimated_deduction: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    uncompensated_shortfall_rule_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    excess_hours_rule_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Widened from 20: stores the spec's own status prose verbatim (§2.4:
    # "Met", "Short — compensable", "Short — payroll impact" — the longest is
    # 23 chars) so a locked row read back later shows exactly what the live
    # on-demand view would have shown at the time, not a separate machine code.
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="MET")
    next_step_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_source: Mapped[str] = mapped_column(String(20), nullable=False, default="MANUAL_ENTRY")
    recorded_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    consumed_by_payroll_run_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payroll_run_employees.id"), nullable=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PayrollRun(Base, AuditMixin):
    __tablename__ = "payroll_runs"

    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    pay_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    pay_period_end: Mapped[date] = mapped_column(Date, nullable=False)
    salary_credit_date: Mapped[date] = mapped_column(Date, nullable=False)
    pay_cycle_type_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    pay_cycle_start_day_snapshot: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    pay_cycle_end_day_snapshot: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    salary_credit_day_snapshot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    total_days_in_period: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    working_days_auto: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    working_days_override: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    working_days_effective: Mapped[Decimal] = mapped_column(Numeric(5, 2), Computed("COALESCE(working_days_override, working_days_auto)"), nullable=False)
    employee_selection_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT")
    employee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_gross: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_employee_deductions: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_employer_contributions: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_net: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    work_week_policy_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    run_on: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    processed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    discarded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class PayrollRunEmployee(Base, AuditMixin):
    __tablename__ = "payroll_run_employees"

    payroll_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("payroll_runs.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT")
    inclusion_status: Mapped[str] = mapped_column(String(35), nullable=False, default="INCLUDED")
    skip_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    salary_structure_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("salary_structures.id"), nullable=True)
    work_week_policy_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=True)
    monthly_hour_reconciliation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("monthly_hour_reconciliations.id"), nullable=True)
    tax_scheme_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_schemes.id"), nullable=True)
    gross_monthly_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    gross_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_days_in_period: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    working_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    present_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    paid_leave_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    unpaid_leave_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    paid_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), Computed("present_days + paid_leave_days"), nullable=False)
    lop_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    required_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    worked_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    comp_credit_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    leave_credit_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    credited_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("worked_hours + leave_credit_hours"), nullable=False)
    balance_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("worked_hours + leave_credit_hours - required_hours"), nullable=False)
    comp_pending_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    net_short_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    unpaid_leave_deduction: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    lop_deduction: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    uncompensated_shortfall_rule_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_earnings: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_employee_statutory: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_employer_statutory: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    income_tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    insurance_employee_contribution: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    insurance_employer_contribution: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    adhoc_addition_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    adhoc_subtraction_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_deductions: Mapped[Decimal] = mapped_column(
        Numeric(14, 2),
        Computed("total_employee_statutory + income_tax_amount + insurance_employee_contribution + unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total"),
        nullable=False,
    )
    # total_earnings already has adhoc_addition_total folded in (see
    # payroll_runs._calculate_employee: row.total_earnings += adhoc_addition_total)
    # — must not be added again here, or every ad-hoc ADDITION overpays by
    # its own amount (found live: a 5000 bonus made net_pay 12800 instead of 7800).
    net_pay: Mapped[Decimal] = mapped_column(
        Numeric(14, 2),
        Computed(
            "total_earnings - (total_employee_statutory + income_tax_amount + insurance_employee_contribution "
            "+ unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total)"
        ),
        nullable=False,
    )
    annualised_taxable_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_tax_computed: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_relief_applied: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    remaining_payroll_months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    recalculated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Payslip(Base, AuditMixin):
    __tablename__ = "payslips"

    payroll_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("payroll_runs.id"), nullable=False)
    payroll_run_employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("payroll_run_employees.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    pay_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    pay_period_end: Mapped[date] = mapped_column(Date, nullable=False)
    salary_credit_date: Mapped[date] = mapped_column(Date, nullable=False)
    pay_cycle_type_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    pay_cycle_start_day_snapshot: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    pay_cycle_end_day_snapshot: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    salary_credit_day_snapshot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    employee_code_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    employee_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    designation_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    department_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("departments.id"), nullable=True)
    department_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    employment_type_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employment_types.id"), nullable=True)
    employment_type_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    joining_date_snapshot: Mapped[date | None] = mapped_column(Date, nullable=True)
    employee_bank_name_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    employee_bank_account_masked_snapshot: Mapped[str | None] = mapped_column(String(4), nullable=True)
    gross_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_earnings: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_deductions: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    net_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    unpaid_leave_deduction: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    lop_deduction: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    income_tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    insurance_employee_contribution: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    paid_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    unpaid_leave_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    lop_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    has_unpaid_leave: Mapped[bool] = mapped_column(Boolean, Computed("unpaid_leave_days > 0 OR lop_days > 0"), nullable=False)
    has_adhoc_adjustments: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PROCESSED")
    reissue_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reissued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    generated_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    employee_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notification_email_send_log_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("email_send_log.id"), nullable=True)
    pdf_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)


class PayslipEarningLine(Base, AuditMixin):
    __tablename__ = "payslip_earning_lines"

    payslip_id: Mapped[str] = mapped_column(String(36), ForeignKey("payslips.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    component_type: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(191), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    is_taxable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    adhoc_payslip_adjustment_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("adhoc_payslip_adjustments.id"), nullable=True)
    show_on_payslip: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PayslipStatutoryLine(Base, AuditMixin):
    __tablename__ = "payslip_statutory_lines"

    payslip_id: Mapped[str] = mapped_column(String(36), ForeignKey("payslips.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    head_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    print_label_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    scope_snapshot: Mapped[str] = mapped_column(String(40), nullable=False)
    tax_type_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    fixed_amount_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    slab_application_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    computed_base: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    computed_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    calculation_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    borne_by: Mapped[str] = mapped_column(String(10), nullable=False)
    reduces_taxable_income_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    include_in_ctc_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_on_payslip_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    per_employee_applicable_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tax_scheme_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_schemes.id"), nullable=True)
    tax_scheme_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    component_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    component_share_pct_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)
    annual_taxable_income: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_declared_reductions: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_tax_before_relief: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    relief_rule_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_head_relief_rules.id"), nullable=True)
    relief_name_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    relief_amount_applied: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    remaining_payroll_months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)


class PayslipAdjustmentLine(Base, AuditMixin):
    __tablename__ = "payslip_adjustment_lines"

    payslip_id: Mapped[str] = mapped_column(String(36), ForeignKey("payslips.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    adhoc_payslip_adjustment_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhoc_payslip_adjustments.id"), nullable=False)
    adhoc_adjustment_employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhoc_adjustment_employees.id"), nullable=False)
    label_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    adjustment_type: Mapped[str] = mapped_column(String(15), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    signed_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("CASE WHEN adjustment_type = 'ADDITION' THEN amount ELSE -amount END"), nullable=False)
    applies_to_component: Mapped[str] = mapped_column(String(10), nullable=False, default="GROSS")
    is_taxable_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_recurring_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)


class AdhocPayslipAdjustment(Base, AuditMixin):
    __tablename__ = "adhoc_payslip_adjustments"

    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    applies_to_mode: Mapped[str] = mapped_column(String(25), nullable=False)
    employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    label: Mapped[str] = mapped_column(String(191), nullable=False)
    adjustment_type: Mapped[str] = mapped_column(String(15), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    is_taxable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    applies_to_component: Mapped[str] = mapped_column(String(10), nullable=False, default="GROSS")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="MANUAL")
    offer_letter_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("offer_letters.id"), nullable=True)
    offer_letter_custom_term_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("offer_letter_custom_terms.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE")
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    removed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    removal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_employee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    applied_employee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AdhocAdjustmentEmployee(Base, AuditMixin):
    __tablename__ = "adhoc_adjustment_employees"

    adhoc_payslip_adjustment_id: Mapped[str] = mapped_column(String(36), ForeignKey("adhoc_payslip_adjustments.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    times_applied: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_applied_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    first_applied_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_applied_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_applied_period_month: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    last_applied_period_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    last_applied_payslip_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payslips.id"), nullable=True)
    last_applied_payroll_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payroll_runs.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class PayslipReissue(Base, AuditMixin):
    __tablename__ = "payslip_reissues"

    payslip_id: Mapped[str] = mapped_column(String(36), ForeignKey("payslips.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    reissue_number: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    reissue_method: Mapped[str] = mapped_column(String(20), nullable=False)
    old_gross_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    new_gross_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    old_total_earnings: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    new_total_earnings: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    old_total_deductions: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    new_total_deductions: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    old_net_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    new_net_pay: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    net_pay_delta: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("new_net_pay - old_net_pay"), nullable=False)
    old_income_tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    new_income_tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    old_paid_days: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    new_paid_days: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    old_lop_days: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    new_lop_days: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    old_adhoc_net_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    new_adhoc_net_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    line_change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    reissued_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    reissued_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    employee_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notification_email_send_log_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("email_send_log.id"), nullable=True)


class SalaryCertificateRequest(Base, AuditMixin):
    __tablename__ = "salary_certificate_requests"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    purpose: Mapped[str | None] = mapped_column(String(191), nullable=True)
    salary_structure_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("salary_structures.id"), nullable=True)
    employee_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    employee_code_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    designation_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    department_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    joining_date_snapshot: Mapped[date | None] = mapped_column(Date, nullable=True)
    employment_type_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    basic_salary_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    gross_monthly_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    net_monthly_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_ctc_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    company_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    company_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="GENERATED")
    generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pdf_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
