"""Leave module (05-leave-module.md) — 6 tables. Same portable-types
convention as employee.py; alembic/versions/0003_employee_leave.py is the
schema source of truth.
"""

from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Computed, Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class LeaveRequest(Base, AuditMixin):
    __tablename__ = "leave_requests"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    leave_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_types.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_half_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    half_day_session: Mapped[str | None] = mapped_column(String(12), nullable=True)
    days_requested: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    working_days_basis_policy_id: Mapped[str] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    paid_type_snapshot: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    routed_to_role: Mapped[str] = mapped_column(String(20), nullable=False)
    routed_to_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    routing_reason: Mapped[str] = mapped_column(Text, nullable=False)
    applied_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    actioned_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    actioned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reassigned_from_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reassigned_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reassigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hr_co_approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hr_co_approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    hr_co_approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LeaveBalance(Base, AuditMixin):
    __tablename__ = "leave_balances"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    leave_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_types.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    allowed_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    carried_forward_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    adjustment_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    taken_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    pending_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    # Real STORED GENERATED column in MySQL — see employee.py's
    # SalaryStructure.gross_monthly for why this is Computed() rather than a
    # plain API-set column.
    remaining_days: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), Computed("allowed_days + carried_forward_days + adjustment_days - taken_days - pending_days"), nullable=False
    )
    is_quota_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_annual_quota_snapshot: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    carry_forward_allowed_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_carry_forward_days_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    prorated_from_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    proration_months: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)


class LeaveCarryForwardRun(Base, AuditMixin):
    __tablename__ = "leave_carry_forward_runs"

    from_financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    to_financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PREVIEW")
    previewed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    previewed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    committed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    employee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    line_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_days_carried: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_days_lapsed: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    filter_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class LeaveCarryForwardLine(Base, AuditMixin):
    __tablename__ = "leave_carry_forward_lines"

    leave_carry_forward_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_carry_forward_runs.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    leave_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_types.id"), nullable=False)
    source_leave_balance_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_balances.id"), nullable=False)
    target_leave_balance_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leave_balances.id"), nullable=True)
    remaining_days_at_run: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    carry_forward_allowed_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False)
    max_carry_forward_days_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    days_carried_forward: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    # Real STORED GENERATED column in MySQL — same Computed() reasoning as
    # leave_balances.remaining_days above.
    days_lapsed: Mapped[Decimal] = mapped_column(Numeric(5, 2), Computed("remaining_days_at_run - days_carried_forward"), nullable=False)


class LeaveBalanceAdjustment(Base):
    __tablename__ = "leave_balance_adjustments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    leave_balance_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_balances.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    leave_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_types.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    adjustment_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(25), nullable=False, default="MANUAL_CORRECTION")
    leave_carry_forward_line_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leave_carry_forward_lines.id"), nullable=True)
    adjusted_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    adjusted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    balance_before: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    notification_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CompensatoryHourRequest(Base, AuditMixin):
    __tablename__ = "compensatory_hour_requests"

    request_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    shortfall_attendance_record_id: Mapped[str] = mapped_column(String(36), ForeignKey("attendance_records.id"), nullable=False)
    shortfall_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours_short: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    day_status_at_request: Mapped[str] = mapped_column(String(20), nullable=False)
    shortfall_reason: Mapped[str] = mapped_column(Text, nullable=False)
    make_up_date: Mapped[date] = mapped_column(Date, nullable=False)
    make_up_day_type: Mapped[str] = mapped_column(String(20), nullable=False)
    work_week_policy_id: Mapped[str] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=False)
    hours_to_work: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    planned_check_in_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    planned_check_out_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    planned_break_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    compensation_window_days_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    window_last_permissible_date: Mapped[date] = mapped_column(Date, nullable=False)
    max_comp_hours_per_month_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    month_hours_used_at_submit: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    allow_makeup_on_week_off_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_makeup_on_mandatory_holiday_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    estimated_payroll_impact: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    uncompensated_shortfall_becomes_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    routed_to_role: Mapped[str] = mapped_column(String(20), nullable=False)
    routed_to_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    routing_reason: Mapped[str] = mapped_column(Text, nullable=False)
    actioned_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    actioned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    makeup_attendance_record_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("attendance_records.id"), nullable=True)
    hours_actually_worked: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    hours_credited: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    residual_shortfall_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
