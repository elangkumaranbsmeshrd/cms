"""THE LOCK RULE (APPENDIX-B:13), enforced at the application layer.

The spec calls this rule absolute and says it "overrides every role
permission": once a Financial Year is locked, "every record dated inside that
year IN EVERY MODULE becomes permanently read-only. Nothing dated inside it can
be added, edited or deleted by anyone - not even the Super Admin who locked
it."

Layer 3 found it was not actually enforced. `grep -rn '"locked"' app/` hit
financial_years.py and nothing else: the rule was carried entirely by MySQL
triggers, and that coverage is uneven in two ways that matter.

  - 15 tables carry a BEFORE INSERT trigger with no BEFORE UPDATE counterpart
    (tax_declarations, leave_requests, resignations, offer_letters, payslips,
    payroll_runs, adhoc_payslip_adjustments among them), so an UPDATE inside a
    frozen year passes.
  - tax_declaration_lines has no FY-lock trigger at all, and that is where
    declared amounts live. Rewriting one changes the figure that feeds
    APPENDIX-B:230's income-tax calculation, inside a year that is supposed to
    be closed.

A trigger is also the wrong place to be the ONLY guard even where it exists:
it surfaces as the generic "Rejected by a database constraint" 409, which never
tells the user a year is locked or which year it was. The triggers stay as
defence in depth; this is the layer that refuses in language a person can act
on.

Deliberately NOT role-aware. Every other guard in this codebase takes a
PermissionSet; this one does not, because the rule's whole point is that it
outranks permissions. A Super Admin gets the same refusal.
"""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.numbering import FinancialYear


async def assert_fy_not_locked(db: AsyncSession, financial_year_id: str | None, *, what: str = "This record") -> None:
    """Refuse if the named Financial Year is locked.

    Preferred over the date variant wherever a record already carries its
    financial_year_id: it is the year the record was actually filed under,
    rather than whichever year a date happens to land in. A record whose FY was
    snapshotted at creation should be judged by that snapshot.
    """
    if financial_year_id is None:
        return
    fy = await db.get(FinancialYear, financial_year_id)
    if fy is not None and fy.locked_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"{what} belongs to Financial Year {fy.label}, which is locked. "
                "A locked year is read-only for everyone, including Super Admin. Unlock the year first."
            ),
        )


async def assert_date_not_in_locked_fy(db: AsyncSession, value: date | None, *, what: str = "This record") -> None:
    """Refuse if `value` falls inside a locked Financial Year.

    `value` of None is allowed through: an undated record cannot belong to a
    year, and inventing a date to test against would be worse than admitting
    the rule does not apply.
    """
    if value is None:
        return

    fy = (
        await db.execute(
            select(FinancialYear).where(
                FinancialYear.start_date <= value,
                FinancialYear.end_date >= value,
                FinancialYear.locked_at.is_not(None),
            )
        )
    ).scalar_one_or_none()

    if fy is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"{what} is dated {value.isoformat()}, inside Financial Year {fy.label}, which is locked. "
                "A locked year is read-only for everyone, including Super Admin. Unlock the year first."
            ),
        )
