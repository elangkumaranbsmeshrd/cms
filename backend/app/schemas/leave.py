"""Pydantic schemas for Attendance (Employee §2.2) and the Leave module
(05-leave-module.md) — My Leave, Approvals, Balance Management, Compensatory
Hours. Attendance sits here rather than in schemas/employee.py because
attendance_engine.py is the shared engine both this and Leave's working-days
calculation are built on.
"""

from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, computed_field


# ================================================================ ATTENDANCE
class AttendanceRecordWrite(BaseModel):
    employee_id: str
    attendance_date: date
    check_in_time: time | None = None
    check_out_time: time | None = None
    spans_midnight: bool = False
    break_hours: Decimal = Decimal("0")
    note: str | None = None


class AttendanceRecordOut(BaseModel):
    id: str
    employee_id: str
    attendance_date: date
    financial_year_id: str
    work_week_policy_id: str
    policy_name_snapshot: str
    day_type: str
    saturday_ordinal: int | None
    holiday_id: str | None
    saturday_override_id: str | None
    check_in_time: time | None
    check_out_time: time | None
    spans_midnight: bool
    gross_hours: Decimal
    break_hours: Decimal
    net_worked_hours: Decimal
    required_hours: Decimal
    balance_hours: Decimal
    day_status: str
    leave_credit_hours: Decimal
    leave_request_id: str | None
    compensatory_credit_hours: Decimal
    is_compensatory_makeup_day: bool
    shortfall_cleared_hours: Decimal
    source: str
    recorded_by_user_id: str | None
    recorded_by_label: str
    note: str | None
    model_config = ConfigDict(from_attributes=True)


# ================================================================= MY LEAVE
class LeaveRequestCreate(BaseModel):
    leave_type_id: str
    from_date: date
    to_date: date
    is_half_day: bool = False
    half_day_session: str | None = None  # FIRST_HALF | SECOND_HALF
    reason: str


class LeaveRequestOut(BaseModel):
    id: str
    employee_id: str
    leave_type_id: str
    financial_year_id: str
    from_date: date
    to_date: date
    is_half_day: bool
    half_day_session: str | None
    days_requested: Decimal
    working_days_basis_policy_id: str
    reason: str
    paid_type_snapshot: str
    status: str
    routed_to_role: str
    routed_to_user_id: str | None
    routing_reason: str
    applied_at: datetime
    actioned_by: str | None
    actioned_at: datetime | None
    decision_reason: str | None
    cancelled_at: datetime | None
    cancelled_by_user_id: str | None
    reassigned_from_user_id: str | None
    reassigned_by: str | None
    reassigned_at: datetime | None
    hr_co_approval_required: bool
    hr_co_approved_by: str | None
    hr_co_approved_at: datetime | None
    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def awaiting_hr_co_approval(self) -> bool:
        """Leave §6.2 — "the first approver has signed, HR's co-approval is
        still outstanding". Derived here rather than stored, because it is
        exactly the three columns above read together (the same predicate
        api/v1/leave_requests.py's own _awaiting_hr_co_approval applies) and
        a fourth column holding a value the other three already determine
        would just be one more thing that can drift out of agreement with
        them. Always false while the toggle is off, since nothing ever sets
        hr_co_approval_required in that case.
        """
        return self.status == "PENDING" and self.hr_co_approval_required and self.hr_co_approved_at is None


class LeaveDecisionRequest(BaseModel):
    approve: bool
    decision_reason: str | None = None


class LeaveReassignRequest(BaseModel):
    to_user_id: str


class LeaveBalanceOut(BaseModel):
    id: str
    employee_id: str
    leave_type_id: str
    financial_year_id: str
    allowed_days: Decimal
    carried_forward_days: Decimal
    adjustment_days: Decimal
    taken_days: Decimal
    pending_days: Decimal
    remaining_days: Decimal
    is_quota_tracked: bool
    default_annual_quota_snapshot: Decimal
    carry_forward_allowed_snapshot: bool
    max_carry_forward_days_snapshot: Decimal | None
    prorated_from_date: date | None
    proration_months: Decimal | None
    model_config = ConfigDict(from_attributes=True)


# ==================================================== LEAVE BALANCE MANAGEMENT
class LeaveBalanceAdjustmentCreate(BaseModel):
    leave_balance_id: str
    adjustment_days: Decimal
    reason: str


class LeaveBalanceAdjustmentOut(BaseModel):
    id: str
    leave_balance_id: str
    employee_id: str
    leave_type_id: str
    financial_year_id: str
    adjustment_days: Decimal
    reason: str
    source: str
    adjusted_by: str
    adjusted_at: datetime
    balance_before: Decimal
    balance_after: Decimal
    model_config = ConfigDict(from_attributes=True)


class CarryForwardRunPreviewRequest(BaseModel):
    from_financial_year_id: str
    to_financial_year_id: str


class CarryForwardLineOut(BaseModel):
    id: str
    leave_carry_forward_run_id: str
    employee_id: str
    leave_type_id: str
    source_leave_balance_id: str
    target_leave_balance_id: str | None
    remaining_days_at_run: Decimal
    carry_forward_allowed_snapshot: bool
    max_carry_forward_days_snapshot: Decimal | None
    days_carried_forward: Decimal
    days_lapsed: Decimal
    model_config = ConfigDict(from_attributes=True)


class CarryForwardRunOut(BaseModel):
    id: str
    from_financial_year_id: str
    to_financial_year_id: str
    status: str
    previewed_at: datetime
    previewed_by: str
    committed_at: datetime | None
    committed_by: str | None
    cancelled_at: datetime | None
    employee_count: int
    line_count: int
    total_days_carried: Decimal
    total_days_lapsed: Decimal
    lines: list[CarryForwardLineOut] = []
    model_config = ConfigDict(from_attributes=True)


# =============================================================== COMP HOURS
class CompHoursRequestCreate(BaseModel):
    shortfall_attendance_record_id: str
    shortfall_reason: str
    make_up_date: date
    hours_to_work: Decimal  # §2.6: "Must be at least Hours Short" — explicit, not derived from times
    planned_check_in_time: time | None = None
    planned_check_out_time: time | None = None
    planned_break_hours: Decimal = Decimal("0")


class CompHoursRequestOut(BaseModel):
    id: str
    request_number: str
    employee_id: str
    financial_year_id: str
    shortfall_attendance_record_id: str
    shortfall_date: date
    hours_short: Decimal
    day_status_at_request: str
    shortfall_reason: str
    make_up_date: date
    make_up_day_type: str
    work_week_policy_id: str
    hours_to_work: Decimal
    planned_check_in_time: time | None
    planned_check_out_time: time | None
    planned_break_hours: Decimal
    compensation_window_days_snapshot: int
    window_last_permissible_date: date
    max_comp_hours_per_month_snapshot: Decimal | None
    month_hours_used_at_submit: Decimal
    allow_makeup_on_week_off_snapshot: bool
    allow_makeup_on_mandatory_holiday_snapshot: bool
    estimated_payroll_impact: Decimal
    uncompensated_shortfall_becomes_snapshot: str
    status: str
    routed_to_role: str
    routed_to_user_id: str | None
    routing_reason: str
    actioned_by: str | None
    actioned_at: datetime | None
    decision_reason: str | None
    makeup_attendance_record_id: str | None
    hours_actually_worked: Decimal | None
    hours_credited: Decimal
    residual_shortfall_hours: Decimal
    model_config = ConfigDict(from_attributes=True)


class CompHoursDecisionRequest(BaseModel):
    approve: bool
    decision_reason: str | None = None
