"""Module 15's Credits register (15-tax-compliance-module.md §2.6/§2.7) — the
mirror image of obligation_engine.py, deliberately a separate file since §1
treats the two directions as never-netted: this is money a CUSTOMER withheld
FROM the company (an asset the company may claim back), fed by
invoice_payments.withheld_amount (Invoice → Record Payment, Module 11 §2.4)
— a fundamentally different flow from Purchase Bill/Payroll's liabilities,
never sharing a query or a status vocabulary with obligation_engine.py.

§1's "creates_onward_liability" gate is a liability-side concept; a customer-
withholding head is identified instead by carrying the ON_PAYMENTS_RECEIVED
direction on a WITHHOLDING_AT_SOURCE-scope head (already validated at the
one existing write site, invoices.py's record_payment, via
tax_head_lookup.validate_head_usable(..., required_direction=
"ON_PAYMENTS_RECEIVED")) — this module doesn't re-validate that, it only
reads whatever invoice_payments rows already exist with a non-null
customer_withheld_tax_head_id.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.compliance import CertificateReceipt, CreditClaim, WithholdingCertificate
from app.models.finance import Invoice, InvoicePayment
from app.models.masters import TaxHead, TaxHeadWithholdingDirection


async def has_any_credit_head(db: AsyncSession) -> bool:
    """§2.1's "nothing is configured" empty state for the Credits panel."""
    row = (
        await db.execute(
            select(TaxHead.id)
            .join(TaxHeadWithholdingDirection, TaxHeadWithholdingDirection.tax_head_id == TaxHead.id)
            .where(TaxHead.scope == "WITHHOLDING_AT_SOURCE", TaxHeadWithholdingDirection.direction == "ON_PAYMENTS_RECEIVED")
            .limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


@dataclass(frozen=True)
class CreditRow:
    invoice_payment_id: str
    invoice_number: str
    customer_id: str
    customer_name: str
    payment_date: object
    invoice_total: object
    amount_received: object
    withheld: object
    tax_head_id: str
    certificate_id: str | None
    certificate_reference: str | None
    credit_claimed: bool
    status: str  # NOT_EXPECTED | AWAITING_CERTIFICATE | CERTIFIED_UNCLAIMED | CLAIMED | VARIANCE


async def build_credit_rows(db: AsyncSession) -> list[CreditRow]:
    rows = (
        await db.execute(
            select(InvoicePayment, Invoice)
            .join(Invoice, Invoice.id == InvoicePayment.invoice_id)
            .where(InvoicePayment.customer_withheld_tax_head_id.isnot(None), InvoicePayment.withheld_amount > 0)
            .order_by(InvoicePayment.payment_date.desc())
        )
    ).all()
    if not rows:
        return []

    payment_ids = [p.id for p, _inv in rows]
    head_ids = {p.customer_withheld_tax_head_id for p, _inv in rows}
    heads = {h.id: h for h in (await db.execute(select(TaxHead).where(TaxHead.id.in_(head_ids)))).scalars().all()}

    receipt_links = (
        await db.execute(select(CertificateReceipt).where(CertificateReceipt.invoice_payment_id.in_(payment_ids)))
    ).scalars().all()
    cert_id_by_payment: dict[str, str] = {r.invoice_payment_id: r.certificate_id for r in receipt_links}

    cert_ids = set(cert_id_by_payment.values())
    certs = {c.id: c for c in (await db.execute(select(WithholdingCertificate).where(WithholdingCertificate.id.in_(cert_ids)))).scalars().all()} if cert_ids else {}

    claimed_cert_ids = set((await db.execute(select(CreditClaim.certificate_id).where(CreditClaim.certificate_id.in_(cert_ids)))).scalars().all()) if cert_ids else set()

    out = []
    for payment, invoice in rows:
        head = heads.get(payment.customer_withheld_tax_head_id)
        cert_id = cert_id_by_payment.get(payment.id)
        cert = certs.get(cert_id) if cert_id else None

        if cert is not None:
            if cert.status == "VOIDED":
                status = "AWAITING_CERTIFICATE"
                cert_id = None
            elif cert.id in claimed_cert_ids:
                # Checked BEFORE variance — found by the close-out audit: a
                # variance certificate CAN be claimed (§7.4/§2.9: "the
                # certified figure governs" regardless of variance), and once
                # claimed the credit is fully settled. Checking variance
                # first would keep a settled, claimed credit permanently
                # reading "Variance" and never "Claimed."
                status = "CLAIMED"
            elif cert.variance != 0:
                status = "VARIANCE"
            else:
                status = "CERTIFIED_UNCLAIMED"
        elif head is not None and not head.certificate_expected:
            status = "NOT_EXPECTED"
        else:
            status = "AWAITING_CERTIFICATE"

        out.append(CreditRow(
            invoice_payment_id=payment.id, invoice_number=invoice.invoice_number, customer_id=invoice.customer_id,
            customer_name=invoice.customer_name_snapshot, payment_date=payment.payment_date, invoice_total=invoice.grand_total,
            amount_received=payment.amount_received, withheld=payment.withheld_amount,
            tax_head_id=payment.customer_withheld_tax_head_id, certificate_id=cert_id,
            certificate_reference=cert.certificate_reference if cert else None,
            credit_claimed=(cert.id in claimed_cert_ids) if cert else False, status=status,
        ))
    return out
