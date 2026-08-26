"""The tax engine (BUILD-PROMPT §8.1) — deliberately isolated, no HTTP or ORM
coupling. Driven entirely by a TaxHeadSnapshot the caller builds from whatever
tax_heads row(s) apply; the engine itself never touches the database and
never names a tax. That separation is what makes "reproduce a historical
calculation exactly from the snapshot stored on the line" (Invariant 10)
possible: a document line stores the snapshot it was calculated from, and
calling calculate_tax() again on that same frozen snapshot years later must
reproduce the identical figure, unaffected by whatever the live tax_heads row
looks like today.

Two assumptions this engine makes that the spec (Masters §3.2b) leaves open,
flagged here rather than silently decided:
  - `rate_or_amount` on a slab band is read as a PERCENTAGE applied to the
    portion of the base inside that band. The Fields Table says "which of the
    two is asked for follows the head's Method" without naming a stored field
    that disambiguates it, and every real-world example in the spec (income
    tax slabs) is percentage-based — a fixed-rupee-per-band slab is not
    modelled by this engine and would need that field added first.
  - When more than one relief rule matches the same base amount, each is
    applied in sequence against the running total (not just the single
    "best" one) — the spec describes one relief's arithmetic precisely
    (§3.2e) but not multi-relief interaction. Each application still obeys
    the stated rule: the relief taken is never more than the tax remaining,
    so the result can never go negative or become a refund.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _allocate_to_total(parts: list[Decimal], target: Decimal) -> list[Decimal]:
    """Round `parts` to paise so they sum EXACTLY to `target`.

    Rounding each part on its own does not do this, and the drift is not
    cosmetic. A 50/50 split of 100.05 gives 50.025 twice, each rounding to
    50.03, totalling 100.06 — the printed CGST and SGST lines then charge a
    paise the Grand Total never did. Progressive slab bands drift the same
    way, because the total is rounded once from the unrounded sum while each
    band is rounded on its own. Appendix B is explicit that component shares
    "must total EXACTLY 100% of the head's calculated amount", and an invoice
    whose tax lines do not add up to its own tax figure is not defensible to
    the customer who receives it or to whoever audits it later.

    Largest-remainder method: round every part down, then hand the leftover
    paise out one at a time to whichever parts were cut by the most. That is
    the standard apportionment rule — it keeps every part within one paise of
    its exact share, and the result is deterministic, which matters because
    the same invoice must render identically every time it is opened.
    """
    if not parts:
        return []

    floors = [p.quantize(TWO_PLACES, rounding=ROUND_DOWN) for p in parts]
    residual = target - sum(floors)
    # Convert the residual to whole paise WITHOUT dividing: scaleb(2) shifts
    # the exponent, so this stays exact and keeps the engine's
    # "every divisor is a literal constant" guard honest (there is a test that
    # AST-parses this module for exactly that).
    steps = int(residual.scaleb(2).to_integral_value(rounding=ROUND_HALF_UP))
    if steps == 0:
        return floors

    # Rank by the fraction each part lost to flooring, largest first. The
    # index tiebreak keeps equal remainders (a 50/50 split is exactly this
    # case) resolving the same way on every run.
    order = sorted(range(len(parts)), key=lambda i: (parts[i] - floors[i], -i), reverse=True)
    step = TWO_PLACES if steps > 0 else -TWO_PLACES
    # Walk the ranked order handing out one paise at a time. No modulo: the
    # engine keeps every divisor a literal constant (there is an AST test that
    # enforces it, and % counts), and flooring can never lose a whole paise per
    # part, so a single pass is normally enough — the loop only wraps if a
    # caller ever passes a target further from the parts than that.
    remaining = abs(steps)
    while remaining:
        for i in order:
            if not remaining:
                break
            floors[i] += step
            remaining -= 1
    return floors


@dataclass(frozen=True)
class SlabBand:
    sequence_no: int
    band_from: Decimal
    band_to: Decimal | None  # None = "and above"
    rate_or_amount: Decimal  # read as a percentage — see module docstring


@dataclass(frozen=True)
class SplitComponent:
    component_name: str
    share_pct: Decimal


@dataclass(frozen=True)
class ReliefRule:
    relief_name: str
    applies_if_base_at_or_below: Decimal
    relief_type: str  # REDUCE_BY_FIXED | REDUCE_TO_ZERO | CAP_AT_AMOUNT
    relief_amount: Decimal | None  # required unless REDUCE_TO_ZERO


@dataclass(frozen=True)
class TaxHeadSnapshot:
    """Everything calculate_tax() needs, immutable. Build one of these from a
    live tax_heads row (+ children) when calculating, or straight from a
    stored JSON snapshot when reproducing history — the engine cannot tell
    the difference, which is the point.
    """

    tax_name: str
    tax_type: str  # GST_IGST | GST_CGST_SGST | PERCENTAGE | FIXED_AMOUNT | SLAB | DECLARATION_CAP
    applies_from: date
    applies_until: date | None = None
    rate_pct: Decimal | None = None
    cgst_rate_pct: Decimal | None = None
    sgst_rate_pct: Decimal | None = None
    fixed_amount: Decimal | None = None
    declaration_cap: Decimal | None = None
    slab_application: str | None = None  # PROGRESSIVE | FLAT_BY_BAND
    slab_bands: tuple[SlabBand, ...] = field(default_factory=tuple)
    split_components: tuple[SplitComponent, ...] = field(default_factory=tuple)
    relief_rules: tuple[ReliefRule, ...] = field(default_factory=tuple)
    print_label: str | None = None


@dataclass(frozen=True)
class ComponentAmount:
    component_name: str
    amount: Decimal


@dataclass(frozen=True)
class AppliedRelief:
    relief_name: str
    relief_applied: Decimal


@dataclass(frozen=True)
class SlabBandAmount:
    sequence_no: int
    base_in_band: Decimal
    amount: Decimal


@dataclass(frozen=True)
class CalculationResult:
    base_amount: Decimal
    gross_amount: Decimal  # before relief, before split
    computed_amount: Decimal  # after relief — the actual payable/deductible figure
    label: str
    components: tuple[ComponentAmount, ...] = field(default_factory=tuple)
    slab_breakdown: tuple[SlabBandAmount, ...] = field(default_factory=tuple)
    reliefs_applied: tuple[AppliedRelief, ...] = field(default_factory=tuple)


def calculate_tax(snapshot: TaxHeadSnapshot, base_amount: Decimal) -> CalculationResult:
    base_amount = Decimal(base_amount)
    label = snapshot.print_label or snapshot.tax_name

    gross, slab_breakdown = _compute_gross(snapshot, base_amount)
    computed, reliefs_applied = _apply_reliefs(snapshot, base_amount, gross)
    components = _split(snapshot, computed)

    return CalculationResult(
        base_amount=base_amount,
        gross_amount=_money(gross),
        computed_amount=_money(computed),
        label=label,
        components=components,
        slab_breakdown=slab_breakdown,
        reliefs_applied=reliefs_applied,
    )


def _compute_gross(snapshot: TaxHeadSnapshot, base_amount: Decimal) -> tuple[Decimal, tuple[SlabBandAmount, ...]]:
    # QUEUED / NOT FIXED — §6 audit finding: "GST_IGST" and "GST_CGST_SGST"
    # are one country's tax names baked into what Masters §3.2 calls a
    # behaviour-only registry ("Masters -> Taxes ... knows no tax by name").
    # The branch below proves GST_IGST isn't even a distinct calculation —
    # it is handled identically to the already tax-neutral PERCENTAGE type —
    # and GST_CGST_SGST is really just "split one rate into two equal named
    # components" wearing an India-specific label. A Super Admin configuring
    # a different country's single-rate or two-component-split tax has to
    # mislabel it GST_* or use PERCENTAGE inconsistently with existing heads.
    # Not fixed here because the name is load-bearing in more places than
    # this file: the DB CHECK constraints `ck_tax_heads_type`,
    # `ck_tax_heads_rate_gst_igst` and `ck_tax_heads_gst_split`
    # (alembic/versions/0002_masters.py:123,125,127) and the separate
    # `ck_hsn_sac_gst_type` constraint (same file, line 610) spell these
    # values out verbatim, as does the frontend's static TAX_TYPE_OPTIONS
    # (frontend/src/app/features/masters/screens/taxes.form.config.ts:36-37).
    # A real fix needs: a migration renaming/collapsing the enum + backfilling
    # any existing tax_heads rows, updated CHECK constraints in both places,
    # updated TAX_TYPE_OPTIONS, and this branch rewritten to match — not a
    # same-shape edit that can be made safely in this file alone.
    if snapshot.tax_type in ("GST_IGST", "PERCENTAGE"):
        assert snapshot.rate_pct is not None, f"{snapshot.tax_type} requires rate_pct"
        return base_amount * snapshot.rate_pct / Decimal(100), ()

    if snapshot.tax_type == "GST_CGST_SGST":
        assert snapshot.cgst_rate_pct is not None and snapshot.sgst_rate_pct is not None
        total_rate = snapshot.cgst_rate_pct + snapshot.sgst_rate_pct
        return base_amount * total_rate / Decimal(100), ()

    if snapshot.tax_type == "FIXED_AMOUNT":
        assert snapshot.fixed_amount is not None
        return snapshot.fixed_amount, ()

    if snapshot.tax_type == "DECLARATION_CAP":
        assert snapshot.declaration_cap is not None
        return min(base_amount, snapshot.declaration_cap), ()

    if snapshot.tax_type == "SLAB":
        return _compute_slab(snapshot, base_amount)

    raise ValueError(f"Unknown tax_type: {snapshot.tax_type}")


def _compute_slab(snapshot: TaxHeadSnapshot, base_amount: Decimal) -> tuple[Decimal, tuple[SlabBandAmount, ...]]:
    bands = sorted(snapshot.slab_bands, key=lambda b: b.sequence_no)
    if not bands:
        raise ValueError("SLAB tax type requires at least one band")

    if snapshot.slab_application == "FLAT_BY_BAND":
        for band in bands:
            upper = band.band_to if band.band_to is not None else base_amount
            if band.band_from <= base_amount <= upper:
                amount = base_amount * band.rate_or_amount / Decimal(100)
                return amount, (SlabBandAmount(band.sequence_no, base_amount, _money(amount)),)
        # Base amount falls below the first band's start — no band applies.
        return Decimal(0), ()

    # PROGRESSIVE (default): each band taxes only the portion of the base that
    # falls inside it; the total is the sum across every band the base reaches.
    total = Decimal(0)
    breakdown: list[SlabBandAmount] = []
    exact_amounts: list[Decimal] = []
    for band in bands:
        if base_amount <= band.band_from:
            continue
        upper = band.band_to if band.band_to is not None else base_amount
        base_in_band = min(base_amount, upper) - band.band_from
        if base_in_band <= 0:
            continue
        amount = base_in_band * band.rate_or_amount / Decimal(100)
        total += amount
        exact_amounts.append(amount)
        breakdown.append(SlabBandAmount(band.sequence_no, base_in_band, amount))
    # Reconcile the per-band lines to the rounded total the caller charges,
    # so the displayed breakdown adds up to the tax printed beside it.
    allocated = _allocate_to_total(exact_amounts, _money(total))
    breakdown = [
        SlabBandAmount(b.sequence_no, b.base_in_band, amount)
        for b, amount in zip(breakdown, allocated)
    ]
    return total, tuple(breakdown)


def _apply_reliefs(
    snapshot: TaxHeadSnapshot, base_amount: Decimal, gross: Decimal
) -> tuple[Decimal, tuple[AppliedRelief, ...]]:
    running = gross
    applied: list[AppliedRelief] = []
    for relief in snapshot.relief_rules:
        if base_amount > relief.applies_if_base_at_or_below:
            continue
        if relief.relief_type == "REDUCE_TO_ZERO":
            if running > 0:
                applied.append(AppliedRelief(relief.relief_name, _money(running)))
            running = Decimal(0)
        elif relief.relief_type == "REDUCE_BY_FIXED":
            assert relief.relief_amount is not None
            # "Relief applied is always the LESSER of relief_amount and the
            # tax actually computed, so it can never turn into a refund" —
            # Masters §3.2e, verbatim.
            taken = min(relief.relief_amount, running)
            if taken > 0:
                applied.append(AppliedRelief(relief.relief_name, _money(taken)))
            running -= taken
        elif relief.relief_type == "CAP_AT_AMOUNT":
            assert relief.relief_amount is not None
            if running > relief.relief_amount:
                applied.append(AppliedRelief(relief.relief_name, _money(running - relief.relief_amount)))
                running = relief.relief_amount
        else:
            raise ValueError(f"Unknown relief_type: {relief.relief_type}")
    return running, tuple(applied)


def _split(snapshot: TaxHeadSnapshot, computed_amount: Decimal) -> tuple[ComponentAmount, ...]:
    if not snapshot.split_components:
        return ()
    total_share = sum((c.share_pct for c in snapshot.split_components), Decimal(0))
    if total_share != Decimal(100):
        raise ValueError(f"Split component shares must sum to 100, got {total_share}")
    exact = [computed_amount * c.share_pct / Decimal(100) for c in snapshot.split_components]
    allocated = _allocate_to_total(exact, _money(computed_amount))
    return tuple(
        ComponentAmount(c.component_name, amount)
        for c, amount in zip(snapshot.split_components, allocated)
    )


def select_effective_head(snapshots: list[TaxHeadSnapshot], as_of: date) -> TaxHeadSnapshot | None:
    """Effective dating (Masters §3.2's Applies From/Applies Until): pick the
    snapshot in force on `as_of`. Both bounds are inclusive. If more than one
    somehow matches (data error — heads should never overlap in practice),
    the most recently started one wins.
    """
    candidates = [
        s for s in snapshots if s.applies_from <= as_of and (s.applies_until is None or as_of <= s.applies_until)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda s: s.applies_from)
