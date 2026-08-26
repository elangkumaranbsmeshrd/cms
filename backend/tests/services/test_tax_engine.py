"""Phase 1's acceptance gate (BUILD-PROMPT §13): "Tax engine unit tests green
incl. slabs, splits, effective dating and historical reproduction." Every
tax_type, every relief type, and the documented boundary cases — not just the
happy path (Definition of Done §14.7).
"""

from datetime import date
from decimal import Decimal

import pytest

from app.services.tax_engine import (
    ReliefRule,
    SlabBand,
    SplitComponent,
    TaxHeadSnapshot,
    calculate_tax,
    select_effective_head,
)


def d(x: str) -> Decimal:
    return Decimal(x)


# --------------------------------------------------------------------- GST
def test_gst_igst_single_rate():
    snap = TaxHeadSnapshot(tax_name="GST 18% IGST", tax_type="GST_IGST", applies_from=date(2026, 4, 1), rate_pct=d("18"))
    result = calculate_tax(snap, d("100000"))
    assert result.computed_amount == d("18000.00")


def test_gst_cgst_sgst_halves_are_not_separately_stored_as_two_heads():
    snap = TaxHeadSnapshot(
        tax_name="GST 18% Intrastate",
        tax_type="GST_CGST_SGST",
        applies_from=date(2026, 4, 1),
        cgst_rate_pct=d("9"),
        sgst_rate_pct=d("9"),
    )
    result = calculate_tax(snap, d("100000"))
    assert result.computed_amount == d("18000.00")  # 9% + 9%


# --------------------------------------------------------- PERCENTAGE / FIXED
def test_percentage():
    snap = TaxHeadSnapshot(tax_name="Cess", tax_type="PERCENTAGE", applies_from=date(2026, 4, 1), rate_pct=d("5"))
    assert calculate_tax(snap, d("2000")).computed_amount == d("100.00")


def test_fixed_amount_ignores_base():
    snap = TaxHeadSnapshot(tax_name="Flat Levy", tax_type="FIXED_AMOUNT", applies_from=date(2026, 4, 1), fixed_amount=d("500"))
    assert calculate_tax(snap, d("1")).computed_amount == d("500.00")
    assert calculate_tax(snap, d("999999")).computed_amount == d("500.00")


# ------------------------------------------------------------- DECLARATION CAP
def test_declaration_cap_below_and_above_and_exactly_at_cap():
    snap = TaxHeadSnapshot(tax_name="80C-style Declaration", tax_type="DECLARATION_CAP", applies_from=date(2026, 4, 1), declaration_cap=d("150000"))
    assert calculate_tax(snap, d("100000")).computed_amount == d("100000.00")  # below cap: as declared
    assert calculate_tax(snap, d("150000")).computed_amount == d("150000.00")  # exactly at cap
    assert calculate_tax(snap, d("200000")).computed_amount == d("150000.00")  # above cap: clamped


# -------------------------------------------------------------- SLAB PROGRESSIVE
PROGRESSIVE_BANDS = (
    SlabBand(1, d("0"), d("300000"), d("0")),
    SlabBand(2, d("300000"), d("600000"), d("5")),
    SlabBand(3, d("600000"), d("900000"), d("10")),
    SlabBand(4, d("900000"), None, d("15")),
)


def _progressive_snapshot():
    return TaxHeadSnapshot(
        tax_name="Income Tax Slab",
        tax_type="SLAB",
        applies_from=date(2026, 4, 1),
        slab_application="PROGRESSIVE",
        slab_bands=PROGRESSIVE_BANDS,
    )


def test_slab_progressive_spans_every_band():
    result = calculate_tax(_progressive_snapshot(), d("1000000"))
    # 0% on 300000 + 5% on 300000 + 10% on 300000 + 15% on 100000
    assert result.computed_amount == d("60000.00")
    # Every band the base reaches appears, including band 1 at 0.00 — an
    # auditable full breakdown, not just the nonzero rows.
    assert [b.sequence_no for b in result.slab_breakdown] == [1, 2, 3, 4]
    assert result.slab_breakdown[0].amount == d("0.00")


def test_slab_progressive_boundary_exactly_at_a_band_edge():
    # Band 1 is [0, 300000] inclusive at 0% — landing exactly on the edge must
    # NOT spill one rupee into band 2.
    result = calculate_tax(_progressive_snapshot(), d("300000"))
    assert result.computed_amount == d("0.00")
    assert len(result.slab_breakdown) == 1  # only band 1 is reached, at 0%
    assert result.slab_breakdown[0].amount == d("0.00")


def test_slab_progressive_boundary_one_rupee_over_the_edge():
    result = calculate_tax(_progressive_snapshot(), d("300001"))
    assert result.computed_amount == d("0.05")  # 1 rupee taxed at 5%


def test_slab_progressive_top_open_band():
    result = calculate_tax(_progressive_snapshot(), d("900000"))
    # exactly at the start of the open-ended top band contributes nothing to it
    assert result.computed_amount == d("45000.00")  # 0 + 15000 + 30000 + 0


# -------------------------------------------------------------- SLAB FLAT_BY_BAND
FLAT_BANDS = (
    SlabBand(1, d("0"), d("300000"), d("0")),
    SlabBand(2, d("300000"), d("600000"), d("10")),
    SlabBand(3, d("600000"), None, d("20")),
)


def _flat_snapshot():
    return TaxHeadSnapshot(
        tax_name="Flat Slab Fee",
        tax_type="SLAB",
        applies_from=date(2026, 4, 1),
        slab_application="FLAT_BY_BAND",
        slab_bands=FLAT_BANDS,
    )


def test_slab_flat_by_band_taxes_the_whole_base_at_one_rate():
    result = calculate_tax(_flat_snapshot(), d("450000"))
    assert result.computed_amount == d("45000.00")  # whole 450000 at 10%, not just the slice inside the band


def test_slab_flat_by_band_shared_boundary_is_won_by_the_lower_band():
    # Bands are declared contiguous (one band's To equals the next band's
    # From, both "inclusive" per Masters §3.2b) — a genuine boundary overlap
    # of one point. This engine resolves it deterministically: bands are
    # scanned in sequence_no order and the FIRST match wins, so the lower
    # band claims the shared edge.
    result = calculate_tax(_flat_snapshot(), d("300000"))
    assert result.computed_amount == d("0.00")  # band 1 (0%), not band 2 (10%)


def test_slab_flat_by_band_below_first_band_yields_zero():
    bands = (SlabBand(1, d("1000"), None, d("10")),)
    snap = TaxHeadSnapshot(tax_name="x", tax_type="SLAB", applies_from=date(2026, 4, 1), slab_application="FLAT_BY_BAND", slab_bands=bands)
    assert calculate_tax(snap, d("500")).computed_amount == d("0.00")


# ------------------------------------------------------------- SPLIT COMPONENTS
def test_split_components_even():
    snap = TaxHeadSnapshot(
        tax_name="GST 18% Intrastate",
        tax_type="GST_CGST_SGST",
        applies_from=date(2026, 4, 1),
        cgst_rate_pct=d("9"),
        sgst_rate_pct=d("9"),
        split_components=(SplitComponent("CGST", d("50")), SplitComponent("SGST", d("50"))),
    )
    result = calculate_tax(snap, d("100000"))
    by_name = {c.component_name: c.amount for c in result.components}
    assert by_name == {"CGST": d("9000.00"), "SGST": d("9000.00")}


def test_split_components_uneven():
    snap = TaxHeadSnapshot(
        tax_name="Levy",
        tax_type="PERCENTAGE",
        applies_from=date(2026, 4, 1),
        rate_pct=d("10"),
        split_components=(SplitComponent("Authority A", d("60")), SplitComponent("Authority B", d("40"))),
    )
    result = calculate_tax(snap, d("1000"))  # gross = 100.00
    by_name = {c.component_name: c.amount for c in result.components}
    assert by_name == {"Authority A": d("60.00"), "Authority B": d("40.00")}


def test_split_components_must_sum_to_100():
    snap = TaxHeadSnapshot(
        tax_name="Bad Split",
        tax_type="PERCENTAGE",
        applies_from=date(2026, 4, 1),
        rate_pct=d("10"),
        split_components=(SplitComponent("A", d("60")), SplitComponent("B", d("30"))),
    )
    with pytest.raises(ValueError, match="must sum to 100"):
        calculate_tax(snap, d("1000"))


def test_no_split_components_is_the_common_case():
    snap = TaxHeadSnapshot(tax_name="Simple GST", tax_type="GST_IGST", applies_from=date(2026, 4, 1), rate_pct=d("18"))
    assert calculate_tax(snap, d("1000")).components == ()


# ------------------------------------------------------------------- RELIEF
def _slab_snapshot_with_relief(relief: ReliefRule) -> TaxHeadSnapshot:
    return TaxHeadSnapshot(
        tax_name="Income Tax",
        tax_type="SLAB",
        applies_from=date(2026, 4, 1),
        slab_application="PROGRESSIVE",
        slab_bands=(SlabBand(1, d("0"), None, d("100")),),  # trivial: tax = base, for round numbers
        relief_rules=(relief,),
    )


def test_relief_reduce_to_zero_when_base_qualifies():
    relief = ReliefRule("Section 87A", d("500000"), "REDUCE_TO_ZERO", None)
    result = calculate_tax(_slab_snapshot_with_relief(relief), d("400000"))
    assert result.gross_amount == d("400000.00")
    assert result.computed_amount == d("0.00")
    assert result.reliefs_applied[0].relief_name == "Section 87A"
    assert result.reliefs_applied[0].relief_applied == d("400000.00")


def test_relief_does_not_apply_above_threshold():
    relief = ReliefRule("Section 87A", d("500000"), "REDUCE_TO_ZERO", None)
    result = calculate_tax(_slab_snapshot_with_relief(relief), d("600000"))
    assert result.computed_amount == d("600000.00")
    assert result.reliefs_applied == ()


def test_relief_reduce_by_fixed_never_goes_negative():
    # gross (12500) < relief_amount (20000): must floor at 0, taking only what
    # exists — "never a refund" per Masters §3.2e, tested at the boundary.
    relief = ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("20000"))
    result = calculate_tax(_slab_snapshot_with_relief(relief), d("12500"))
    assert result.computed_amount == d("0.00")
    assert result.reliefs_applied[0].relief_applied == d("12500.00")  # only the lesser was taken


def test_relief_reduce_by_fixed_exact_boundary():
    relief = ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("12500"))
    result = calculate_tax(_slab_snapshot_with_relief(relief), d("12500"))
    assert result.computed_amount == d("0.00")


def test_relief_cap_at_amount():
    relief = ReliefRule("Cap", d("999999999"), "CAP_AT_AMOUNT", d("30000"))
    result = calculate_tax(_slab_snapshot_with_relief(relief), d("50000"))
    assert result.computed_amount == d("30000.00")
    assert result.reliefs_applied[0].relief_applied == d("20000.00")


def test_relief_cap_at_amount_no_effect_when_already_under_cap():
    relief = ReliefRule("Cap", d("999999999"), "CAP_AT_AMOUNT", d("30000"))
    result = calculate_tax(_slab_snapshot_with_relief(relief), d("10000"))
    assert result.computed_amount == d("10000.00")
    assert result.reliefs_applied == ()


# -------------------------------------------------------------- EFFECTIVE DATING
def _two_generation_heads():
    old = TaxHeadSnapshot(tax_name="GST", tax_type="GST_IGST", applies_from=date(2025, 4, 1), applies_until=date(2026, 3, 31), rate_pct=d("12"))
    new = TaxHeadSnapshot(tax_name="GST", tax_type="GST_IGST", applies_from=date(2026, 4, 1), applies_until=None, rate_pct=d("18"))
    return old, new


def test_effective_dating_picks_old_head_at_start_boundary():
    old, new = _two_generation_heads()
    picked = select_effective_head([old, new], date(2025, 4, 1))
    assert picked is old


def test_effective_dating_picks_old_head_at_end_boundary_inclusive():
    old, new = _two_generation_heads()
    picked = select_effective_head([old, new], date(2026, 3, 31))
    assert picked is old


def test_effective_dating_picks_new_head_the_very_next_day():
    old, new = _two_generation_heads()
    picked = select_effective_head([old, new], date(2026, 4, 1))
    assert picked is new


def test_effective_dating_open_ended_head_matches_far_future():
    old, new = _two_generation_heads()
    picked = select_effective_head([old, new], date(2030, 1, 1))
    assert picked is new


def test_effective_dating_before_any_head_existed():
    old, new = _two_generation_heads()
    assert select_effective_head([old, new], date(2020, 1, 1)) is None


# --------------------------------------------------------- HISTORICAL REPRODUCTION
def test_historical_reproduction_is_unaffected_by_a_later_different_snapshot():
    """Invariant 10: a document line's stored snapshot must reproduce its
    original figure forever, no matter what the tax head looks like today.
    The engine has no ambient state — calling it again on the SAME frozen
    snapshot must always return the identical Decimal, and a DIFFERENT
    snapshot (simulating what "today's" row might contain, hypothetically,
    since is_arithmetic_locked would in reality forbid this) must not leak
    into that recomputation.
    """
    original = TaxHeadSnapshot(tax_name="GST 18% IGST", tax_type="GST_IGST", applies_from=date(2026, 4, 1), rate_pct=d("18"))
    first_calculation = calculate_tax(original, d("50000"))
    assert first_calculation.computed_amount == d("9000.00")

    # A hypothetical "current" row with a different rate — must not affect
    # a recomputation from the ORIGINAL stored snapshot.
    changed_today = TaxHeadSnapshot(tax_name="GST 18% IGST", tax_type="GST_IGST", applies_from=date(2026, 4, 1), rate_pct=d("12"))
    assert calculate_tax(changed_today, d("50000")).computed_amount == d("6000.00")

    reproduced = calculate_tax(original, d("50000"))
    assert reproduced.computed_amount == first_calculation.computed_amount == d("9000.00")
