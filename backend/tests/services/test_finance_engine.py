from datetime import date
from decimal import Decimal

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
