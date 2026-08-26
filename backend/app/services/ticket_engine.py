"""Pure calculation functions for Ticket (04-ticket-module.md) — no DB
access, same isolated-service pattern as tax_engine.py/finance_engine.py.
Shared by both the Ticket Detail header badge and Support Reports' averages
so the two figures can never drift.
"""

from __future__ import annotations

from datetime import datetime, timedelta


def first_response_duration(raised_at: datetime, first_reply_at: datetime | None) -> timedelta | None:
    """Appendix B, verbatim: "timestamp of the first Public Reply minus
    Raised Date. Blank/absent until the first Public Reply exists." An
    Internal Note never counts — only a Public Reply captures this.
    """
    if first_reply_at is None:
        return None
    return first_reply_at - raised_at


def resolve_duration(raised_at: datetime, resolved_at: datetime | None, closed_at: datetime | None = None) -> timedelta | None:
    """Appendix B, verbatim: "from Raised Date to Resolved/Closed date" —
    either counts. A ticket closed without ever passing through Resolved
    (Manager/Super Admin can do this directly) must still produce a duration,
    not silently drop out of the average.
    """
    end = resolved_at or closed_at
    if end is None:
        return None
    return end - raised_at


def format_duration(td: timedelta | None) -> str | None:
    """§2.1/§2.3: shown as a small duration badge, e.g. "4h 20m"."""
    if td is None:
        return None
    total_minutes = int(td.total_seconds() // 60)
    if total_minutes < 0:
        total_minutes = 0
    days, remainder_minutes = divmod(total_minutes, 24 * 60)
    hours, minutes = divmod(remainder_minutes, 60)
    if days > 0:
        return f"{days}d {hours}h"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"
