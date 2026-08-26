"""Pydantic schemas for Payroll (06-payroll-module.md) — Run Payroll +
History, Ad-hoc Payslip Adjustments, Payslip (employee + Accountant/HR
views), Reissue, Salary Certificates, Attendance & Time Basis.
"""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Every Month/Year selection in this module is resolved by
# payroll_engine.resolve_pay_period, which builds real date() objects from
# them — a month outside 1..12 (or a year the calendar/DB can't hold) raises
# ValueError deep inside that call and surfaced as a 500. Bounded here (and,
# for the GET endpoints, on their own Query params in
# api/v1/attendance_reconciliation.py) so an out-of-range period is a plain
# 422 naming the field, before any date arithmetic is attempted. The bounds
# are the same ones the DB already enforces: ck_prun_month (1..12) and
# ck_prun_year (2000..2200).
PERIOD_MONTH_MIN, PERIOD_MONTH_MAX = 1, 12
PERIOD_YEAR_MIN, PERIOD_YEAR_MAX = 2000, 2200


# ============================================================ PAYROLL RUNS
class PayrollRunCreate(BaseModel):
    period_month: int = Field(ge=PERIOD_MONTH_MIN, le=PERIOD_MONTH_MAX)
    period_year: int = Field(ge=PERIOD_YEAR_MIN, le=PERIOD_YEAR_MAX)
    employee_selection_mode: str  # ALL_ACTIVE | SPECIFIC_EMPLOYEES
    employee_ids: list[str] = []  # required when employee_selection_mode == SPECIFIC_EMPLOYEES
    working_days_override: Decimal | None = None


class PayrollRunEmployeeOut(BaseModel):
    id: str
    payroll_run_id: str
    employee_id: str
    status: str
    inclusion_status: str
    skip_reason: str | None
    gross_monthly_snapshot: Decimal
    gross_pay: Decimal
    total_days_in_period: Decimal
    working_days: Decimal
    present_days: Decimal
    paid_leave_days: Decimal
    unpaid_leave_days: Decimal
    paid_days: Decimal
    lop_days: Decimal
    required_hours: Decimal
    worked_hours: Decimal
    comp_credit_hours: Decimal
    leave_credit_hours: Decimal
    credited_hours: Decimal
    balance_hours: Decimal
    comp_pending_hours: Decimal
    net_short_hours: Decimal
    unpaid_leave_deduction: Decimal
    lop_deduction: Decimal
    total_earnings: Decimal
    total_employee_statutory: Decimal
    total_employer_statutory: Decimal
    income_tax_amount: Decimal
    insurance_employee_contribution: Decimal
    insurance_employer_contribution: Decimal
    adhoc_addition_total: Decimal
    adhoc_subtraction_total: Decimal
    total_deductions: Decimal
    net_pay: Decimal
    model_config = ConfigDict(from_attributes=True)


class PayrollRunOut(BaseModel):
    id: str
    financial_year_id: str
    period_month: int
    period_year: int
    pay_period_start: date
    pay_period_end: date
    salary_credit_date: date
    total_days_in_period: Decimal
    working_days_auto: Decimal
    working_days_override: Decimal | None
    working_days_effective: Decimal
    employee_selection_mode: str
    status: str
    employee_count: int
    total_gross: Decimal
    total_employee_deductions: Decimal
    total_employer_contributions: Decimal
    total_net: Decimal
    work_week_policy_note: str | None
    run_by: str
    run_on: datetime
    processed_by: str | None
    processed_at: datetime | None
    discarded_at: datetime | None
    notes: str | None
    employees: list[PayrollRunEmployeeOut] = []
    model_config = ConfigDict(from_attributes=True)


# ================================================== AD-HOC PAYSLIP ADJUSTMENTS
class AdhocAdjustmentCreate(BaseModel):
    """Every field below is bounded to exactly what adhoc_payslip_adjustments'
    own CHECK constraints accept (ck_adhoc_mode / ck_adhoc_type /
    ck_adhoc_component / ck_adhoc_amount / ck_adhoc_label, plus label's
    VARCHAR(191)). Previously these were plain `str`/`Decimal`: every illegal
    value reached MySQL and came back as an unhandled 500, and the OpenAPI
    schema advertised no legal values at all, so a client had no way to know
    them. Literals put them in the schema AND reject them as a 422 naming the
    offending field.
    """

    applies_to_mode: Literal["SINGLE_EMPLOYEE", "MULTIPLE_EMPLOYEES", "ALL_ACTIVE_EMPLOYEES"]
    employee_id: str | None = None
    employee_ids: list[str] = []  # used when MULTIPLE_EMPLOYEES
    label: str = Field(min_length=1, max_length=191)
    adjustment_type: Literal["ADDITION", "SUBTRACTION"]
    amount: Decimal = Field(gt=0)
    is_taxable: bool = True
    is_recurring: bool = False
    applies_to_component: Literal["GROSS", "NET"] = "GROSS"
    note: str | None = None
    effective_from: date | None = None

    @model_validator(mode="after")
    def _label_not_blank(self) -> "AdhocAdjustmentCreate":
        # ck_adhoc_label: TRIM(label) <> '' — a label of only spaces passes
        # min_length but is rejected by the database.
        if not self.label.strip():
            raise ValueError("label cannot be blank")
        self.label = self.label.strip()
        return self


class AdhocAdjustmentOut(BaseModel):
    id: str
    financial_year_id: str
    applies_to_mode: str
    employee_id: str | None
    label: str
    adjustment_type: str
    amount: Decimal
    is_taxable: bool
    is_recurring: bool
    applies_to_component: str
    note: str | None
    effective_from: date
    effective_until: date | None
    source: str
    offer_letter_id: str | None
    offer_letter_custom_term_id: str | None
    status: str
    removed_at: datetime | None
    removal_reason: str | None
    target_employee_count: int
    applied_employee_count: int
    created_by: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AdhocAdjustmentRemove(BaseModel):
    removal_reason: str


# ===================================================================== PAYSLIPS
class PayslipEarningLineOut(BaseModel):
    id: str
    sequence: int
    component_type: str
    label: str
    amount: Decimal
    is_taxable: bool
    source: str
    show_on_payslip: bool
    model_config = ConfigDict(from_attributes=True)


class PayslipStatutoryLineOut(BaseModel):
    id: str
    sequence: int
    tax_head_id: str
    head_name_snapshot: str
    print_label_snapshot: str
    scope_snapshot: str
    computed_base: Decimal
    computed_amount: Decimal
    borne_by: str
    show_on_payslip_snapshot: bool
    model_config = ConfigDict(from_attributes=True)


class PayslipAdjustmentLineOut(BaseModel):
    id: str
    sequence: int
    label_snapshot: str
    adjustment_type: str
    amount: Decimal
    signed_amount: Decimal
    applies_to_component: str
    model_config = ConfigDict(from_attributes=True)


class PayslipOut(BaseModel):
    id: str
    payroll_run_id: str
    employee_id: str
    financial_year_id: str
    pay_period_start: date
    pay_period_end: date
    salary_credit_date: date
    period_month: int
    period_year: int
    employee_code_snapshot: str
    employee_name_snapshot: str
    designation_snapshot: str | None
    department_snapshot: str | None
    employment_type_snapshot: str | None
    employee_bank_name_snapshot: str | None
    employee_bank_account_masked_snapshot: str | None
    gross_pay: Decimal
    total_earnings: Decimal
    total_deductions: Decimal
    net_pay: Decimal
    unpaid_leave_deduction: Decimal
    lop_deduction: Decimal
    income_tax_amount: Decimal
    insurance_employee_contribution: Decimal
    paid_days: Decimal
    unpaid_leave_days: Decimal
    lop_days: Decimal
    has_unpaid_leave: bool
    has_adhoc_adjustments: bool
    status: str
    reissue_count: int
    last_reissued_at: datetime | None
    generated_at: datetime
    # §2.3: "Super Admin additionally gets Created By, Last Modified By" —
    # both real columns already (generated_by/AuditMixin's updated_by), just
    # not previously exposed here; needed so the frontend's Created By/Last
    # Modified By filters can derive their own option lists from the loaded
    # rows, same optionsFromRows technique every other raw-User-id filter in
    # this module already uses.
    generated_by: str
    updated_by: str | None
    earning_lines: list[PayslipEarningLineOut] = []
    statutory_lines: list[PayslipStatutoryLineOut] = []
    adjustment_lines: list[PayslipAdjustmentLineOut] = []
    model_config = ConfigDict(from_attributes=True)


class ReissueRequest(BaseModel):
    reason: str
    reissue_method: str  # RECALCULATED | MANUAL_ADJUSTMENT
    # Manual overrides — only read when reissue_method == MANUAL_ADJUSTMENT
    manual_gross_pay: Decimal | None = None
    manual_net_pay: Decimal | None = None
    manual_total_earnings: Decimal | None = None
    manual_total_deductions: Decimal | None = None

    @model_validator(mode="after")
    def _manual_figures_must_reconcile(self) -> "ReissueRequest":
        """A MANUAL_ADJUSTMENT reissue previously wrote its four figures onto
        the payslip as four independent assignments, with no sign check and no
        relation between them — so the API would happily persist a legally-
        issued payslip stating Net Pay 99999.00 against Earnings 32000.00 /
        Deductions 26000.00, or one made entirely of negative money.

        Net Pay = Total Earnings − Total Deductions is not a policy invented
        here: it is the exact identity payroll_run_employees.net_pay is a
        MySQL GENERATED column of (models/payroll.py), i.e. what every
        Run Payroll and every RECALCULATED reissue already produces. Payslip's
        own net_pay is a plain column, so this is the only place that identity
        can be enforced on the manual path. The three figures that participate
        in it must therefore be supplied together — a partial override that
        mixed new earnings with the payslip's old deductions is precisely how
        an incoherent payslip was produced.
        """
        if self.reissue_method != "MANUAL_ADJUSTMENT":
            return self
        supplied = {
            "manual_total_earnings": self.manual_total_earnings,
            "manual_total_deductions": self.manual_total_deductions,
            "manual_net_pay": self.manual_net_pay,
        }
        missing = [name for name, value in supplied.items() if value is None]
        if missing:
            raise ValueError(
                "MANUAL_ADJUSTMENT requires manual_total_earnings, manual_total_deductions and manual_net_pay together "
                f"(missing: {', '.join(missing)})"
            )
        negative = [name for name, value in {**supplied, "manual_gross_pay": self.manual_gross_pay}.items() if value is not None and value < 0]
        if negative:
            raise ValueError(f"A payslip figure cannot be negative: {', '.join(sorted(negative))}")
        expected = self.manual_total_earnings - self.manual_total_deductions
        if self.manual_net_pay != expected:
            raise ValueError(
                f"manual_net_pay must equal manual_total_earnings - manual_total_deductions "
                f"({self.manual_total_earnings} - {self.manual_total_deductions} = {expected}), got {self.manual_net_pay}"
            )
        return self


class PayslipReissueOut(BaseModel):
    id: str
    payslip_id: str
    reissue_number: int
    reason: str
    reissue_method: str
    old_net_pay: Decimal
    new_net_pay: Decimal
    net_pay_delta: Decimal
    reissued_by: str
    reissued_at: datetime
    employee_notified: bool
    # §6.1 "Require Super Admin Approval to Reissue a Payslip" — approval_
    # required is False for the toggle's OFF position (the historical
    # behavior: applies immediately) and for any Super-Admin-initiated
    # reissue (they're already the approver). True means new_* above are
    # recorded but NOT YET applied to the Payslip itself — see
    # api/v1/payslips.py's reissue_payslip/approve_reissue.
    approval_required: bool
    approved_by: str | None
    approved_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class SalaryCertificateRequestCreate(BaseModel):
    purpose: str | None = None


class SalaryCertificateRequestOut(BaseModel):
    id: str
    employee_id: str
    requested_at: datetime
    purpose: str | None
    employee_name_snapshot: str
    employee_code_snapshot: str
    designation_snapshot: str | None
    department_snapshot: str | None
    joining_date_snapshot: date | None
    gross_monthly_snapshot: Decimal | None
    net_monthly_snapshot: Decimal | None
    annual_ctc_snapshot: Decimal | None
    company_name_snapshot: str | None
    status: str
    generated_at: datetime | None
    pdf_file_id: str | None
    model_config = ConfigDict(from_attributes=True)


# ============================================================== ATTENDANCE & TIME BASIS
class MonthlyHourReconciliationOut(BaseModel):
    id: str
    employee_id: str
    period_month: int
    period_year: int
    pay_period_start: date
    pay_period_end: date
    policy_name_snapshot: str
    weekday_count: int
    working_saturdays_count: int
    mandatory_holidays_count: int
    working_days: Decimal
    required_hours: Decimal
    worked_hours: Decimal
    comp_credit_hours: Decimal
    leave_credit_hours: Decimal
    credited_hours: Decimal
    balance_hours: Decimal
    hours_short: Decimal
    comp_pending_hours: Decimal
    comp_approved_hours: Decimal
    net_short_hours: Decimal
    payable_days: Decimal
    lop_days: Decimal
    lop_days_net_of_pending: Decimal
    estimated_deduction: Decimal
    status: str
    next_step_note: str | None
    is_locked: bool
    model_config = ConfigDict(from_attributes=True)
