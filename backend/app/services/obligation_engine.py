"""Module 15's Obligations register (15-tax-compliance-module.md §2.2/§2.3) —
DB-touching, same convention as hour_reconciliation.py/numbering.py: this
genuinely needs to read existing withheld-amount rows, so it isn't pure.

THE REGISTER ITSELF IS NEVER STORED. A "period" here is a computed grouping
key, not a row anywhere. Every figure is derived fresh from three places that
already exist and were built in earlier phases:
  - purchase_bills.withholding_amount (vendor withholding, Module 13 §2.2)
  - payslip_statutory_lines.computed_amount (employee deduction, Module 6 §2.1)
  - remittances.amount_remitted (this module's own §2.4, including negative
    reversal rows, which is exactly what makes a reversal net out correctly
    without any special-casing here)
This mirrors the MonthlyHourReconciliation/asset-depreciation/milestone-
auto-Missed precedent this project uses whenever a derived rollup would
silently drift if it were stored instead of recomputed on read.

WHY ONLY TWO SOURCES FEED OBLIGATIONS, NOT THREE — flagged, not silently
decided: §1's own table names exactly three flows, and only two of them
create a LIABILITY (Purchase Bill withholding, Payroll deduction); the third
(Invoice → Record Payment, a customer withholding from the company) creates
an ASSET and feeds Credits (§2.6) instead, via credits_engine functions
below. A tax_heads row on a fourth scope (e.g. SALES_BILLING output GST)
technically CAN have creates_onward_liability=1 at the DB level — Masters'
own CHECK constraint doesn't restrict which scope may set it — but §1's
"Three separate flows" framing is exhaustive; the company's own output-GST
liability is a different kind of obligation this module was never scoped to
track (nowhere in §1-§9 is a fourth flow described). Any such head is
therefore silently excluded from this register rather than guessed into one
of the two real source tables — see _liability_source_for_head below.

PERIOD-ALIGNMENT ASSUMPTIONS, flagged per this project's standing discipline
of stating what the spec leaves open rather than guessing quietly:
  - MONTHLY periods align to real calendar months when period_aligns_to is
    CALENDAR *or* FINANCIAL_YEAR — a financial year's start month doesn't
    change what a "month" IS, only which one a fiscal quarter starts on, so
    FINANCIAL_YEAR only changes behaviour for QUARTERLY/HALF_YEARLY/ANNUAL.
  - QUARTERLY/HALF_YEARLY/ANNUAL periods align to real Gregorian boundaries
    when period_aligns_to is CALENDAR *or* PAY_CYCLE — the Pay Cycle concept
    (Masters §3.20c, a 26th-25th style monthly cutoff) has no native
    quarterly/half-yearly/annual shape, and the spec gives no worked example
    for that combination (its own worked example, §2.2, is explicitly
    MONTHLY payroll periods aligned to Pay Cycle).
  - PAY_CYCLE + MONTHLY reuses the company's one active PayCycle row exactly
    as payroll_runs.py resolves it — same "which pay-cycle month contains
    this date" math as resolve_pay_period, run in reverse (date -> period,
    not period -> date).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.compliance import Remittance, RemittanceAllocation
from app.models.finance import PurchaseBill
from app.models.masters import PayCycle, TaxHead, TaxHeadWithholdingDirection
from app.models.payroll import Payslip, PayslipStatutoryLine

DUE_SOON_DAYS = 7  # §4: "a fixed platform figure... not a per-head field"

# PAYROLL_EMPLOYER_CONTRIBUTION is deliberately excluded — same reasoning as
# the SALES_BILLING exclusion above, found by the close-out audit: an
# employer contribution (e.g. Employer PF) is never withheld FROM the
# employee at all (payroll_runs.py defaults its borne_by to "EMPLOYER"); it's
# the company's own direct cost, not money "held on somebody else's behalf"
# (§1). Labeling it Source="Employee" would misattribute whose money is at
# stake, and its own Net Paid (document_total - withheld) would subtract an
# employer-borne amount from gross pay, producing a figure with no relation
# to what the employee actually received. Only a genuine employee-side
# deduction is one of §1's three real flows.
_LIABILITY_PAYROLL_SCOPES = ("PAYROLL_EMPLOYEE_DEDUCTION", "PAYROLL_INCOME_TAX")


@dataclass(frozen=True)
class SourceAmount:
    source_type: str  # PURCHASE_BILL | PAYSLIP_STATUTORY_LINE
    source_id: str
    event_date: date
    amount: Decimal
    # Drill-down (§2.3) columns — carried alongside so By Document never
    # needs a second query per row.
    document_label: str
    counterparty: str
    document_total: Decimal
    calculated_on: str | None = None


@dataclass(frozen=True)
class ObligationPeriod:
    tax_head_id: str
    tax_head_name: str
    remitted_to: str | None
    source_label: str  # "Vendor" | "Employee"
    period_label: str
    period_from: date
    period_to: date
    withheld: Decimal
    remitted: Decimal
    outstanding: Decimal
    due_date: date
    status: str
    authority_reference_label: str | None
    documents: tuple[SourceAmount, ...] = field(default_factory=tuple)


def _liability_source_for_head(head: TaxHead, directions: set[str]) -> tuple[str, str] | None:
    """Returns (source_type, source_label) or None if this head isn't one of
    the two liability-creating flows §1 actually describes.
    """
    if head.scope == "WITHHOLDING_AT_SOURCE" and "ON_PAYMENTS_MADE" in directions:
        return "PURCHASE_BILL", "Vendor"
    if head.scope in _LIABILITY_PAYROLL_SCOPES:
        return "PAYSLIP_STATUTORY_LINE", "Employee"
    return None


def _pay_cycle_period_for_date(event_date: date, start_day: int, end_day: int) -> tuple[date, date]:
    """The inverse of payroll_engine.resolve_pay_period: given a date, which
    FIXED_CYCLE pay-cycle period (start_day..end_day, wrapping a month
    boundary, e.g. 26th-25th) contains it. Mirrors that function's own
    month-clamping so a short month (Feb 30 -> Feb 28/29) behaves identically.
    """
    from app.services.payroll_engine import _clamp_day

    if event_date.day > end_day:
        end_month, end_year = (event_date.month + 1, event_date.year) if event_date.month < 12 else (1, event_date.year + 1)
    else:
        end_month, end_year = event_date.month, event_date.year
    period_end = _clamp_day(end_year, end_month, end_day)
    start_month, start_year = (end_month - 1, end_year) if end_month > 1 else (12, end_year - 1)
    period_start = _clamp_day(start_year, start_month, start_day)
    return period_start, period_end


def _anchored_bounds(event_date: date, anchor_month: int, span_months: int) -> tuple[date, date]:
    """The general case every cadence below reduces to: a run of
    `span_months` calendar months, tiled from `anchor_month` (1=January,
    4=April, ...), that contains `event_date`. Worked entirely in absolute
    month-index arithmetic (year*12 + month-1) so wraparound across a year
    boundary — the part every earlier hand-rolled attempt at this got wrong —
    falls out of plain modular arithmetic instead of if/elif year-carry logic.
    """
    from app.services.payroll_engine import _clamp_day

    event_abs = event_date.year * 12 + (event_date.month - 1)
    anchor_abs = event_date.year * 12 + (anchor_month - 1)
    offset = (event_abs - anchor_abs) % span_months
    start_abs = event_abs - offset
    end_abs = start_abs + span_months - 1
    start_year, start_month0 = divmod(start_abs, 12)
    end_year, end_month0 = divmod(end_abs, 12)
    return date(start_year, start_month0 + 1, 1), _clamp_day(end_year, end_month0 + 1, 31)


def _calendar_month(event_date: date) -> tuple[date, date]:
    return _anchored_bounds(event_date, 1, 1)


def _quarter_bounds(event_date: date, anchor_month: int) -> tuple[date, date]:
    return _anchored_bounds(event_date, anchor_month, 3)


def _half_bounds(event_date: date, anchor_month: int) -> tuple[date, date]:
    return _anchored_bounds(event_date, anchor_month, 6)


def _annual_bounds(event_date: date, anchor_month: int) -> tuple[date, date]:
    return _anchored_bounds(event_date, anchor_month, 12)


def resolve_period_bounds(
    event_date: date,
    remittance_period: str,
    period_aligns_to: str,
    deposit_due_days: int,
    *,
    pay_cycle: PayCycle | None = None,
    fy_start_month: int | None = None,
) -> tuple[date, date, str, date]:
    """Returns (period_from, period_to, period_label, due_date)."""
    if remittance_period == "PER_DOCUMENT":
        period_from = period_to = event_date
        label = f"Document dated {event_date.isoformat()}"
    elif remittance_period == "MONTHLY":
        if period_aligns_to == "PAY_CYCLE" and pay_cycle is not None and pay_cycle.cycle_type == "FIXED_CYCLE":
            period_from, period_to = _pay_cycle_period_for_date(event_date, pay_cycle.start_day, pay_cycle.end_day)
        else:
            period_from, period_to = _calendar_month(event_date)
        label = period_to.strftime("%B %Y")
    else:
        anchor_month = fy_start_month if (period_aligns_to == "FINANCIAL_YEAR" and fy_start_month) else 1
        if remittance_period == "QUARTERLY":
            period_from, period_to = _quarter_bounds(event_date, anchor_month)
            label = f"Q ending {period_to.strftime('%b %Y')}"
        elif remittance_period == "HALF_YEARLY":
            period_from, period_to = _half_bounds(event_date, anchor_month)
            label = f"H ending {period_to.strftime('%b %Y')}"
        else:  # ANNUAL
            period_from, period_to = _annual_bounds(event_date, anchor_month)
            label = f"Year ending {period_to.strftime('%b %Y')}"
    due_date = period_to + timedelta(days=deposit_due_days)
    return period_from, period_to, label, due_date


def compute_status(withheld: Decimal, remitted: Decimal, due_date: date, as_of: date) -> str:
    """§2.2's status precedence, verbatim, first match wins."""
    outstanding = withheld - remitted
    if withheld > 0 and remitted >= withheld:
        return "REMITTED"
    if due_date < as_of and outstanding > 0:
        return "OVERDUE"
    if due_date - timedelta(days=DUE_SOON_DAYS) <= as_of <= due_date and outstanding > 0:
        return "DUE_SOON"
    if remitted > 0 and remitted < withheld:
        return "PART_REMITTED"
    return "OPEN"


async def has_any_liability_head(db: AsyncSession) -> bool:
    """§2.1's "nothing is configured" empty state — whether the Obligations
    panel has anything to ever show, distinct from "configured but zero
    activity yet."
    """
    return len(await _liability_heads(db, None)) > 0


async def _liability_heads(db: AsyncSession, tax_head_id: str | None) -> list[tuple[TaxHead, str, str]]:
    stmt = select(TaxHead).where(TaxHead.creates_onward_liability.is_(True))
    if tax_head_id:
        stmt = stmt.where(TaxHead.id == tax_head_id)
    heads = (await db.execute(stmt)).scalars().all()
    if not heads:
        return []
    directions_by_head: dict[str, set[str]] = {}
    rows = (
        await db.execute(select(TaxHeadWithholdingDirection).where(TaxHeadWithholdingDirection.tax_head_id.in_([h.id for h in heads])))
    ).scalars().all()
    for r in rows:
        directions_by_head.setdefault(r.tax_head_id, set()).add(r.direction)
    result = []
    for head in heads:
        source = _liability_source_for_head(head, directions_by_head.get(head.id, set()))
        if source is not None:
            result.append((head, source[0], source[1]))
    return result


async def _source_amounts_for_head(db: AsyncSession, head: TaxHead, source_type: str) -> list[SourceAmount]:
    if source_type == "PURCHASE_BILL":
        bills = (await db.execute(select(PurchaseBill).where(PurchaseBill.withholding_tax_head_id == head.id, PurchaseBill.withholding_amount > 0))).scalars().all()
        out = []
        for b in bills:
            if head.liability_arises_on == "PAYMENT_DATE":
                if b.paid_at is None:
                    continue  # not yet paid -> the liability hasn't arisen yet under this head's own rule
                event_date = b.paid_at.date()
            else:
                event_date = b.bill_date
            out.append(SourceAmount(
                source_type="PURCHASE_BILL", source_id=b.id, event_date=event_date, amount=b.withholding_amount,
                document_label=b.purchase_bill_code, counterparty=b.vendor_name_snapshot, document_total=b.total_amount,
                calculated_on=b.withholding_calculated_on,
            ))
        return out

    lines = (
        await db.execute(
            select(PayslipStatutoryLine, Payslip)
            .join(Payslip, Payslip.id == PayslipStatutoryLine.payslip_id)
            .where(PayslipStatutoryLine.tax_head_id == head.id, PayslipStatutoryLine.computed_amount > 0)
        )
    ).all()
    out = []
    for line, payslip in lines:
        event_date = payslip.salary_credit_date if head.liability_arises_on == "PAYMENT_DATE" else payslip.pay_period_end
        out.append(SourceAmount(
            source_type="PAYSLIP_STATUTORY_LINE", source_id=line.id, event_date=event_date, amount=line.computed_amount,
            document_label=f"Payslip {payslip.employee_id[:8]} — {payslip.pay_period_end.strftime('%b %Y')}",
            counterparty=payslip.employee_id, document_total=payslip.gross_pay,
        ))
    return out


async def resolve_document_labels(db: AsyncSession, refs: list[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """Batched (source_type, source_id) -> document_label, for showing a
    remittance's "Documents Covered" (§2.4/§2.5) without an N+1 query per
    allocation row — same two source tables/label formats as
    _source_amounts_for_head, just not scoped to one tax head.
    """
    bill_ids = [sid for st, sid in refs if st == "PURCHASE_BILL"]
    line_ids = [sid for st, sid in refs if st == "PAYSLIP_STATUTORY_LINE"]
    out: dict[tuple[str, str], str] = {}
    if bill_ids:
        for b in (await db.execute(select(PurchaseBill).where(PurchaseBill.id.in_(bill_ids)))).scalars().all():
            out[("PURCHASE_BILL", b.id)] = b.purchase_bill_code
    if line_ids:
        rows = (
            await db.execute(
                select(PayslipStatutoryLine.id, Payslip.employee_id, Payslip.pay_period_end)
                .join(Payslip, Payslip.id == PayslipStatutoryLine.payslip_id)
                .where(PayslipStatutoryLine.id.in_(line_ids))
            )
        ).all()
        for line_id, employee_id, pay_period_end in rows:
            out[("PAYSLIP_STATUTORY_LINE", line_id)] = f"Payslip {employee_id[:8]} — {pay_period_end.strftime('%b %Y')}"
    return out


async def _remitted_totals(db: AsyncSession, tax_head_id: str, period_from: date, period_to: date) -> Decimal:
    rows = (
        await db.execute(
            select(Remittance.amount_remitted).where(
                Remittance.tax_head_id == tax_head_id, Remittance.period_from == period_from, Remittance.period_to == period_to,
            )
        )
    ).scalars().all()
    return sum(rows, Decimal("0"))


async def build_obligation_periods(
    db: AsyncSession, as_of: date, *, tax_head_id: str | None = None, fy_start_month: int | None = None,
) -> list[ObligationPeriod]:
    """§2.2 — Obligations, one row per (tax head, period). This is the single
    function both the Overview widgets and the Obligations screen itself
    read, so the two can never disagree.
    """
    pay_cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    heads = await _liability_heads(db, tax_head_id)

    grouped: dict[tuple[str, date, date], list[SourceAmount]] = {}
    head_by_id: dict[str, TaxHead] = {}
    source_label_by_head: dict[str, str] = {}
    for head, source_type, source_label in heads:
        head_by_id[head.id] = head
        source_label_by_head[head.id] = source_label
        for amount in await _source_amounts_for_head(db, head, source_type):
            period_from, period_to, _label, _due = resolve_period_bounds(
                amount.event_date, head.remittance_period, head.period_aligns_to, head.deposit_due_days_after_period_end,
                pay_cycle=pay_cycle, fy_start_month=fy_start_month,
            )
            grouped.setdefault((head.id, period_from, period_to), []).append(amount)

    results: list[ObligationPeriod] = []
    for (head_id, period_from, period_to), amounts in grouped.items():
        head = head_by_id[head_id]
        withheld = sum((a.amount for a in amounts), Decimal("0"))
        remitted = await _remitted_totals(db, head_id, period_from, period_to)
        _pf, _pt, label, due_date = resolve_period_bounds(
            amounts[0].event_date, head.remittance_period, head.period_aligns_to, head.deposit_due_days_after_period_end,
            pay_cycle=pay_cycle, fy_start_month=fy_start_month,
        )
        status = compute_status(withheld, remitted, due_date, as_of)
        results.append(ObligationPeriod(
            tax_head_id=head_id, tax_head_name=head.tax_name, remitted_to=head.remitted_to_authority,
            source_label=source_label_by_head[head_id], period_label=label, period_from=period_from, period_to=period_to,
            withheld=withheld, remitted=remitted, outstanding=withheld - remitted, due_date=due_date, status=status,
            authority_reference_label=head.authority_reference_label, documents=tuple(amounts),
        ))
    results.sort(key=lambda r: r.due_date)
    return results


async def documents_in_period(
    db: AsyncSession, tax_head_id: str, period_from: date, period_to: date, *, fy_start_month: int | None = None,
) -> list[dict]:
    """Record Remittance's "Documents Covered" multi-select (§2.5): every
    withheld-amount document in this exact period, with how much of it is
    still un-allocated to any remittance yet.

    fy_start_month MUST be threaded through from the same source
    build_obligation_periods() uses (get_current_financial_year().start_date.
    month) — found missing entirely by the close-out audit: without it, a
    head with remittance_period ANNUAL/HALF_YEARLY/QUARTERLY and
    period_aligns_to FINANCIAL_YEAR silently re-derives every document's
    period January-anchored here while the Obligations screen showed it
    FY-anchored, so this function's period would never equal the
    period_from/period_to the caller (Record Remittance) is asking about —
    every document would look ineligible and no remittance could ever be
    recorded against such a head at all.
    """
    head = await db.get(TaxHead, tax_head_id)
    if head is None:
        return []
    directions_rows = (await db.execute(select(TaxHeadWithholdingDirection).where(TaxHeadWithholdingDirection.tax_head_id == tax_head_id))).scalars().all()
    source = _liability_source_for_head(head, {r.direction for r in directions_rows})
    if source is None:
        return []
    source_type, _label = source
    pay_cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()

    amounts = [
        a for a in await _source_amounts_for_head(db, head, source_type)
        if resolve_period_bounds(a.event_date, head.remittance_period, head.period_aligns_to, head.deposit_due_days_after_period_end, pay_cycle=pay_cycle, fy_start_month=fy_start_month)[:2] == (period_from, period_to)
    ]
    if not amounts:
        return []
    allocated_rows = (
        await db.execute(
            select(RemittanceAllocation.source_id, RemittanceAllocation.amount_allocated).where(
                RemittanceAllocation.source_type == source_type, RemittanceAllocation.source_id.in_([a.source_id for a in amounts]),
            )
        )
    ).all()
    allocated_by_source: dict[str, Decimal] = {}
    for source_id, amt in allocated_rows:
        allocated_by_source[source_id] = allocated_by_source.get(source_id, Decimal("0")) + amt

    out = []
    for a in amounts:
        already = allocated_by_source.get(a.source_id, Decimal("0"))
        outstanding = a.amount - already
        if outstanding > 0:
            out.append({
                "source_type": a.source_type, "source_id": a.source_id, "document_label": a.document_label,
                "counterparty": a.counterparty, "withheld_amount": a.amount, "already_allocated": already, "outstanding": outstanding,
            })
    return out
