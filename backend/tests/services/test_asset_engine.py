"""Straight-line depreciation (APPENDIX-B:263) and the shared date-window
helper.

    Current Value = Purchase Value - (Purchase Value / Useful Life in Years
                                      x Number of Years Since Purchase Date)

Every expected number below is worked out by hand from that line and from
APPENDIX-B:265 ("value does not drop below Rs.0") / APPENDIX-B:266 ("if
Purchase Value OR Useful Life is missing ... 'Not available' ... never guess,
never zero-fill"), with the arithmetic written out above the assertion.

The engine reads "Years Since Purchase" as (as_of - purchase_date).days /
365.25 - a Julian year, so four calendar years spanning exactly one leap day
(1461 days) is exactly 4.00 years. Most spans below are chosen to be whole
multiples of 365.25 days so the hand arithmetic is exact rather than
approximate.
"""

from datetime import date
from decimal import Decimal, DivisionByZero

import pytest

from app.services.asset_engine import calculate_current_value, days_until


# --------------------------------------------------------- missing inputs
def test_current_value_missing_purchase_value_returns_none():
    assert calculate_current_value(None, 5, date(2020, 1, 1), date(2026, 1, 1)) is None


def test_current_value_missing_useful_life_returns_none():
    assert calculate_current_value(Decimal("100000"), None, date(2020, 1, 1), date(2026, 1, 1)) is None


def test_current_value_both_inputs_missing_returns_none():
    # APPENDIX-B:266 — "Not available", never a guess and never a zero-fill.
    # Zero would be a legitimate-looking number here, so None is the only
    # correct answer.
    assert calculate_current_value(None, None, date(2020, 1, 1), date(2026, 1, 1)) is None


# ------------------------------------------------------------------ year 0
def test_current_value_at_purchase_equals_full_value():
    result = calculate_current_value(Decimal("100000"), 5, date(2026, 1, 1), date(2026, 1, 1))
    assert result == Decimal("100000.00")


def test_current_value_of_an_asset_purchased_today_is_exactly_its_purchase_value():
    # as_of == purchase_date -> 0 days -> 0 / 365.25 = 0.00 years.
    #   depreciated = (12345.67 / 5) x 0.00 = 0.00
    #   current     = 12345.67 - 0.00      = 12345.67
    # An odd-paise purchase value proves nothing is lost to rounding on day 0.
    result = calculate_current_value(Decimal("12345.67"), 5, date(2026, 8, 26), date(2026, 8, 26))
    assert result == Decimal("12345.67")


# ----------------------------------------------------------------- mid-life
def test_current_value_halfway_through_useful_life():
    # 2020-01-01 -> 2022-07-02 = 913 days (366 + 365 + 182).
    #   years       = 913 / 365.25          = 2.4996577686516...
    #   depreciated = (100000 / 5) x that   = 20000 x 2.4996577686516
    #               = 49993.15537303216...
    #   current     = 100000 - 49993.155373 = 50006.84462696784...
    #               -> 50006.84 at 2 dp
    result = calculate_current_value(Decimal("100000"), 5, date(2020, 1, 1), date(2022, 7, 2))
    assert result == Decimal("50006.84")


def test_current_value_at_exactly_half_the_useful_life_is_exactly_half_the_value():
    # 2020-01-01 -> 2024-01-01 = 366 + 365 + 365 + 365 = 1461 days,
    # and 1461 / 365.25 = 4.00 years EXACTLY (no rounding anywhere).
    #   depreciated = (120000 / 8) x 4 = 15000 x 4 = 60000
    #   current     = 120000 - 60000            = 60000.00
    result = calculate_current_value(Decimal("120000"), 8, date(2020, 1, 1), date(2024, 1, 1))
    assert result == Decimal("60000.00")


def test_one_day_of_depreciation_uses_a_365_25_day_year():
    # A single day off a one-year life, on a purchase value chosen so the
    # daily slice is a whole rupee: 36525 / 365.25 = 100 exactly.
    #   years       = 1 / 365.25
    #   depreciated = (36525 / 1) x (1 / 365.25) = 36525 / 365.25 = 100
    #   current     = 36525 - 100               = 36425.00
    result = calculate_current_value(Decimal("36525"), 1, date(2026, 1, 1), date(2026, 1, 2))
    assert result == Decimal("36425.00")


# ------------------------------------------------------------- end of life
def test_current_value_at_exactly_end_of_useful_life_is_zero_not_negative():
    # 1461 days / 365.25 = 4.00 years exactly, against a 4-year life.
    #   depreciated = (100000 / 4) x 4 = 25000 x 4 = 100000
    #   current     = 100000 - 100000           = 0.00
    # Exactly zero falls out of the formula itself here — the floor is not
    # doing the work, so this proves the formula lands on 0 rather than on
    # some small negative that only the clamp hides.
    result = calculate_current_value(Decimal("100000"), 4, date(2020, 1, 1), date(2024, 1, 1))
    assert result == Decimal("0.00")
    assert result >= Decimal("0")


def test_current_value_on_the_calendar_anniversary_of_end_of_life_clamps_to_zero():
    # The realistic "exactly five years old" case, where the calendar
    # anniversary is slightly MORE than 5.00 Julian years:
    # 2020-01-01 -> 2025-01-01 = 366+365+365+365+366 = 1827 days.
    #   years       = 1827 / 365.25             = 5.0020533880903...
    #   depreciated = (100000 / 5) x that       = 20000 x 5.00205338809
    #               = 100041.0677618...
    #   raw current = 100000 - 100041.0677618   = -41.0677618...
    # APPENDIX-B:265 "value does not drop below Rs.0" -> the floor is what
    # turns this into 0.00.
    result = calculate_current_value(Decimal("100000"), 5, date(2020, 1, 1), date(2025, 1, 1))
    assert result == Decimal("0.00")


def test_current_value_floors_at_zero_past_useful_life():
    # 10 years past a 5-year useful life — must not go negative.
    result = calculate_current_value(Decimal("100000"), 5, date(2010, 1, 1), date(2026, 1, 1))
    assert result == Decimal("0.00")


def test_current_value_far_past_end_of_life_clamps_and_never_goes_negative():
    # 2020-01-01 -> 2028-01-01 = 2922 days = 8.00 years exactly
    # (2922 / 365.25 = 8), i.e. twice a 4-year life.
    #   depreciated = (100000 / 4) x 8 = 25000 x 8 = 200000
    #   raw current = 100000 - 200000            = -100000  <- exactly minus
    #                                                          the purchase
    #                                                          value again
    #   clamped                                  = 0.00
    result = calculate_current_value(Decimal("100000"), 4, date(2020, 1, 1), date(2028, 1, 1))
    assert result == Decimal("0.00")
    assert result >= Decimal("0")


# ------------------------------------------------------------ divide by zero
def test_useful_life_of_zero_cannot_silently_produce_a_number():
    # The formula divides by Useful Life in Years, so 0 is the one input that
    # has no arithmetic answer. The real guard is the schema —
    # alembic/versions/0006_operations.py:589
    #   CONSTRAINT ck_assets_useful_life CHECK (useful_life_years IS NULL OR
    #                                           useful_life_years > 0)
    # — so 0 can never reach this function from a stored asset. What matters
    # for the calculation itself is that a 0 does not quietly turn into a
    # number: it must fail loudly rather than return the purchase value,
    # infinity, or a zero-filled figure APPENDIX-B:266 forbids.
    with pytest.raises(DivisionByZero):
        calculate_current_value(Decimal("100000"), 0, date(2020, 1, 1), date(2026, 1, 1))


# ---------------------------------------------------------------- rounding
def test_current_value_is_rounded_to_two_decimal_places():
    # 1461 days = 4.00 years exactly, against a 7-year life:
    #   annual slice = 10000 / 7          = 1428.571428571428571...
    #   depreciated  = 1428.5714285714 x 4 = 5714.2857142857142857...
    #   current      = 10000 - 5714.285714 = 4285.7142857142857142...
    #                -> 4285.71 at 2 dp (third decimal is 4, so it rounds
    #                   down under every rounding mode)
    result = calculate_current_value(Decimal("10000"), 7, date(2020, 1, 1), date(2024, 1, 1))
    assert result == Decimal("4285.71")
    assert result.as_tuple().exponent == -2  # money, always exactly 2 dp


# --------------------------------------------------- nothing is a constant
def test_the_useful_life_actually_drives_the_number():
    # Same asset, same dates (1461 days = 4.00 years exactly), two different
    # useful lives — the answers must differ, or the input is being ignored.
    #   L =  8: depreciated = (120000 /  8) x 4 = 15000 x 4 = 60000
    #           current     = 120000 - 60000               = 60000.00
    #   L = 16: depreciated = (120000 / 16) x 4 =  7500 x 4 = 30000
    #           current     = 120000 - 30000               = 90000.00
    eight = calculate_current_value(Decimal("120000"), 8, date(2020, 1, 1), date(2024, 1, 1))
    sixteen = calculate_current_value(Decimal("120000"), 16, date(2020, 1, 1), date(2024, 1, 1))
    assert eight == Decimal("60000.00")
    assert sixteen == Decimal("90000.00")
    assert eight != sixteen


def test_the_purchase_value_actually_drives_the_number():
    # Doubling Purchase Value must exactly double Current Value, since the
    # formula is linear in it: PV - (PV / L) x Y = PV x (1 - Y / L).
    #   Y / L = 4 / 8 = 0.5, so current = PV x 0.5
    #   PV =  60000 -> 30000.00
    #   PV = 120000 -> 60000.00
    small = calculate_current_value(Decimal("60000"), 8, date(2020, 1, 1), date(2024, 1, 1))
    large = calculate_current_value(Decimal("120000"), 8, date(2020, 1, 1), date(2024, 1, 1))
    assert small == Decimal("30000.00")
    assert large == Decimal("60000.00")
    assert large == small * 2


def test_only_straight_line_is_dispatchable_today():
    # APPENDIX-B:263 "Straight Line is the only method available today" and
    # APPENDIX-B:268 requires a dispatch seam for a future Written Down Value
    # method. An unknown method must not fall back to straight line and
    # quietly report a straight-line number under a WDV label.
    with pytest.raises(KeyError):
        calculate_current_value(
            Decimal("100000"), 5, date(2020, 1, 1), date(2024, 1, 1), depreciation_method="WRITTEN_DOWN_VALUE"
        )


# --------------------------------------------------------------- days_until
def test_days_until_none_when_no_target_date():
    assert days_until(None, date(2026, 8, 1)) is None


def test_days_until_positive_when_still_ahead():
    assert days_until(date(2026, 9, 1), date(2026, 8, 1)) == 31


def test_days_until_negative_when_already_past():
    assert days_until(date(2026, 7, 1), date(2026, 8, 1)) == -31


def test_days_until_is_zero_on_the_day_itself():
    # The boundary between "expiring" and "expired": 0, not 1 and not -1.
    assert days_until(date(2026, 8, 1), date(2026, 8, 1)) == 0
