from datetime import datetime, timedelta

from app.services.ticket_engine import first_response_duration, format_duration, resolve_duration


def test_first_response_none_when_no_reply_yet():
    assert first_response_duration(datetime(2026, 8, 1, 9, 0), None) is None


def test_first_response_duration_computed():
    raised = datetime(2026, 8, 1, 9, 0)
    replied = datetime(2026, 8, 1, 13, 20)
    assert first_response_duration(raised, replied) == timedelta(hours=4, minutes=20)


def test_resolve_duration_none_when_unresolved():
    assert resolve_duration(datetime(2026, 8, 1, 9, 0), None) is None


def test_resolve_duration_computed():
    raised = datetime(2026, 8, 1, 9, 0)
    resolved = datetime(2026, 8, 3, 9, 0)
    assert resolve_duration(raised, resolved) == timedelta(days=2)


def test_format_duration_none():
    assert format_duration(None) is None


def test_format_duration_hours_and_minutes():
    assert format_duration(timedelta(hours=4, minutes=20)) == "4h 20m"


def test_format_duration_minutes_only():
    assert format_duration(timedelta(minutes=45)) == "45m"


def test_format_duration_days_and_hours():
    assert format_duration(timedelta(days=2, hours=3)) == "2d 3h"
