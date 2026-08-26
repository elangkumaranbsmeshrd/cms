"""Leave working-days calculation, approval routing, and Compensatory Hours
window/cap validation (05-leave-module.md) — isolated and unit-tested, same
discipline as tax_engine.py / attendance_engine.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.services.attendance_engine import WorkWeekPolicySnapshot, is_weekly_off, saturday_is_working_by_pattern, saturday_ordinal

DAYS_PLACES = Decimal("0.5")  # half-day granularity


def round_half(value: Decimal) -> Decimal:
    return (value * 2).quantize(Decimal("1"), rounding=ROUND_HALF_UP) / 2


@dataclass(frozen=True)
class ProratedQuota:
    proration_months: Decimal
    allowed_days: Decimal


def calculate_prorated_starting_balance(
    joining_date: date, financial_year_end: date, default_annual_quota_days: Decimal
) -> ProratedQuota:
    """Leave §2.3 "New employee starting balance — automatic, not a button":
    (Default Annual Quota / 12) x months remaining in the Financial Year,
    rounded to the nearest half-day. Months remaining counts the joining
    month itself as a whole month (an employee joining on the 28th still
    gets that month's full twelfth), capped at 12 for a mid-year rehire
    whose joining_date somehow precedes the FY.
    """
    months_remaining = (financial_year_end.year - joining_date.year) * 12 + (financial_year_end.month - joining_date.month) + 1
    months_remaining = max(0, min(12, months_remaining))
    allowed_days = round_half(default_annual_quota_days / 12 * months_remaining)
    return ProratedQuota(proration_months=Decimal(months_remaining), allowed_days=allowed_days)


class InsufficientBalanceError(ValueError):
    def __init__(self, leave_type_name: str, remaining: Decimal, requested: Decimal):
        self.leave_type_name = leave_type_name
        self.remaining = remaining
        self.requested = requested
        super().__init__(f"You have {remaining} days remaining for {leave_type_name}, but requested {requested}")


def calculate_working_days(
    from_date: date,
    to_date: date,
    is_half_day: bool,
    policy: WorkWeekPolicySnapshot,
    mandatory_holiday_dates: set[date],
    saturday_override_dates: dict[date, bool],  # date -> is_working
) -> Decimal:
    """Masters/Leave: working days between From and To, excluding weekly off
    days and Mandatory holidays (never Optional ones), per the covering
    policy's Saturday rule — minus 0.5 for a half day. A Mandatory holiday on
    an otherwise-working Saturday makes it non-working (mirrors
    attendance_engine.resolve_day's precedence exactly, since both must
    agree on which dates are "working" for the same policy).
    """
    if is_half_day:
        return Decimal("0.5")

    count = 0
    current = from_date
    while current <= to_date:
        if current in mandatory_holiday_dates:
            pass  # never a working day, regardless of anything else
        elif current.isoweekday() == 6:  # Saturday
            if current in saturday_override_dates:
                if saturday_override_dates[current]:
                    count += 1
            elif saturday_is_working_by_pattern(saturday_ordinal(current), policy.saturday_rule):
                count += 1
        elif not is_weekly_off(current, policy.weekly_off_days):
            count += 1
        current += timedelta(days=1)
    return Decimal(count)


def check_balance_or_raise(leave_type_name: str, remaining: Decimal, requested: Decimal, is_quota_tracked: bool) -> None:
    """The hard block (Leave §2.1): no submit-anyway path. Skipped entirely
    for a leave type whose quota is 0 (Remaining reads "Not tracked").
    """
    if not is_quota_tracked:
        return
    if requested > remaining:
        raise InsufficientBalanceError(leave_type_name, remaining, requested)


@dataclass(frozen=True)
class RoutingResult:
    role: str  # REPORTING_MANAGER | HR | SUPER_ADMIN
    user_id: str | None
    reason: str


def resolve_routing(
    *,
    applicant_role_code: str,
    reporting_manager_user_id: str | None,
    hr_is_available: bool,
    applicant_is_sole_active_hr: bool,
) -> RoutingResult:
    """The Approval Routing Rule, written out precisely (Leave §2.2) — shared
    verbatim by leave requests and Compensatory Hours (§2.6 reuses it rather
    than inventing a second one).

    1. Default: the applicant's Reporting Manager.
    2. No Reporting Manager set: routes to HR.
    3. Applicant is themselves Manager/Accountant/HR: routes to HR always.
    4. Nobody is in HR: falls back to Super Admin.
    5. A person never approves their own request — if the request would
       route to HR and the applicant IS the only active HR user, it falls
       through to Super Admin instead.
    """
    # QUEUED / NOT BUILT — §6 "nothing hardcoded" names this exact rule as
    # its own example of a workflow step that must be configurable, and
    # today it is plain Python if/elif branching on literal role codes
    # (MANAGER/ACCOUNTANT/HR/SUPER_ADMIN) with a fixed escalation order. A
    # client wanting a different order, an extra tier, or another role added
    # to the "always routes to HR" set needs a code change, not a Masters
    # edit. Not fixed now because there is nothing real to read from yet:
    # no routing-rule table (role code -> escalates-to role code, a
    # "no self-approval" flag, a final fallback role) exists in
    # app/models/masters.py, no schema for it in app/schemas/masters.py, and
    # no Super-Admin-editable screen for it on the frontend. Turning this
    # into config means adding that table + CRUD route + admin screen
    # first, then having resolve_routing() read the ordered rule set
    # instead of embedding it — swapping the literals below for a lookup
    # without any of that in place would just be guessing at a shape that
    # doesn't exist.
    if applicant_role_code in ("MANAGER", "ACCOUNTANT", "HR"):
        if applicant_role_code == "HR" and applicant_is_sole_active_hr:
            return RoutingResult("SUPER_ADMIN", None, "Applicant is the only active HR user — cannot approve their own request")
        if not hr_is_available:
            return RoutingResult("SUPER_ADMIN", None, "No active HR user exists")
        return RoutingResult("HR", None, f"Applicant holds the {applicant_role_code} role — routes to HR, not their reporting line")

    if reporting_manager_user_id is None:
        if not hr_is_available:
            return RoutingResult("SUPER_ADMIN", None, "No Reporting Manager set and no active HR user exists")
        return RoutingResult("HR", None, "No Reporting Manager set on the applicant's record")

    return RoutingResult("REPORTING_MANAGER", reporting_manager_user_id, "Default: routed to the applicant's Reporting Manager")


@dataclass(frozen=True)
class CompHoursValidation:
    window_last_permissible_date: date
    within_window: bool
    within_monthly_cap: bool
    day_type_permitted: bool


def validate_comp_hours_request(
    *,
    shortfall_date: date,
    make_up_date: date,
    make_up_day_type: str,
    compensation_window_days: int,
    max_comp_hours_per_month: Decimal | None,
    month_hours_already_used: Decimal,
    hours_to_work: Decimal,
    allow_makeup_on_week_off: bool,
    allow_makeup_on_mandatory_holiday: bool,
) -> CompHoursValidation:
    """Compensatory Hours §2.6: the make-up date must fall inside the
    Compensation Window, under the monthly cap, and on a day type the policy
    permits (a non-working Saturday usually allowed, a Mandatory holiday
    usually not).
    """
    last_permissible = shortfall_date + timedelta(days=compensation_window_days) if compensation_window_days > 0 else shortfall_date
    within_window = make_up_date <= last_permissible

    within_cap = True
    if max_comp_hours_per_month:
        within_cap = (month_hours_already_used + hours_to_work) <= max_comp_hours_per_month

    day_type_permitted = True
    if make_up_day_type == "WEEKLY_OFF" and not allow_makeup_on_week_off:
        day_type_permitted = False
    if make_up_day_type == "MANDATORY_HOLIDAY" and not allow_makeup_on_mandatory_holiday:
        day_type_permitted = False

    return CompHoursValidation(
        window_last_permissible_date=last_permissible,
        within_window=within_window,
        within_monthly_cap=within_cap,
        day_type_permitted=day_type_permitted,
    )


def estimate_payroll_impact(hours_short: Decimal, hourly_rate: Decimal, shortfall_treatment: str, net_hours_per_day: Decimal) -> Decimal:
    """"Payroll Impact if Rejected" (§2.6) — shown up front. hourly_rate is
    the caller's responsibility to derive (from the salary structure); this
    only applies the policy's stated treatment to the hours at risk.
    net_hours_per_day is the covering WorkWeekPolicy's net_working_hours_per_day
    (Masters §3.20, dynamic — not guaranteed to be 8) so "a full/half working
    day" here always agrees with the org's actual configured policy.
    """
    if shortfall_treatment == "IGNORE":
        return Decimal("0")
    if shortfall_treatment == "ROUND_FULL_DAY":
        return (hourly_rate * net_hours_per_day).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if shortfall_treatment == "ROUND_HALF_DAY":
        return (hourly_rate * net_hours_per_day / 2).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    # PRO_RATA_LOP and LEAVE_THEN_LOP both ultimately price the shortfall
    # hours pro-rata if unresolved — LEAVE_THEN_LOP's leave-balance offset is
    # a payroll-run-time decision this estimate cannot know in advance.
    return (hourly_rate * hours_short).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
