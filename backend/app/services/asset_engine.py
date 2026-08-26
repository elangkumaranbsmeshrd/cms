"""Pure calculation functions for Asset Management (03-asset-management-module.md)
— no DB access, same isolated-service pattern as tax_engine.py/finance_engine.py.

Current Value is deliberately NEVER a stored column (see 0006_operations.py's
docstring) — "recalculated automatically at the start of each financial
year" is satisfied by computing it live, on every read, rather than building
a batch/cron job this codebase has no infrastructure for.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal


def _straight_line(purchase_value: Decimal, useful_life_years: int, purchase_date: date, as_of: date) -> Decimal:
    """§2.5, verbatim formula: Current Value = Purchase Value − (Purchase
    Value ÷ Useful Life in Years × Number of Years Since Purchase Date).
    """
    years_since_purchase = Decimal((as_of - purchase_date).days) / Decimal("365.25")
    depreciated = (purchase_value / Decimal(useful_life_years)) * years_since_purchase
    return purchase_value - depreciated


# §2.5: "the calculation logic should be written so adding [Written Down
# Value] is a matter of adding a new formula behind the same Depreciation
# Method dropdown, not restructuring this screen." Only STRAIGHT_LINE is
# offered today (the DB CHECK only allows that one value, same convention
# as every other VARCHAR+CHECK enum in this codebase — adding WDV is a
# migration, same cost as adding any other enum value here) — but the
# dispatch seam itself already exists, so that migration is the only
# future change needed, never a rewrite of this function or its callers.
_DEPRECIATION_METHODS = {"STRAIGHT_LINE": _straight_line}


def calculate_current_value(
    purchase_value: Decimal | None, useful_life_years: int | None, purchase_date: date, as_of: date,
    depreciation_method: str = "STRAIGHT_LINE",
) -> Decimal | None:
    """Never guesses: returns None ("Not available") if either input is
    missing. Floors at ₹0 — never negative, even for a very old asset still
    in use well past its useful life.
    """
    if purchase_value is None or useful_life_years is None:
        return None
    formula = _DEPRECIATION_METHODS[depreciation_method]
    current_value = formula(purchase_value, useful_life_years, purchase_date, as_of)
    return max(current_value, Decimal("0")).quantize(Decimal("0.01"))


def days_until(target_date: date | None, as_of: date) -> int | None:
    """Shared by warranty-expiring and maintenance-due-soon windows (§2.1,
    §2.4, §2.7) — positive means still ahead, negative means already past,
    None means no date set at all.
    """
    if target_date is None:
        return None
    return (target_date - as_of).days
