"""Phase 1's acceptance gate (BUILD-PROMPT §13): "Tax engine unit tests green
incl. slabs, splits, effective dating and historical reproduction." Every
tax_type, every relief type, and the documented boundary cases — not just the
happy path (Definition of Done §14.7).
"""

import ast
import inspect
from datetime import date
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

import pytest

from app.services import tax_engine as tax_engine_module
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


# =====================================================================
# LAYER 1 CALCULATION-TEST ADDITIONS
#
# COMPLETE-TEST-PROMPT §Layer 1, the governing rule for everything below:
# "Never assert against what the code returns — assert against a number you
# worked out yourself from the spec." Every expected figure in this section
# was computed by hand from APPENDIX-B-business-rules.md BEFORE the engine
# was run, and the arithmetic is shown in a comment above the assertion.
#
# Three assertions below are marked xfail(strict=True). Those are NOT
# tolerated failures — they are the hand-computed spec figure, kept as the
# assertion, over a code path that currently produces a different number.
# strict=True means each one turns into a hard FAILURE the day the engine is
# fixed, forcing the marker off rather than letting the bug quietly re-hide.
# =====================================================================

FROM_DATE = date(2026, 4, 1)


def _cents(value: Decimal) -> int:
    """Explicit 2-decimal comparison helper. `Decimal("5.0") == Decimal("5")`
    is True numerically, so equality alone never proves a figure was
    quantized. Money is compared as an integer number of paise, and the
    scale is asserted separately by test_every_money_field_is_scaled_to_two_decimals.
    """
    return int(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100)


# Bands for the additions below. Deliberately NOT the fixtures above: those
# open with a 0% band, which makes "one band" and "no tax at all" produce the
# same figure and so cannot prove a one-band case was actually calculated.
# Every band here carries a non-zero rate. Declared contiguous (each band's
# To equals the next band's From) — the shape the existing suite already
# uses, and the shape Appendix B's "total = SUM across bands" needs for the
# portions to tile the base exactly once.
L1_BANDS = (
    SlabBand(1, d("0"), d("100000"), d("2")),
    SlabBand(2, d("100000"), d("250000"), d("8")),
    SlabBand(3, d("250000"), None, d("30")),
)

# The same rate schedule expressed the way Appendix B's SLAB BAND VALIDATION
# rule literally describes it — "Band From and Band To are both INCLUSIVE",
# bands "may not overlap": the next band starts one paise after the previous
# one ends, so no base value is claimed by two bands and none falls in a gap.
# Used for the Flat-by-Band boundary tests, where "which band owns exactly
# this number" has to have one unambiguous spec answer.
L1_BANDS_NON_OVERLAPPING = (
    SlabBand(1, d("0"), d("100000"), d("2")),
    SlabBand(2, d("100000.01"), d("250000"), d("8")),
    SlabBand(3, d("250000.01"), None, d("30")),
)


def _slab(application: str, bands=L1_BANDS) -> TaxHeadSnapshot:
    return TaxHeadSnapshot(
        tax_name="Layer 1 Slab",
        tax_type="SLAB",
        applies_from=FROM_DATE,
        slab_application=application,
        slab_bands=bands,
    )


def _pct(rate: str, **kw) -> TaxHeadSnapshot:
    return TaxHeadSnapshot(tax_name="Layer 1 Percentage", tax_type="PERCENTAGE", applies_from=FROM_DATE, rate_pct=d(rate), **kw)


# ------------------------------------------------- PERCENTAGE / FIXED AMOUNT
def test_percentage_with_a_fractional_rate_rounds_to_paise():
    # Appendix B: "Rate (%) required iff Tax Type is GST-IGST or Percentage".
    # Rates are stored Numeric(7,4), so a fractional rate must survive.
    # 1234.56 x 2.5 = 3086.40 ; 3086.40 / 100 = 30.864
    # 30.864 -> 2dp, third decimal is 4, rounds DOWN -> 30.86
    assert _cents(calculate_tax(_pct("2.5"), d("1234.56")).computed_amount) == 3086


def test_percentage_of_a_zero_base_is_zero_not_an_error():
    # 0 x 18 / 100 = 0
    assert _cents(calculate_tax(_pct("18"), d("0")).computed_amount) == 0


def test_fixed_amount_of_zero_is_a_real_configuration_not_a_crash():
    # Appendix B: "Fixed Amount required iff Tax Type is Fixed Amount" — it
    # says required, not non-zero. A zero fixed levy is a legal head.
    snap = TaxHeadSnapshot(tax_name="Zero Levy", tax_type="FIXED_AMOUNT", applies_from=FROM_DATE, fixed_amount=d("0"))
    assert _cents(calculate_tax(snap, d("99999")).computed_amount) == 0


def test_fixed_amount_still_divides_into_its_split_components():
    # Appendix B: "component shares must total EXACTLY 100% of the head's
    # calculated amount" — the calculated amount of a FIXED_AMOUNT head is
    # the fixed figure itself, so the split applies to it just the same.
    # 2500 x 60% = 1500.00 ; 2500 x 40% = 1000.00 ; 1500 + 1000 = 2500.00
    snap = TaxHeadSnapshot(
        tax_name="Fixed Split", tax_type="FIXED_AMOUNT", applies_from=FROM_DATE, fixed_amount=d("2500"),
        split_components=(SplitComponent("Authority A", d("60")), SplitComponent("Authority B", d("40"))),
    )
    result = calculate_tax(snap, d("0"))  # base is irrelevant to a fixed head
    assert [(c.component_name, _cents(c.amount)) for c in result.components] == [("Authority A", 150000), ("Authority B", 100000)]
    assert sum(_cents(c.amount) for c in result.components) == _cents(result.computed_amount) == 250000


# ----------------------------------------------------------- GST IGST vs CGST+SGST
def test_cgst_plus_sgst_equals_the_igst_total_for_the_same_base():
    """Appendix B, SGST MUST EQUAL CGST, verbatim: "SGST Rate must equal CGST
    Rate; each is half the total". The interstate head and the intrastate
    head are two presentations of ONE total, so for any base the customer
    must be charged the identical money either way — a split that quietly
    charged more or less than the combined head would be a real pricing bug.
    """
    igst = TaxHeadSnapshot(tax_name="GST 18 Interstate", tax_type="GST_IGST", applies_from=FROM_DATE, rate_pct=d("18"))
    intrastate = TaxHeadSnapshot(
        tax_name="GST 18 Intrastate", tax_type="GST_CGST_SGST", applies_from=FROM_DATE,
        cgst_rate_pct=d("9"), sgst_rate_pct=d("9"),
    )
    # 250000 x 18 / 100 = 45000.00   and   250000 x (9 + 9) / 100 = 45000.00
    assert _cents(calculate_tax(igst, d("250000")).computed_amount) == 4500000
    assert _cents(calculate_tax(intrastate, d("250000")).computed_amount) == 4500000

    # And at a base whose tax does not land on a whole rupee, where an
    # independently-rounded half would be the obvious way to get this wrong:
    # 1234.56 x 18 = 22222.08 ; / 100 = 222.2208 -> 2dp -> 222.22
    assert _cents(calculate_tax(igst, d("1234.56")).computed_amount) == 22222
    assert _cents(calculate_tax(intrastate, d("1234.56")).computed_amount) == 22222


def test_cgst_sgst_split_lines_are_each_half_of_the_combined_total():
    # Appendix B: "the head prints as TWO lines, half each."
    # 250000 x 18 / 100 = 45000.00 ; each line 45000 x 50% = 22500.00
    # 22500 + 22500 = 45000.00 = the head's calculated amount.
    snap = TaxHeadSnapshot(
        tax_name="GST 18 Intrastate", tax_type="GST_CGST_SGST", applies_from=FROM_DATE,
        cgst_rate_pct=d("9"), sgst_rate_pct=d("9"),
        split_components=(SplitComponent("CGST", d("50")), SplitComponent("SGST", d("50"))),
    )
    result = calculate_tax(snap, d("250000"))
    assert [(c.component_name, _cents(c.amount)) for c in result.components] == [("CGST", 2250000), ("SGST", 2250000)]
    assert sum(_cents(c.amount) for c in result.components) == _cents(result.computed_amount) == 4500000


def test_a_cgst_sgst_head_with_no_split_rows_is_one_undivided_line():
    # Appendix B pulls in two directions here and the engine follows the
    # narrower rule: "A head with zero component rows is a single undivided
    # tax - the common case", and Invoice's "splitting is expressed entirely
    # by the head's Split Components in Masters". So the two-line CGST/SGST
    # print is a CONFIGURATION outcome, not automatic from the tax type.
    # 100000 x (9 + 9) / 100 = 18000.00, as ONE figure.
    snap = TaxHeadSnapshot(
        tax_name="GST 18 Intrastate", tax_type="GST_CGST_SGST", applies_from=FROM_DATE,
        cgst_rate_pct=d("9"), sgst_rate_pct=d("9"),
    )
    result = calculate_tax(snap, d("100000"))
    assert result.components == ()
    assert _cents(result.computed_amount) == 1800000


# ------------------------------------------------------------ SLAB PROGRESSIVE
def test_progressive_base_inside_one_band_only():
    # Appendix B: "Progressive = each band's rate applies only to the portion
    # of the base inside that band, total = SUM across bands."
    # 60000 lies wholly inside band 1 [0 - 100000] @ 2%:
    #   60000 x 2 / 100 = 1200.00
    result = calculate_tax(_slab("PROGRESSIVE"), d("60000"))
    assert _cents(result.computed_amount) == 120000
    assert [b.sequence_no for b in result.slab_breakdown] == [1]


def test_progressive_base_spanning_two_bands():
    # 160000 reaches into band 2 [100000 - 250000] @ 8%:
    #   band 1: 100000 x 2 / 100  =  2000.00
    #   band 2:  60000 x 8 / 100  =  4800.00
    #   total                     =  6800.00
    result = calculate_tax(_slab("PROGRESSIVE"), d("160000"))
    assert _cents(result.computed_amount) == 680000
    assert [(b.sequence_no, _cents(b.amount)) for b in result.slab_breakdown] == [(1, 200000), (2, 480000)]


def test_progressive_base_spanning_all_bands():
    # 400000 reaches the open-ended band 3 [250000 and above] @ 30%:
    #   band 1: 100000 x  2 / 100 =   2000.00
    #   band 2: 150000 x  8 / 100 =  12000.00
    #   band 3: 150000 x 30 / 100 =  45000.00
    #   total                     =  59000.00
    result = calculate_tax(_slab("PROGRESSIVE"), d("400000"))
    assert _cents(result.computed_amount) == 5900000
    assert [(b.sequence_no, _cents(b.amount)) for b in result.slab_breakdown] == [(1, 200000), (2, 1200000), (3, 4500000)]


def test_progressive_base_exactly_on_the_first_band_boundary():
    # Landing exactly on band 1's To must be taxed wholly at band 1's rate and
    # must NOT spill one paise into band 2 — "only the portion of the base
    # inside that band", and the boundary point belongs to exactly one band.
    #   100000 x 2 / 100 = 2000.00, band 2 contributes nothing.
    result = calculate_tax(_slab("PROGRESSIVE"), d("100000"))
    assert _cents(result.computed_amount) == 200000
    assert [b.sequence_no for b in result.slab_breakdown] == [1]


def test_progressive_base_exactly_on_the_second_band_boundary():
    #   band 1: 100000 x 2 / 100 =  2000.00
    #   band 2: 150000 x 8 / 100 = 12000.00
    #   total                    = 14000.00, band 3 contributes nothing.
    result = calculate_tax(_slab("PROGRESSIVE"), d("250000"))
    assert _cents(result.computed_amount) == 1400000
    assert [b.sequence_no for b in result.slab_breakdown] == [1, 2]


def test_progressive_one_rupee_above_the_open_ended_band():
    # The open-ended band has no ceiling, so the portion inside it is
    # everything above its From:
    #   bands 1 + 2 (as above) = 14000.00
    #   band 3:  1 x 30 / 100  =     0.30
    #   total                  = 14000.30
    result = calculate_tax(_slab("PROGRESSIVE"), d("250001"))
    assert _cents(result.computed_amount) == 1400030


def test_progressive_far_above_the_open_ended_band_still_taxes_only_the_excess():
    #   bands 1 + 2            =   14000.00
    #   band 3: 9750000 x 30 / 100 = 2925000.00   (10000000 - 250000 = 9750000)
    #   total                  = 2939000.00
    result = calculate_tax(_slab("PROGRESSIVE"), d("10000000"))
    assert _cents(result.computed_amount) == 293900000


def test_progressive_zero_base_produces_no_bands_and_no_tax():
    result = calculate_tax(_slab("PROGRESSIVE"), d("0"))
    assert _cents(result.computed_amount) == 0
    assert result.slab_breakdown == ()


# ----------------------------------------------------------- SLAB FLAT BY BAND
def test_flat_by_band_base_inside_one_band_only():
    # Appendix B: "Flat by Band = the single band the base lands in determines
    # ONE rate applied to the ENTIRE base."
    # 60000 lands in band 1 @ 2%: 60000 x 2 / 100 = 1200.00
    result = calculate_tax(_slab("FLAT_BY_BAND"), d("60000"))
    assert _cents(result.computed_amount) == 120000
    assert [b.sequence_no for b in result.slab_breakdown] == [1]


def test_flat_by_band_base_in_the_middle_band_taxes_the_whole_base():
    # 160000 lands in band 2 @ 8% -> the ENTIRE base at 8%, not just the
    # 60000 slice inside the band:
    #   160000 x 8 / 100 = 12800.00
    result = calculate_tax(_slab("FLAT_BY_BAND"), d("160000"))
    assert _cents(result.computed_amount) == 1280000
    assert [(b.sequence_no, _cents(b.base_in_band)) for b in result.slab_breakdown] == [(2, 16000000)]


def test_flat_by_band_base_in_the_open_ended_band_taxes_the_whole_base():
    # 400000 lands in band 3 [250000 and above] @ 30%:
    #   400000 x 30 / 100 = 120000.00
    result = calculate_tax(_slab("FLAT_BY_BAND"), d("400000"))
    assert _cents(result.computed_amount) == 12000000


def test_flat_by_band_just_above_the_open_ended_bands_start():
    # 250001 x 30 / 100 = 7500030 / 100 = 75000.30
    result = calculate_tax(_slab("FLAT_BY_BAND"), d("250001"))
    assert _cents(result.computed_amount) == 7500030


def test_flat_by_band_exactly_on_a_boundary_of_spec_valid_non_overlapping_bands():
    """Appendix B, SLAB BAND VALIDATION: bands "may not overlap" and "Band
    From and Band To are both INCLUSIVE". Configured that way the boundary
    has ONE right answer per the spec rather than a tie-break, so these are
    the boundary figures the spec itself determines.
    """
    flat = _slab("FLAT_BY_BAND", L1_BANDS_NON_OVERLAPPING)
    # 100000.00 is band 1's inclusive To  -> 100000 x 2 / 100 = 2000.00
    assert _cents(calculate_tax(flat, d("100000")).computed_amount) == 200000
    # 100000.01 is band 2's inclusive From ->
    #   100000.01 x 8 = 800000.08 ; / 100 = 8000.0008 -> 2dp -> 8000.00
    assert _cents(calculate_tax(flat, d("100000.01")).computed_amount) == 800000
    # 250000.00 is band 2's inclusive To  -> 250000 x 8 / 100 = 20000.00
    assert _cents(calculate_tax(flat, d("250000")).computed_amount) == 2000000
    # 250000.01 is band 3's inclusive From ->
    #   250000.01 x 30 = 7500000.3 ; / 100 = 75000.003 -> 2dp -> 75000.00
    assert _cents(calculate_tax(flat, d("250000.01")).computed_amount) == 7500000


def test_flat_by_band_zero_base_lands_in_the_first_band():
    # Band 1's From is 0 and both bounds are inclusive, so 0 is inside it:
    #   0 x 2 / 100 = 0.00
    result = calculate_tax(_slab("FLAT_BY_BAND"), d("0"))
    assert _cents(result.computed_amount) == 0
    assert [b.sequence_no for b in result.slab_breakdown] == [1]


# --------------------------------------- PROGRESSIVE vs FLAT ARE NOT THE SAME
def test_progressive_and_flat_by_band_produce_different_numbers_for_one_identical_input():
    """Appendix B, verbatim: "These produce very different numbers, so the
    choice is asked, never assumed." A suite where every slab assertion holds
    under both modes would pass with the mode silently ignored — this is the
    test that cannot.

    Identical head, identical base of 160000, only slab_application differs:
      PROGRESSIVE: 100000 x 2/100 + 60000 x 8/100 = 2000.00 + 4800.00 =  6800.00
      FLAT_BY_BAND:        160000 x 8/100         =                    12800.00
      difference                                                     =  6000.00
    """
    progressive = calculate_tax(_slab("PROGRESSIVE"), d("160000")).computed_amount
    flat = calculate_tax(_slab("FLAT_BY_BAND"), d("160000")).computed_amount
    assert _cents(progressive) == 680000
    assert _cents(flat) == 1280000
    assert _cents(flat) - _cents(progressive) == 600000

    # And again in the open-ended band, where the gap is far wider:
    #   PROGRESSIVE on 400000  =  59000.00 (worked above)
    #   FLAT_BY_BAND on 400000 = 400000 x 30/100 = 120000.00
    assert _cents(calculate_tax(_slab("PROGRESSIVE"), d("400000")).computed_amount) == 5900000
    assert _cents(calculate_tax(_slab("FLAT_BY_BAND"), d("400000")).computed_amount) == 12000000


def test_progressive_and_flat_agree_only_where_the_arithmetic_makes_them_agree():
    # The counterpart to the test above: inside the FIRST band the two
    # formulas are the same statement ("the portion inside band 1" IS the
    # whole base), so agreement there is a derived fact, not evidence that
    # slab_application is being ignored.
    #   both: 60000 x 2 / 100 = 1200.00
    assert _cents(calculate_tax(_slab("PROGRESSIVE"), d("60000")).computed_amount) == 120000
    assert _cents(calculate_tax(_slab("FLAT_BY_BAND"), d("60000")).computed_amount) == 120000


def test_slab_application_left_unset_falls_back_to_progressive():
    # Not a spec behaviour — Appendix B says the choice "is asked, never
    # assumed", and the database agrees: alembic 0002_masters.py's
    # ck_tax_heads_slab CHECK makes slab_application NOT NULL for every SLAB
    # head, so no stored head can reach the engine without one. This pins the
    # engine's defensive default for snapshots built in code.
    #   160000 under PROGRESSIVE = 6800.00 (worked above)
    snap = TaxHeadSnapshot(tax_name="No Mode", tax_type="SLAB", applies_from=FROM_DATE, slab_application=None, slab_bands=L1_BANDS)
    assert _cents(calculate_tax(snap, d("160000")).computed_amount) == 680000


# ----------------------------------------------------------- SPLIT COMPONENTS
def test_split_component_amounts_sum_to_the_parent_amount():
    """Appendix B: "component shares must total EXACTLY 100% of the head's
    calculated amount", and Invoice §2.2: "the invoice prints ONE LINE PER
    COMPONENT under its own name, and Tax Amount is their total." The printed
    lines and the Tax Amount that feeds Grand Total must be the same money.

      250000 x 12 / 100 = 30000.00 = the head's calculated amount
        Authority A 40% -> 30000 x 40 / 100 = 12000.00
        Authority B 35% -> 30000 x 35 / 100 = 10500.00
        Authority C 25% -> 30000 x 25 / 100 =  7500.00
        12000.00 + 10500.00 + 7500.00       = 30000.00
    """
    snap = _pct("12", split_components=(
        SplitComponent("Authority A", d("40")),
        SplitComponent("Authority B", d("35")),
        SplitComponent("Authority C", d("25")),
    ))
    result = calculate_tax(snap, d("250000"))
    assert [(c.component_name, _cents(c.amount)) for c in result.components] == [
        ("Authority A", 1200000), ("Authority B", 1050000), ("Authority C", 750000),
    ]
    assert sum(_cents(c.amount) for c in result.components) == _cents(result.computed_amount) == 3000000


def test_split_shares_summing_above_one_hundred_are_rejected():
    # The existing suite covers shares summing SHORT (60 + 30). Over-100 is
    # the other half of "must total EXACTLY 100%" and would silently invent
    # tax rather than lose it, so it is the more dangerous direction.
    snap = _pct("10", split_components=(SplitComponent("A", d("60")), SplitComponent("B", d("50"))))
    with pytest.raises(ValueError, match="must sum to 100"):
        calculate_tax(snap, d("1000"))


def test_split_shares_summing_to_one_hundred_with_paise_precision_are_accepted():
    # 33.34 + 33.33 + 33.33 = 100.00 exactly, so this must NOT be rejected.
    #   250000 x 12 / 100 = 30000.00
    #     A 33.34% -> 30000 x 33.34 / 100 = 10002.00
    #     B 33.33% -> 30000 x 33.33 / 100 =  9999.00
    #     C 33.33% -> 30000 x 33.33 / 100 =  9999.00
    #     10002.00 + 9999.00 + 9999.00    = 30000.00
    snap = _pct("12", split_components=(
        SplitComponent("A", d("33.34")), SplitComponent("B", d("33.33")), SplitComponent("C", d("33.33")),
    ))
    result = calculate_tax(snap, d("250000"))
    assert [_cents(c.amount) for c in result.components] == [1000200, 999900, 999900]
    assert sum(_cents(c.amount) for c in result.components) == _cents(result.computed_amount) == 3000000


# REGRESSION TEST for a real bug this suite found, now FIXED
# (tax_engine._allocate_to_total reconciles the shares to the total).
def test_split_components_must_total_the_calculated_amount_when_the_halves_round_down():
    """FINDING — hand arithmetic, checked twice against Appendix B:

      base 100.05, GST CGST 9% + SGST 9%
      gross   = 100.05 x 18 = 1800.90 ; 1800.90 / 100 = 18.009
      Tax Amount (2dp, HALF_UP; third decimal 9)      = 18.01
      The two printed lines must total 18.01. An exact half of 18.01 is
      9.005, which is not payable money, so the spec's "must total EXACTLY
      100%" forces the residual paise onto one line: 9.01 + 9.00 = 18.01.

      The engine instead halves the UNROUNDED 18.009 -> 9.0045 each,
      rounds each to 9.00, and prints 9.00 + 9.00 = 18.00, one paise short
      of the 18.01 it puts in Tax Amount and hence in Grand Total.
    """
    snap = TaxHeadSnapshot(
        tax_name="GST 18 Intrastate", tax_type="GST_CGST_SGST", applies_from=FROM_DATE,
        cgst_rate_pct=d("9"), sgst_rate_pct=d("9"),
        split_components=(SplitComponent("CGST", d("50")), SplitComponent("SGST", d("50"))),
    )
    result = calculate_tax(snap, d("100.05"))
    assert _cents(result.computed_amount) == 1801
    assert sum(_cents(c.amount) for c in result.components) == 1801


# REGRESSION TEST for a real bug this suite found, now FIXED
# (tax_engine._allocate_to_total reconciles the shares to the total).
def test_split_components_must_total_the_calculated_amount_when_the_halves_round_up():
    """FINDING — hand arithmetic, checked twice against Appendix B:

      base 100.06, GST CGST 9% + SGST 9%
      gross   = 100.06 x 18 = 1801.08 ; 1801.08 / 100 = 18.0108
      Tax Amount (2dp, HALF_UP; third decimal 0, but 18.0108 -> 18.01) = 18.01
      The two printed lines must total 18.01 (9.01 + 9.00).

      The engine halves the UNROUNDED 18.0108 -> 9.0054 each, rounds each
      UP to 9.01, and prints 9.01 + 9.01 = 18.02 — one paise MORE than the
      Tax Amount. Note 100.05 and 100.06 are adjacent subtotals that break
      in opposite directions, which is why a single-sided fix is not enough:
      the general rule is that two equal halves always total an EVEN number
      of paise, so no odd-paise tax can ever be split 50/50 without a
      deliberate residual allocation.
    """
    snap = TaxHeadSnapshot(
        tax_name="GST 18 Intrastate", tax_type="GST_CGST_SGST", applies_from=FROM_DATE,
        cgst_rate_pct=d("9"), sgst_rate_pct=d("9"),
        split_components=(SplitComponent("CGST", d("50")), SplitComponent("SGST", d("50"))),
    )
    result = calculate_tax(snap, d("100.06"))
    assert _cents(result.computed_amount) == 1801
    assert sum(_cents(c.amount) for c in result.components) == 1801


# REGRESSION TEST for a real bug this suite found, now FIXED
# (tax_engine._allocate_to_total).
def test_progressive_band_breakdown_must_sum_to_the_calculated_amount():
    """The bug: per-band amounts were each rounded to paise while the total was
    rounded once from the unrounded sum, so the displayed breakdown did not add
    up to the tax printed beside it — the Masters "live worked example" panel
    (masters_taxes.py /calculate) showed a sum that did not add up.

      bands [0 - 100.25] @ 2%, [100.25 and above] @ 3%; base 200.50
      band 1: 100.25 x 2 / 100 = 2.005
      band 2: 100.25 x 3 / 100 = 3.0075
      exact total                = 5.0125

    WHICH total is correct is NOT settled by the spec. Appendix B:25's "total =
    SUM across bands" defines the FORMULA — it is what distinguishes Progressive
    from Flat by Band, where one rate hits the whole base — and says nothing
    about rounding. Two self-consistent answers exist: round once (5.01) or sum
    the rounded bands (5.02).

    This engine rounds once, and the bands are reconciled to that. Reasons:
    5.01 is nearer the exact 5.0125 (summing rounded parts compounds the error
    upward), the bands are a BREAKDOWN rather than separately charged lines —
    computed_amount is the figure actually charged — and gross_amount and
    computed_amount already round once, so anything else would make the engine
    inconsistent with itself.

    The invariant that must hold either way, as the original finding put it:
    a total and its own itemisation must agree.
    """
    bands = (SlabBand(1, d("0"), d("100.25"), d("2")), SlabBand(2, d("100.25"), None, d("3")))
    result = calculate_tax(_slab("PROGRESSIVE", bands), d("200.50"))
    # Rounded once from 5.0125, not 2.01 + 3.01.
    assert _cents(result.computed_amount) == 501
    # THE INVARIANT: the itemisation adds up to the figure beside it.
    assert sum(_cents(b.amount) for b in result.slab_breakdown) == _cents(result.computed_amount)
    # Each band still lands within one paise of its exact share.
    assert [_cents(b.amount) for b in result.slab_breakdown] == [200, 301]


# ------------------------------------------------------------- RELIEF RULES
def _relieved(*reliefs: ReliefRule) -> TaxHeadSnapshot:
    return _pct("10", relief_rules=reliefs)


def test_relief_applies_below_the_threshold_and_only_reduces_partly():
    # Appendix B: a relief rule triggers on a base "at or below" its
    # threshold and "reduces the computed tax by the LESSER of its Relief
    # Amount or the tax itself".
    #   400000 x 10 / 100 = 40000.00 gross
    #   relief = min(12500, 40000)   = 12500.00
    #   40000.00 - 12500.00          = 27500.00
    relief = ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("12500"))
    result = calculate_tax(_relieved(relief), d("400000"))
    assert _cents(result.gross_amount) == 4000000
    assert _cents(result.computed_amount) == 2750000
    assert [(r.relief_name, _cents(r.relief_applied)) for r in result.reliefs_applied] == [("Rebate", 1250000)]


def test_relief_applies_when_the_base_sits_exactly_on_the_threshold():
    # "applies if base AT OR BELOW" — exactly on the line is INSIDE.
    #   500000 x 10 / 100 = 50000.00 gross
    #   50000.00 - 12500.00          = 37500.00
    relief = ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("12500"))
    result = calculate_tax(_relieved(relief), d("500000"))
    assert _cents(result.computed_amount) == 3750000


def test_relief_stops_one_paise_above_the_threshold():
    # The cliff Appendix B warns about ("the design cannot express a taper
    # above a relief threshold"): one paise more base and the whole relief
    # disappears.
    #   500000.01 x 10 = 5000000.1 ; / 100 = 50000.001 -> 2dp -> 50000.00
    #   no relief -> computed = gross = 50000.00 (vs 37500.00 one paise below)
    relief = ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("12500"))
    result = calculate_tax(_relieved(relief), d("500000.01"))
    assert _cents(result.computed_amount) == 5000000
    assert result.reliefs_applied == ()


def test_relief_larger_than_the_tax_clamps_to_zero_and_never_goes_negative():
    """Appendix B, RELIEF RULE CEILING, verbatim: "the relief applied is the
    LESSER of the configured Relief Amount and the tax actually computed, so
    a relief can NEVER turn into a refund."

      300000 x 2 / 100 = 6000.00 gross
      relief configured 12500.00, but the tax is only 6000.00
      relief actually applied = min(12500, 6000) = 6000.00
      6000.00 - 6000.00 = 0.00   (NOT -6500.00)
    """
    snap = TaxHeadSnapshot(
        tax_name="Small Tax", tax_type="PERCENTAGE", applies_from=FROM_DATE, rate_pct=d("2"),
        relief_rules=(ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("12500")),),
    )
    result = calculate_tax(snap, d("300000"))
    assert _cents(result.gross_amount) == 600000
    assert _cents(result.computed_amount) == 0
    assert result.computed_amount >= 0
    # The recorded relief is the 6000 actually taken, not the 12500 configured —
    # a payslip that recorded 12500 would not reconcile to the pay it explains.
    assert [_cents(r.relief_applied) for r in result.reliefs_applied] == [600000]


def test_stacked_reliefs_still_clamp_at_zero_and_never_over_relieve():
    # Two reliefs both qualify on the same base. Applied in sequence against
    # the running total, the second can only take what the first left:
    #   150000 x 10 / 100 = 15000.00 gross
    #   relief A = min(12500, 15000.00) = 12500.00 -> running 2500.00
    #   relief B = min(12500,  2500.00) =  2500.00 -> running    0.00
    #   total relief taken 15000.00 = the gross exactly, never more.
    reliefs = (
        ReliefRule("A", d("500000"), "REDUCE_BY_FIXED", d("12500")),
        ReliefRule("B", d("500000"), "REDUCE_BY_FIXED", d("12500")),
    )
    result = calculate_tax(_relieved(*reliefs), d("150000"))
    assert _cents(result.gross_amount) == 1500000
    assert _cents(result.computed_amount) == 0
    assert [(r.relief_name, _cents(r.relief_applied)) for r in result.reliefs_applied] == [("A", 1250000), ("B", 250000)]
    assert sum(_cents(r.relief_applied) for r in result.reliefs_applied) == _cents(result.gross_amount)


def test_relief_on_a_zero_tax_records_nothing_and_stays_at_zero():
    # Nothing to relieve — the rule must not manufacture a negative figure or
    # a phantom relief line on a payslip.
    #   0 x 10 / 100 = 0.00 ; relief taken = min(12500, 0) = 0.00
    relief = ReliefRule("Rebate", d("500000"), "REDUCE_BY_FIXED", d("12500"))
    result = calculate_tax(_relieved(relief), d("0"))
    assert _cents(result.computed_amount) == 0
    assert result.reliefs_applied == ()


def test_unknown_relief_type_is_rejected_rather_than_silently_ignored():
    # A relief the engine cannot apply must not quietly leave the tax
    # un-relieved — that is a wrong payslip, not a missing feature.
    snap = _relieved(ReliefRule("Mystery", d("500000"), "TAPER_ABOVE_THRESHOLD", d("1")))
    with pytest.raises(ValueError, match="Unknown relief_type"):
        calculate_tax(snap, d("100000"))


# --------------------------------------------------------------- WITHHOLDING
# Appendix B / Purchase Bill §2.2 and Invoice §2.4: a withholding head is
# chosen per document and its figure is the head's own calculation applied to
# a basis of either the Subtotal or the Total, defaulting to Subtotal. Both
# call sites (purchase_bills.py "basis = subtotal if withholding_calculated_on
# == 'SUBTOTAL' else total_amount" and invoices.py's mirror image) hand the
# engine nothing but that number — this helper is only the basis selection,
# every asserted figure below comes from calculate_tax itself.
def _withholding_basis(subtotal: Decimal, total: Decimal, calculated_on: str | None) -> Decimal:
    return subtotal if (calculated_on or "SUBTOTAL") == "SUBTOTAL" else total


def test_withholding_on_a_payment_made_to_a_vendor():
    # Purchase Bill: subtotal 250000, GST 18% -> tax 45000.00 -> Total 295000.00
    #   ("PURCHASE BILL - Total = Subtotal + Tax Amount")
    # Vendor withholding head at 10% on the Subtotal:
    #   250000 x 10 / 100 = 25000.00
    subtotal, total = d("250000"), d("295000")
    assert _cents(calculate_tax(_pct("18"), subtotal).computed_amount) == 4500000
    basis = _withholding_basis(subtotal, total, "SUBTOTAL")
    assert _cents(calculate_tax(_pct("10"), basis).computed_amount) == 2500000


def test_withholding_on_a_payment_received_from_a_customer():
    # Invoice Record Payment: the customer withholds at source on the same
    # arithmetic, only the direction of the money differs.
    #   Subtotal 100000, GST 18% -> tax 18000.00 -> Grand Total 118000.00
    #   ("Grand Total = Subtotal + Tax Amount")
    #   customer withholding 10% on the Subtotal: 100000 x 10 / 100 = 10000.00
    subtotal, grand_total = d("100000"), d("118000")
    assert _cents(calculate_tax(_pct("18"), subtotal).computed_amount) == 1800000
    basis = _withholding_basis(subtotal, grand_total, "SUBTOTAL")
    assert _cents(calculate_tax(_pct("10"), basis).computed_amount) == 1000000


def test_subtotal_and_total_bases_produce_different_withholding_figures():
    """The reason `withholding_calculated_on` is persisted on the document at
    all: the two bases are NOT interchangeable.

      Subtotal 100000, GST 18% tax 18000.00, Grand Total 118000.00
      on SUBTOTAL: 100000 x 10 / 100 = 10000.00
      on TOTAL:    118000 x 10 / 100 = 11800.00
      difference                     =  1800.00  (the tax being withheld on)
    """
    subtotal, grand_total = d("100000"), d("118000")
    on_subtotal = calculate_tax(_pct("10"), _withholding_basis(subtotal, grand_total, "SUBTOTAL")).computed_amount
    on_total = calculate_tax(_pct("10"), _withholding_basis(subtotal, grand_total, "TOTAL")).computed_amount
    assert _cents(on_subtotal) == 1000000
    assert _cents(on_total) == 1180000
    assert _cents(on_total) - _cents(on_subtotal) == 180000


def test_withholding_basis_defaults_to_subtotal_when_unset():
    # Invoice §2.4: "Defaults to Invoice Subtotal." An unset basis must not
    # quietly pick the larger number.
    #   100000 x 10 / 100 = 10000.00, NOT 118000 x 10 / 100 = 11800.00
    basis = _withholding_basis(d("100000"), d("118000"), None)
    assert _cents(calculate_tax(_pct("10"), basis).computed_amount) == 1000000


def test_one_head_carrying_both_directions_calculates_identically_either_way():
    """A head may carry ON_PAYMENTS_MADE and ON_PAYMENTS_RECEIVED at once
    (tax_head_withholding_directions is a child table, not a single column).
    Direction gates SELECTABILITY, never arithmetic: the same head on the
    same basis must produce the same money whichever side it is used on,
    otherwise the payable and receivable registers would disagree about one
    rate.

      both directions, base 250000: 250000 x 10 / 100 = 25000.00
    """
    head = _pct("10")
    directions = ("ON_PAYMENTS_MADE", "ON_PAYMENTS_RECEIVED")
    figures = {direction: calculate_tax(head, d("250000")).computed_amount for direction in directions}
    assert [_cents(v) for v in figures.values()] == [2500000, 2500000]

    # Appendix B, Module 15: "The payable register (liability) and the
    # receivable register (asset) are NEVER netted into a single figure."
    # They stand as two separate amounts of 25000.00 each — never a 0.00 net.
    payable = figures["ON_PAYMENTS_MADE"]
    receivable = figures["ON_PAYMENTS_RECEIVED"]
    assert _cents(payable) == 2500000 and _cents(receivable) == 2500000
    assert _cents(payable) + _cents(receivable) == 5000000


# --------------------------------------------------- ZERO CONFIGURED HEADS
def test_no_tax_heads_configured_resolves_to_nothing_on_every_date():
    """Appendix B, verbatim: "An empty Taxes list must produce documents with
    no tax lines rather than erroring or falling back to a default", and
    Invoice: "IF NO BILLING TAX IS CONFIGURED IN MASTERS, HIDE THE TAX
    DROPDOWN ENTIRELY and set Grand Total = Subtotal."
    """
    for as_of in (date(2020, 1, 1), date(2026, 4, 1), date(2026, 8, 26), date(2099, 12, 31)):
        assert select_effective_head([], as_of) is None


def test_every_document_shape_produces_no_tax_line_when_no_head_is_configured():
    # The four document totals Appendix B states, each with zero heads:
    #   Invoice        Grand Total = Subtotal + Tax Amount
    #   Purchase Bill  Total       = Subtotal + Tax Amount
    #   Expense        Amount stays the full amount paid, Tax recorded alongside
    #   Payslip        no income-tax head configured -> "no error, no zero-line"
    # With no head, Tax Amount is absent (not 0.00 on a line) and every total
    # collapses to its subtotal.
    for subtotal in (d("0"), d("1"), d("100000"), d("1234.56")):
        head = select_effective_head([], date(2026, 8, 26))
        assert head is None
        tax_lines = [] if head is None else [calculate_tax(head, subtotal)]
        assert tax_lines == []
        grand_total = subtotal + sum((line.computed_amount for line in tax_lines), Decimal("0"))
        assert grand_total == subtotal


def test_a_head_whose_window_has_closed_leaves_the_document_with_no_tax():
    # "setting [Applies Until] retires the head from that date forward" — the
    # day after retirement, with no successor configured, is the same
    # zero-heads situation, not a fallback to the retired rate.
    retired = TaxHeadSnapshot(
        tax_name="Retired Levy", tax_type="PERCENTAGE", applies_from=date(2025, 4, 1),
        applies_until=date(2026, 3, 31), rate_pct=d("12"),
    )
    assert select_effective_head([retired], date(2026, 3, 31)) is retired
    assert select_effective_head([retired], date(2026, 4, 1)) is None


# --------------------------------------------------------- DIVIDE BY ZERO
def test_every_division_in_the_engine_divides_by_a_non_zero_constant():
    """"Every division has a divide-by-zero test" (COMPLETE-TEST-PROMPT
    §Layer 1). The engine's divisions are all by the literal 100 — the
    percent denominator — so divide-by-zero is structurally impossible rather
    than merely untriggered. This test proves that structurally by reading
    the source, and FAILS the moment anyone introduces a division by a
    variable, which is the point at which a real divide-by-zero test becomes
    necessary. The behavioural zero-input tests that follow exercise each
    division site with the zero-valued inputs that flow into it.
    """
    tree = ast.parse(inspect.getsource(tax_engine_module))
    divisions = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod))
    ]
    # Guard against the test going vacuous if the divisions are ever moved out.
    assert len(divisions) >= 5, f"expected the engine's percent divisions, found {len(divisions)}"

    divisors = []
    for node in divisions:
        right = node.right
        if isinstance(right, ast.Call) and isinstance(right.func, ast.Name) and right.func.id == "Decimal" and len(right.args) == 1:
            literal = right.args[0]
        else:
            literal = right
        assert isinstance(literal, ast.Constant), (
            f"tax_engine.py line {node.lineno} divides by a non-constant expression — "
            "it needs an explicit divide-by-zero test, and this guard updated"
        )
        divisors.append(Decimal(str(literal.value)))

    assert all(divisor != 0 for divisor in divisors)
    assert set(divisors) == {Decimal(100)}, f"unexpected divisor(s): {sorted(set(divisors))}"


def test_zero_rate_percentage_and_gst_divide_cleanly():
    # Division sites 1 and 2 (PERCENTAGE / GST_IGST, and GST_CGST_SGST).
    # 100000 x 0 / 100 = 0.00 ; 100000 x (0 + 0) / 100 = 0.00
    assert _cents(calculate_tax(_pct("0"), d("100000")).computed_amount) == 0
    igst = TaxHeadSnapshot(tax_name="Zero IGST", tax_type="GST_IGST", applies_from=FROM_DATE, rate_pct=d("0"))
    assert _cents(calculate_tax(igst, d("100000")).computed_amount) == 0
    zero_split = TaxHeadSnapshot(
        tax_name="Zero Intrastate", tax_type="GST_CGST_SGST", applies_from=FROM_DATE,
        cgst_rate_pct=d("0"), sgst_rate_pct=d("0"),
    )
    assert _cents(calculate_tax(zero_split, d("100000")).computed_amount) == 0


def test_zero_width_band_and_zero_rate_band_divide_cleanly():
    # Division site 3 (progressive band). A band whose From equals its To has
    # no portion inside it and must contribute nothing, not raise.
    #   band 1 [0 - 0]  @ 10% -> portion 0        -> skipped entirely
    #   band 2 [0 - up] @  5% -> 1000 x 5 / 100   = 50.00
    bands = (SlabBand(1, d("0"), d("0"), d("10")), SlabBand(2, d("0"), None, d("5")))
    result = calculate_tax(_slab("PROGRESSIVE", bands), d("1000"))
    assert _cents(result.computed_amount) == 5000
    assert [b.sequence_no for b in result.slab_breakdown] == [2]

    # Division site 4 (flat band), rate 0: 1000 x 0 / 100 = 0.00
    flat_zero = (SlabBand(1, d("0"), None, d("0")),)
    assert _cents(calculate_tax(_slab("FLAT_BY_BAND", flat_zero), d("1000")).computed_amount) == 0


def test_zero_share_split_component_divides_cleanly():
    # Division site 5 (split). A 0% component is legal as long as the shares
    # still total 100.
    #   1000 x 10 / 100 = 100.00 ; A 0% -> 0.00 ; B 100% -> 100.00 ; sum 100.00
    snap = _pct("10", split_components=(SplitComponent("Dormant", d("0")), SplitComponent("Live", d("100"))))
    result = calculate_tax(snap, d("1000"))
    assert [(c.component_name, _cents(c.amount)) for c in result.components] == [("Dormant", 0), ("Live", 10000)]
    assert sum(_cents(c.amount) for c in result.components) == _cents(result.computed_amount) == 10000


def test_a_slab_head_with_no_bands_is_a_configuration_error_not_a_zero():
    # There is no division to reach here — but silently returning 0.00 would
    # be worse than raising, because a mis-saved head would then under-charge
    # every document instead of announcing itself.
    snap = TaxHeadSnapshot(tax_name="Bandless", tax_type="SLAB", applies_from=FROM_DATE, slab_application="PROGRESSIVE")
    with pytest.raises(ValueError, match="requires at least one band"):
        calculate_tax(snap, d("100000"))


def test_an_unknown_tax_type_is_rejected_rather_than_defaulted():
    # Appendix B: "NO TAX MAY EVER BE HARDCODED... There is NO built-in
    # default tax anywhere in this CMS." An unrecognised type must not fall
    # through to a percentage of anything.
    snap = TaxHeadSnapshot(tax_name="Mystery", tax_type="TURNOVER_LEVY", applies_from=FROM_DATE, rate_pct=d("5"))
    with pytest.raises(ValueError, match="Unknown tax_type"):
        calculate_tax(snap, d("100000"))


# ------------------------------------------------------- MONEY AND ROUNDING
def test_money_rounds_half_up_at_two_decimals_not_bankers_rounding():
    """Money is quantized HALF_UP. These two bases land the gross EXACTLY on
    a half-paise, where HALF_UP and Python's default HALF_EVEN disagree — so
    each assertion distinguishes the two rather than merely re-stating them.

      0.25 x 2 = 0.50 ; / 100 = 0.0050 exactly -> HALF_UP 0.01, HALF_EVEN 0.00
      1.25 x 2 = 2.50 ; / 100 = 0.0250 exactly -> HALF_UP 0.03, HALF_EVEN 0.02
    """
    assert _cents(calculate_tax(_pct("2"), d("0.25")).computed_amount) == 1
    assert _cents(calculate_tax(_pct("2"), d("1.25")).computed_amount) == 3

    # Proof the two modes really do disagree on these figures, so the
    # assertions above are pinning HALF_UP and not just "some rounding".
    for exact, half_up, half_even in ((d("0.0050"), d("0.01"), d("0.00")), (d("0.0250"), d("0.03"), d("0.02"))):
        assert exact.quantize(d("0.01"), rounding=ROUND_HALF_UP) == half_up
        assert exact.quantize(d("0.01"), rounding=ROUND_HALF_EVEN) == half_even


def test_rounding_happens_once_at_the_end_not_on_the_way_in():
    # 55.61 x 18 = 1000.98 ; / 100 = 10.0098 -> 2dp -> 10.01
    # Rounding the base or the intermediate to 2dp first would give 10.01 too,
    # but rounding to whole rupees first (56 x 18% = 10.08) would not — this
    # pins the figure to the full-precision calculation.
    assert _cents(calculate_tax(_pct("18"), d("55.61")).computed_amount) == 1001


def test_every_money_field_is_scaled_to_two_decimals():
    """Equality alone never proves scale: Decimal("18.0") == Decimal("18").
    Every money-carrying field the engine RETURNS must be quantized to
    exactly two decimal places, because these figures are written straight
    onto invoice, bill and payslip lines.
    """
    snap = TaxHeadSnapshot(
        tax_name="Everything", tax_type="SLAB", applies_from=FROM_DATE, slab_application="PROGRESSIVE",
        slab_bands=L1_BANDS,
        split_components=(SplitComponent("A", d("60")), SplitComponent("B", d("40"))),
        relief_rules=(ReliefRule("Rebate", d("999999999"), "REDUCE_BY_FIXED", d("1000")),),
    )
    # 400000: bands 2000.00 + 12000.00 + 45000.00 = 59000.00 gross
    #         relief min(1000, 59000) = 1000.00 -> computed 58000.00
    #         A 60% -> 34800.00 ; B 40% -> 23200.00 ; sum 58000.00
    result = calculate_tax(snap, d("400000"))
    assert _cents(result.gross_amount) == 5900000
    assert _cents(result.computed_amount) == 5800000
    assert sum(_cents(c.amount) for c in result.components) == 5800000

    money_fields = [result.gross_amount, result.computed_amount]
    money_fields += [c.amount for c in result.components]
    money_fields += [b.amount for b in result.slab_breakdown]
    money_fields += [r.relief_applied for r in result.reliefs_applied]
    assert money_fields, "guard against the assertion below passing on an empty list"
    for value in money_fields:
        assert value.as_tuple().exponent == -2, f"{value} is not scaled to two decimals"
