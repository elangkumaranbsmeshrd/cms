"""Shared DB-touching helpers for resolving TaxHead rows into
tax_engine.TaxHeadSnapshot and finding which heads are in force for a given
scope/date — used identically by Purchase Bill and Invoice (Phase 4) and
mirrors the private helpers payroll_runs.py already has for the same
purpose. Factored out here (rather than duplicated a third time) since two
new modules need it at once.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.masters import TaxHead, TaxHeadReliefRule, TaxHeadSlabBand, TaxHeadSplitComponent, TaxHeadWithholdingDirection
from app.services import tax_engine


async def build_tax_head_snapshot(db: AsyncSession, head: TaxHead) -> tax_engine.TaxHeadSnapshot:
    bands = (await db.execute(select(TaxHeadSlabBand).where(TaxHeadSlabBand.tax_head_id == head.id))).scalars().all()
    reliefs = (
        await db.execute(select(TaxHeadReliefRule).where(TaxHeadReliefRule.tax_head_id == head.id, TaxHeadReliefRule.is_active.is_(True)))
    ).scalars().all()
    # Found missing entirely by the Phase 6 close-out audit: the snapshot never
    # loaded split_components, so a CGST+SGST-style split tax head could never
    # actually produce more than one InvoiceTaxLine/PurchaseBillTaxLine row —
    # the split-printing logic in invoices.py/purchase_bills.py was dead code.
    splits = (
        await db.execute(select(TaxHeadSplitComponent).where(TaxHeadSplitComponent.tax_head_id == head.id).order_by(TaxHeadSplitComponent.sequence_no))
    ).scalars().all()
    return tax_engine.TaxHeadSnapshot(
        tax_name=head.tax_name, tax_type=head.tax_type, applies_from=head.applies_from, applies_until=head.applies_until,
        rate_pct=head.rate_pct, cgst_rate_pct=head.cgst_rate_pct, sgst_rate_pct=head.sgst_rate_pct, fixed_amount=head.fixed_amount,
        slab_application=head.slab_application,
        slab_bands=tuple(tax_engine.SlabBand(b.sequence_no, b.band_from, b.band_to, b.rate_or_amount) for b in bands),
        relief_rules=tuple(tax_engine.ReliefRule(r.relief_name, r.applies_if_base_at_or_below, r.relief_type, r.relief_amount) for r in reliefs),
        split_components=tuple(tax_engine.SplitComponent(s.component_name, s.share_pct) for s in splits),
        print_label=head.print_label,
    )


async def in_force_heads(db: AsyncSession, scopes: tuple[str, ...], as_of: date) -> list[TaxHead]:
    heads = (
        await db.execute(select(TaxHead).where(TaxHead.scope.in_(scopes), TaxHead.is_active.is_(True), TaxHead.applies_from <= as_of))
    ).scalars().all()
    return [h for h in heads if h.applies_until is None or h.applies_until >= as_of]


async def validate_head_usable(
    db: AsyncSession, head: TaxHead, allowed_scopes: tuple[str, ...], as_of: date, *, required_direction: str | None = None,
) -> str | None:
    """Server-side mirror of what `in_force_heads` filters a dropdown down
    to — every Purchase Bill/Invoice/Expense tax-head field description
    says a head is only selectable when its scope/direction/date match, but
    nothing previously stopped the API from accepting any head id regardless
    (this helper existed, `in_force_heads`, and was imported but never
    called — a real gap, found by the Phase 4 audit). Returns a block-reason
    string, or None if the head is genuinely usable here — same "return a
    reason, let the caller raise" convention as finance_link_guard.py.
    """
    if head.scope not in allowed_scopes:
        return f"Tax head '{head.tax_name}' is not valid here (scope {head.scope!r}, expected one of {allowed_scopes})"
    if not head.is_active:
        return f"Tax head '{head.tax_name}' is not active"
    if head.applies_from > as_of or (head.applies_until is not None and head.applies_until < as_of):
        return f"Tax head '{head.tax_name}' is not in force on {as_of.isoformat()}"
    if required_direction is not None:
        directions = (
            await db.execute(select(TaxHeadWithholdingDirection.direction).where(TaxHeadWithholdingDirection.tax_head_id == head.id))
        ).scalars().all()
        if required_direction not in directions:
            return f"Tax head '{head.tax_name}' does not carry the withholding direction {required_direction!r}"
    return None
