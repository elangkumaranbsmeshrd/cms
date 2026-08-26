"""Pydantic schemas for Customer (08-customer-module.md)."""

import re
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.masters import GSTIN_PATTERN

PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


class CustomerWrite(BaseModel):
    company_name: str
    display_name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    status_id: str
    source_id: str | None = None
    website: str | None = None
    notes: str | None = None
    mobile_number: str | None = None
    email: str | None = None
    address: str | None = None
    owner_id: str | None = None
    # §2.1 Directory columns (added 2026-07-31, §2.2's field table wasn't
    # updated alongside it — same class of doc/code sync gap Appendix B
    # elsewhere calls out and closes): the name a statement credit is
    # actually matched against, and its account number, secondary. Neither
    # is mandatory — a prospect who has never paid anything has neither.
    bank_account_name: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None

    @field_validator("company_name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not (2 <= len(v.strip()) <= 200):
            raise ValueError("Company Name must be 2-200 characters")
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

    @field_validator("bank_account_number")
    @classmethod
    def _validate_bank_account_number(cls, v: str | None) -> str | None:
        # Appendix B: "BANK ACCOUNT NUMBER: numeric, plausible length 9-18 digits."
        if v is not None and not re.match(r"^[0-9]{9,18}$", v):
            raise ValueError("Bank Account Number must be 9-18 digits")
        return v


class CustomerOut(CustomerWrite):
    id: str
    customer_code: str
    bank_account_name: str | None
    bank_name: str | None
    bank_account_number: str | None
    bank_account_number_masked: str | None
    # Optional with a None default (not just nullable) — this field is
    # withheld from Manager entirely (§2.1: "Collected Into ... a company
    # banking detail, not an account-relationship one"), so the key can be
    # legitimately absent from the payload after field masking, not just null.
    collected_into_bank_account_id: str | None = None
    total_invoiced: Decimal
    received: Decimal
    outstanding: Decimal
    last_activity_date: date | None
    created_by: str | None
    updated_by: str | None
    model_config = ConfigDict(from_attributes=True)


class CustomerContactWrite(BaseModel):
    name: str
    designation: str | None = None
    email: str | None = None
    phone: str | None = None
    is_primary: bool = False


class CustomerContactOut(CustomerContactWrite):
    id: str
    customer_id: str
    model_config = ConfigDict(from_attributes=True)


class CustomerActivityWrite(BaseModel):
    activity_type: str  # CALL | EMAIL | MEETING | NOTE
    activity_date: date | None = None
    description: str
    related_contact_id: str | None = None


class CustomerActivityOut(BaseModel):
    id: str
    customer_id: str
    activity_type: str
    activity_date: date
    description: str
    related_contact_id: str | None
    logged_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CustomerFileOut(BaseModel):
    id: str
    customer_id: str
    stored_file_id: str
    # §2.3's own columns are File Name/Uploaded By/Uploaded On/Size — these
    # three live on StoredFile (models/platform.py), not on CustomerFile
    # itself, and are joined in by the endpoint (asset.py's AssetFileOut is
    # the same pattern: original_filename/mime_type/size_bytes default to
    # blank/0 only if the linked StoredFile row is somehow gone).
    original_filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    created_by: str | None
    model_config = ConfigDict(from_attributes=True)
