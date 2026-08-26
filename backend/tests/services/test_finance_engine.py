"""Layer 1 (COMPLETE-TEST-PROMPT §Layer 1) — every expected value below is
hand-computed from build-docs/APPENDIX-B-business-rules.md and shown as
arithmetic in a comment above its assertion, never read back off the code.

DIVISION AUDIT: app/services/finance_engine.py contains NO division operator
at all — every function here is addition, subtraction, comparison or a date
delta. There is therefore no divide-by-zero surface to test; what IS tested
below is the degenerate ZERO-DENOMINATOR analogue those comparisons do have,
a document whose total is zero (test_invoice_status_with_a_zero_claim_amount
/ test_purchase_bill_status_with_a_zero_total). Re-check this note before
adding any division to that module.
"""

import uuid
from datetime import date
from decimal import Decimal

from app.models.finance import Invoice
from app.services.finance_engine import ageing_bucket, build_bank_statement, resolve_invoice_status_after_payment, resolve_purchase_bill_status


# =================================================== resolve_purchase_bill_status
def test_purchase_bill_unpaid_with_no_payment():
    assert resolve_purchase_bill_status(Decimal("0"), Decimal("0"), Decimal("1000")) == "UNPAID"


def test_purchase_bill_part_paid():
    assert resolve_purchase_bill_status(Decimal("400"), Decimal("0"), Decimal("1000")) == "PART_PAID"


def test_purchase_bill_paid_by_payment_alone():
    assert resolve_purchase_bill_status(Decimal("1000"), Decimal("0"), Decimal("1000")) == "PAID"


def test_purchase_bill_withholding_worked_example_a276():
    # The spec's own worked example: Bill Total 1,00,000, Withholding @10%
    # on Subtotal = 10,000 -> Amount Payable to Vendor = 90,000 -> paying
    # 90,000 reaches Paid, even though only 90,000 left the bank.
    assert resolve_purchase_bill_status(Decimal("90000"), Decimal("10000"), Decimal("100000")) == "PAID"


def test_purchase_bill_withholding_alone_not_yet_paid():
    # Withholding recorded on the bill but no payment made yet.
    assert resolve_purchase_bill_status(Decimal("0"), Decimal("10000"), Decimal("100000")) == "PART_PAID"


def test_purchase_bill_naive_comparison_would_wrongly_strand_this_at_part_paid():
    # The exact bug A276 fixes: comparing payments alone (90000) to Total
    # (100000) would say Part-Paid forever. payments + withholding = Total.
    status = resolve_purchase_bill_status(Decimal("90000"), Decimal("10000"), Decimal("100000"))
    assert status == "PAID", "naive amount_paid == total_amount comparison strands every withheld bill at Part-Paid"


# ============================================= resolve_invoice_status_after_payment
def test_invoice_sent_when_nothing_received_yet():
    assert resolve_invoice_status_after_payment(Decimal("0"), Decimal("0"), Decimal("1000")) == "SENT"


def test_invoice_part_paid():
    assert resolve_invoice_status_after_payment(Decimal("400"), Decimal("0"), Decimal("1000")) == "PART_PAID"


def test_invoice_paid_by_receipt_alone():
    assert resolve_invoice_status_after_payment(Decimal("1000"), Decimal("0"), Decimal("1000")) == "PAID"


def test_invoice_paid_with_customer_withholding():
    # A ₹1,00,000 invoice settled by a ₹90,000 receipt with ₹10,000 withheld
    # by the customer reaches Paid and locks (Appendix B, verbatim example).
    assert resolve_invoice_status_after_payment(Decimal("90000"), Decimal("10000"), Decimal("100000")) == "PAID"


def test_invoice_claim_amount_already_nets_off_credit_notes():
    # claim_amount is computed by the caller as grand_total - credit_notes;
    # this function only ever sees the already-netted figure.
    claim_amount = Decimal("100000") - Decimal("20000")  # after an approved credit note
    assert resolve_invoice_status_after_payment(Decimal("80000"), Decimal("0"), claim_amount) == "PAID"


# ============================================================== ageing_bucket
def test_ageing_none_when_no_due_date():
    assert ageing_bucket(None, date(2026, 8, 1), is_settled=False) is None


def test_ageing_none_when_settled():
    assert ageing_bucket(date(2026, 1, 1), date(2026, 8, 1), is_settled=True) is None


def test_ageing_current_when_not_yet_due():
    result = ageing_bucket(date(2026, 8, 10), date(2026, 8, 1), is_settled=False)
    assert result.label == "Current"


def test_ageing_current_on_due_date_itself():
    result = ageing_bucket(date(2026, 8, 1), date(2026, 8, 1), is_settled=False)
    assert result.label == "Current"


def test_ageing_boundary_1_to_30():
    result = ageing_bucket(date(2026, 7, 1), date(2026, 7, 31), is_settled=False)  # 30 days overdue
    assert result.label == "1-30"


def test_ageing_boundary_31_to_60():
    result = ageing_bucket(date(2026, 7, 1), date(2026, 8, 1), is_settled=False)  # 31 days overdue
    assert result.label == "31-60"


def test_ageing_boundary_61_to_90():
    result = ageing_bucket(date(2026, 6, 1), date(2026, 8, 1), is_settled=False)  # 61 days overdue
    assert result.label == "61-90"


def test_ageing_90_plus():
    result = ageing_bucket(date(2026, 1, 1), date(2026, 8, 1), is_settled=False)  # well over 90 days
    assert result.label == "90+"


# ======================================================== build_bank_statement
def test_statement_running_balance_accumulates_debit_only():
    rows = [
        (date(2026, 8, 1), "Taxi fare", "HDFC Bank", "REF-1", Decimal("500")),
        (date(2026, 8, 3), "Team lunch", "HDFC Bank", "REF-2", Decimal("1200")),
        (date(2026, 8, 2), "Hotel", "ICICI Bank", "REF-3", Decimal("3000")),
    ]
    lines = build_bank_statement(rows)
    assert [l.date for l in lines] == [date(2026, 8, 1), date(2026, 8, 2), date(2026, 8, 3)], "must be re-sorted ascending regardless of input order"
    assert lines[0].running_balance == Decimal("500")
    assert lines[1].running_balance == Decimal("3500")
    assert lines[2].running_balance == Decimal("4700"), "running balance must equal the sum of every debit so far — this is the phase's own 'export reconciles' gate"


def test_statement_empty_input_produces_empty_output():
    assert build_bank_statement([]) == []


def test_statement_single_row_balance_equals_its_own_debit():
    lines = build_bank_statement([(date(2026, 8, 1), "Only claim", None, "REF-1", Decimal("250"))])
    assert lines[0].running_balance == Decimal("250")


# ========================================== ZERO-DENOMINATOR (divide-by-zero analogue)
def test_invoice_status_with_a_zero_claim_amount():
    """The degenerate total. APPENDIX-B:430 caps a Credit Note at the
    invoice's Grand Total, so a 100%-credited invoice legitimately reaches
    Claim = 0. APPENDIX-B:611 states the mirror-image rule in full for the
    same arithmetic on a Purchase Bill: PAID needs "the new TOTAL PAID EQUALS
    the ... Total", PART-PAID needs it "MORE THAN ZERO BUT LESS THAN the
    Total" — with nothing received, neither clause is satisfied, so the
    document stays at its unsettled floor (SENT for an invoice, since
    Draft->Sent is a separate explicit action). No division is performed on
    the zero total, and nothing raises.
    """
    assert resolve_invoice_status_after_payment(Decimal("0"), Decimal("0"), Decimal("0")) == "SENT"


def test_invoice_status_zero_claim_with_money_actually_received():
    # settled = 1 + 0 = 1; 1 > 0 so it is not the unsettled floor, and
    # 1 >= claim 0 satisfies APPENDIX-B:611's "TOTAL PAID EQUALS the Total"
    # clause (it exceeds it) -> PAID. Still no division by the zero total.
    assert resolve_invoice_status_after_payment(Decimal("1"), Decimal("0"), Decimal("0")) == "PAID"


def test_purchase_bill_status_with_a_zero_total():
    # settled = 0 + 0 = 0, which is not "MORE THAN ZERO" (APPENDIX-B:611),
    # so the bill is UNPAID rather than PAID-by-vacuous-equality.
    assert resolve_purchase_bill_status(Decimal("0"), Decimal("0"), Decimal("0")) == "UNPAID"


# ============================================================ INVOICE BALANCE
# APPENDIX-B:426, verbatim: "Balance = Grand Total - Paid", where
#   APPENDIX-B:419  Grand Total = Subtotal + Tax Amount
#   APPENDIX-B:425  Paid        = sum of every payment recorded against the invoice
#   APPENDIX-B:437  an approved Credit Note reduces the EFFECTIVE OUTSTANDING
#                   balance by the Credit Amount
#   APPENDIX-B:428  a payment "must not exceed Balance Due. Overpayment is
#                   blocked outright"
# There is no pure Python invoice-balance function to unit-test: the production
# formula is the GENERATED ALWAYS AS column on app/models/finance.py:145 —
#   subtotal + tax_amount - credit_note_total - amount_received - withheld_total
# Asserting hand-computed values against a Python re-implementation of that
# expression would prove nothing, so these tests exercise the real column
# through the throwaway in-memory SQLite session from tests/conftest.py
# (SQLite 3.31+ supports generated columns, so the production expression is
# the one actually evaluated here). Money is Numeric(14, 2) and round-trips as
# a 2-decimal Decimal; every expected figure below is worked out by hand.
_FY_ID = "fy-2026"
_CUSTOMER_ID = "cust-1"


async def _invoice(
    db,
    *,
    subtotal: str,
    tax_amount: str = "0.00",
    credit_note_total: str = "0.00",
    amount_received: str = "0.00",
    withheld_total: str = "0.00",
) -> Invoice:
    """One invoice row carrying only the five money inputs the balance
    expression reads. The FK columns are unenforced here (the fixture leaves
    SQLite's PRAGMA foreign_keys at its default OFF), so no Customer or
    FinancialYear row is needed to evaluate the arithmetic.
    """
    invoice = Invoice(
        id=str(uuid.uuid4()),
        invoice_number=f"INV-2026-{uuid.uuid4().hex[:5]}",
        financial_year_id=_FY_ID,
        customer_id=_CUSTOMER_ID,
        customer_name_snapshot="Acme Pvt Ltd",
        invoice_date=date(2026, 6, 1),
        subtotal=Decimal(subtotal),
        tax_amount=Decimal(tax_amount),
        credit_note_total=Decimal(credit_note_total),
        amount_received=Decimal(amount_received),
        withheld_total=Decimal(withheld_total),
    )
    db.add(invoice)
    await db.flush()
    await db.refresh(invoice)
    return invoice


async def test_invoice_balance_unpaid_is_the_whole_grand_total(db_session):
    # Grand Total = 12500.00 + 2250.00 = 14750.00   (APPENDIX-B:419)
    # Paid        = 0.00                            (APPENDIX-B:425)
    # Balance     = 14750.00 - 0.00 = 14750.00      (APPENDIX-B:426)
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00")
    assert invoice.grand_total == Decimal("14750.00")
    assert invoice.balance_due == Decimal("14750.00")


async def test_invoice_balance_part_paid(db_session):
    # Grand Total = 12500.00 + 2250.00 = 14750.00
    # Paid        = 6000.00
    # Balance     = 14750.00 - 6000.00 = 8750.00
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00", amount_received="6000.00")
    assert invoice.balance_due == Decimal("8750.00")


async def test_invoice_balance_exactly_paid_is_zero(db_session):
    # Paid    = 14750.00, exactly the Grand Total
    # Balance = 14750.00 - 14750.00 = 0.00 — and APPENDIX-B:431 makes this
    # the point at which Status becomes Paid and the invoice locks (:433).
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00", amount_received="14750.00")
    assert invoice.balance_due == Decimal("0.00")
    assert resolve_invoice_status_after_payment(invoice.amount_received, invoice.withheld_total, invoice.claim_amount) == "PAID"


async def test_invoice_balance_overpaid_goes_negative_which_is_why_overpayment_is_blocked_upstream(db_session):
    """APPENDIX-B:428 states the handling of an overpayment exactly: the
    Payment Amount "must not exceed Balance Due. Overpayment is blocked
    outright with the error 'Amount cannot exceed the balance due of
    Rs<balance>'." The spec therefore has no negative-balance state at all —
    it is unreachable through the API, guarded before the write at
    app/api/v1/invoices.py:735.

    What this test pins down is that the guard is genuinely load-bearing:
    the balance expression itself does NOT clamp at zero, so if that check
    were ever removed the stored balance would go negative rather than
    saturate. Hand-computed: 14750.00 - 15000.00 = -250.00.
    """
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00", amount_received="15000.00")
    assert invoice.balance_due == Decimal("-250.00")
    assert invoice.balance_due < 0, "the formula does not clamp — APPENDIX-B:428's pre-write guard is the only thing preventing this state"

    # And the guard's own predicate, on the state one step earlier: with
    # 14750.00 still outstanding, a 15000.00 payment exceeds the balance due
    # and is the case :428 rejects outright.
    balance_before = Decimal("14750.00")
    assert Decimal("15000.00") > balance_before


async def test_invoice_balance_with_an_approved_credit_note_applied(db_session):
    # APPENDIX-B:437 — an approved Credit Note reduces the EFFECTIVE
    # OUTSTANDING balance by the Credit Amount without editing the invoice.
    # Grand Total = 12500.00 + 2250.00 = 14750.00
    # Credit Note = 3750.00
    # Claim       = 14750.00 - 3750.00 = 11000.00
    # Paid        = 0.00
    # Balance     = 11000.00 - 0.00 = 11000.00
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00", credit_note_total="3750.00")
    assert invoice.grand_total == Decimal("14750.00"), "the Credit Note must NOT rewrite the original invoice's Grand Total (:437)"
    assert invoice.claim_amount == Decimal("11000.00")
    assert invoice.balance_due == Decimal("11000.00")


async def test_invoice_balance_with_a_credit_note_and_a_payment(db_session):
    # Grand Total = 14750.00; Credit Note 3750.00; Paid 4000.00
    # Balance = 14750.00 - 3750.00 - 4000.00 = 7000.00
    invoice = await _invoice(
        db_session, subtotal="12500.00", tax_amount="2250.00", credit_note_total="3750.00", amount_received="4000.00"
    )
    assert invoice.balance_due == Decimal("7000.00")


async def test_invoice_balance_when_a_credit_note_extinguishes_the_whole_claim(db_session):
    # APPENDIX-B:430 caps the Credit Amount at the Grand Total, so a full
    # 14750.00 credit is the largest legal one.
    # Balance = 14750.00 - 14750.00 - 0.00 = 0.00, with no money received —
    # a Credit Note "does NOT move money" (APPENDIX-B:438).
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00", credit_note_total="14750.00")
    assert invoice.claim_amount == Decimal("0.00")
    assert invoice.balance_due == Decimal("0.00")
    assert invoice.amount_received == Decimal("0.00"), "the balance cleared without a rupee being received"


async def test_invoice_balance_after_multiple_partial_payments(db_session):
    """APPENDIX-B:436 — "Multiple partial payments are supported against the
    same invoice; Record Payment can be opened again and again until the
    balance clears", and :425 makes Paid the SUM of every one of them.
    Grand Total = 12500.00 + 2250.00 = 14750.00.
    """
    invoice = await _invoice(db_session, subtotal="12500.00", tax_amount="2250.00")

    # payment 1: Paid = 2500.00           -> Balance = 14750.00 - 2500.00 = 12250.00
    invoice.amount_received = Decimal("2500.00")
    await db_session.flush()
    await db_session.refresh(invoice)
    assert invoice.balance_due == Decimal("12250.00")

    # payment 2: Paid = 2500.00 + 3250.00 = 5750.00  -> Balance = 14750.00 - 5750.00 = 9000.00
    invoice.amount_received = Decimal("5750.00")
    await db_session.flush()
    await db_session.refresh(invoice)
    assert invoice.balance_due == Decimal("9000.00")

    # payment 3: Paid = 5750.00 + 9000.00 = 14750.00 -> Balance = 14750.00 - 14750.00 = 0.00
    invoice.amount_received = Decimal("14750.00")
    await db_session.flush()
    await db_session.refresh(invoice)
    assert invoice.balance_due == Decimal("0.00"), "the third payment clears it exactly — no rounding drift across three partials"


async def test_invoice_balance_counts_customer_withholding_as_settled(db_session):
    # Appendix B's own worked example, mirrored from A276: a 1,00,000
    # invoice settled by a 90,000 receipt with 10,000 withheld by the
    # customer is fully settled — Balance = 100000.00 - 90000.00 - 10000.00
    # = 0.00 — even though only 90,000 ever reached the bank.
    invoice = await _invoice(db_session, subtotal="100000.00", amount_received="90000.00", withheld_total="10000.00")
    assert invoice.grand_total == Decimal("100000.00")
    assert invoice.settled_amount == Decimal("100000.00")
    assert invoice.balance_due == Decimal("0.00"), "ignoring withholding would strand this invoice at Part-Paid with a phantom 10,000 balance"


async def test_invoice_balance_keeps_money_at_exactly_two_decimals(db_session):
    # Grand Total = 55.61 + 10.01 = 65.62; Paid = 12.34
    # Balance     = 65.62 - 12.34 = 53.28
    # Numeric(14, 2) — the result must be exactly 2 decimal places, not a
    # binary-float approximation such as 53.279999999999994.
    invoice = await _invoice(db_session, subtotal="55.61", tax_amount="10.01", amount_received="12.34")
    assert invoice.grand_total == Decimal("65.62")
    assert invoice.balance_due == Decimal("53.28")
    assert isinstance(invoice.balance_due, Decimal), "money must never come back as a float"
    assert invoice.balance_due.as_tuple().exponent == -2, "money is stored and returned at exactly 2 decimal places"


async def test_invoice_balance_of_a_zero_value_invoice(db_session):
    # The degenerate document: Grand Total = 0.00 + 0.00 = 0.00, Paid 0.00
    # -> Balance = 0.00. Nothing divides by the zero total.
    invoice = await _invoice(db_session, subtotal="0.00")
    assert invoice.grand_total == Decimal("0.00")
    assert invoice.balance_due == Decimal("0.00")
