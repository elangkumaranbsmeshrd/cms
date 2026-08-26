"""Opportunity (09-opportunity-module.md) — a small pure suggestion function
plus the one piece of shared, DB-touching logic §3.3 explicitly requires be
callable from two independent places without duplicating it.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.opportunity import Opportunity

_PROBABILITY_BY_STAGE = {
    "PROSPECTING": Decimal("10"), "QUALIFYING": Decimal("30"), "PROPOSAL": Decimal("60"),
    "WON": Decimal("100"), "LOST": Decimal("0"),
}


def suggest_probability(stage: str) -> Decimal | None:
    """§2.2: "When Stage changes, Probability auto-fills to a suggested
    value... It stays manually editable after auto-filling." Returns the
    suggestion only — callers decide whether to apply it (never override an
    explicit user-entered value).
    """
    return _PROBABILITY_BY_STAGE.get(stage)


async def mark_opportunity_won(db: AsyncSession, opportunity: Opportunity, actor_user_id: str) -> bool:
    """§3.3, "The Won Trigger — Both Directions": Path A is a direct Stage
    change on this module's own Add/Edit form; Path B is the Project module
    auto-calling this when a Project is created against an Opportunity
    that isn't already Won. Both must go through this one function so
    neither path can drift from the other. Returns True if it actually
    changed anything (already-Won is a silent no-op, per §2.2's own "if the
    Opportunity was already Won... nothing changes on it").
    """
    if opportunity.stage == "WON":
        return False
    opportunity.stage = "WON"
    opportunity.probability_pct = suggest_probability("WON")
    opportunity.updated_by = actor_user_id
    return True
