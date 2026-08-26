from decimal import Decimal

from app.services.opportunity_engine import suggest_probability


def test_suggest_probability_prospecting():
    assert suggest_probability("PROSPECTING") == Decimal("10")


def test_suggest_probability_qualifying():
    assert suggest_probability("QUALIFYING") == Decimal("30")


def test_suggest_probability_proposal():
    assert suggest_probability("PROPOSAL") == Decimal("60")


def test_suggest_probability_won():
    assert suggest_probability("WON") == Decimal("100")


def test_suggest_probability_lost():
    assert suggest_probability("LOST") == Decimal("0")


def test_suggest_probability_unknown_stage_returns_none():
    assert suggest_probability("NOT_A_REAL_STAGE") is None
