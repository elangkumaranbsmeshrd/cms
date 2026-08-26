"""Pydantic schemas for Vendor (07-vendor-module.md)."""

import re
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.masters import GSTIN_PATTERN

PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


class VendorWrite(BaseModel):
    vendor_name: str
    vendor_category: str | None = None
    gstin: str | None = None
    pan: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    payment_terms_days: int | None = None  # A257: defaults to 30 if blank
    address_street: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_pin_code: str | None = None
    bank_account_name: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    ifsc_code: str | None = None

    @field_validator("vendor_name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not (2 <= len(v.strip()) <= 150):
            raise ValueError("Vendor Name must be 2-150 characters")
        return v

    @field_validator("gstin")
    @classmethod
    def _validate_gstin(cls, v: str | None) -> str | None:
        # §2.2: "auto-uppercased" — normalize before pattern-matching, not after.
        if v is not None:
            v = v.upper()
        if v is not None and not GSTIN_PATTERN.match(v):
            raise ValueError("Invalid GSTIN format")
        return v

    @field_validator("pan")
    @classmethod
    def _validate_pan(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.upper()
        if v is not None and not PAN_PATTERN.match(v):
            raise ValueError("Invalid PAN format")
        return v

    @field_validator("contact_phone")
    @classmethod
    def _validate_phone(cls, v: str | None) -> str | None:
        if v is not None and not re.match(r"^[6-9][0-9]{9}$", v):
            raise ValueError("Contact Phone must be a 10-digit Indian mobile number")
        return v

    @field_validator("payment_terms_days")
    @classmethod
    def _validate_payment_terms(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("Payment Terms (Days) must be positive")
        return v

    @field_validator("address_pin_code")
    @classmethod
    def _validate_pin(cls, v: str | None) -> str | None:
        if v is not None and not re.match(r"^[0-9]{6}$", v):
            raise ValueError("PIN Code must be exactly 6 digits")
        return v

    @field_validator("bank_account_number")
    @classmethod
    def _validate_bank_account_number(cls, v: str | None) -> str | None:
        # Appendix B: "BANK ACCOUNT NUMBER: numeric, plausible length 9-18 digits."
        if v is not None and not re.match(r"^[0-9]{9,18}$", v):
            raise ValueError("Bank Account Number must be 9-18 digits")
        return v

    @field_validator("ifsc_code")
    @classmethod
    def _validate_ifsc(cls, v: str | None) -> str | None:
        if v is not None and not IFSC_PATTERN.match(v):
            raise ValueError("Invalid IFSC format")
        return v


class VendorOut(VendorWrite):
    id: str
    payment_terms_days: int
    bank_account_number_masked: str | None
    has_bank_details: bool
    is_active: bool
    approval_status: str  # approved | pending_approval — §6.1, never client-set (absent from VendorWrite)
    purchase_bill_count: int
    expense_count: int
    has_usage_history: bool
    outstanding_amount: Decimal
    total_spend: Decimal
    model_config = ConfigDict(from_attributes=True)


class VendorUsageRow(BaseModel):
    type: str  # PURCHASE_BILL | EXPENSE
    reference_number: str
    date: str
    amount: Decimal
    mode: str | None = None
    # Optional with a None default (not just nullable) — the three banking
    # columns are masked away entirely for a Manager lacking edit_banking
    # (§2.3: "not the banking columns... Accountant and Super Admin only"),
    # so the key can legitimately be absent from the payload, not just null.
    paid_from: str | None = None
    paid_into: str | None = None
    account_number_masked: str | None = None
    status: str
