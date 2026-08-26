from datetime import date
from decimal import Decimal

from app.services.asset_engine import calculate_current_value, days_until


def test_current_value_missing_purchase_value_returns_none():
    assert calculate_current_value(None, 5, date(2020, 1, 1), date(2026, 1, 1)) is None


def test_current_value_missing_useful_life_returns_none():
    assert calculate_current_value(Decimal("100000"), None, date(2020, 1, 1), date(2026, 1, 1)) is None


def test_current_value_at_purchase_equals_full_value():
    result = calculate_current_value(Decimal("100000"), 5, date(2026, 1, 1), date(2026, 1, 1))
    assert result == Decimal("100000.00")


def test_current_value_halfway_through_useful_life():
    # 5-year useful life, 2.5 years elapsed -> half depreciated.
    result = calculate_current_value(Decimal("100000"), 5, date(2020, 1, 1), date(2022, 7, 2))
    assert Decimal("49000") < result < Decimal("51000")


def test_current_value_floors_at_zero_past_useful_life():
    # 10 years past a 5-year useful life — must not go negative.
    result = calculate_current_value(Decimal("100000"), 5, date(2010, 1, 1), date(2026, 1, 1))
    assert result == Decimal("0.00")


def test_days_until_none_when_no_target_date():
    assert days_until(None, date(2026, 8, 1)) is None


def test_days_until_positive_when_still_ahead():
    assert days_until(date(2026, 9, 1), date(2026, 8, 1)) == 31


def test_days_until_negative_when_already_past():
    assert days_until(date(2026, 7, 1), date(2026, 8, 1)) == -31
