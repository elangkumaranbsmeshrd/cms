"""Pydantic schemas for Asset Management (03-asset-management-module.md)."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class AssetWrite(BaseModel):
    name: str
    category_id: str
    serial_number: str | None = None
    order_date: date | None = None
    purchase_date: date
    purchase_value: Decimal | None = None
    useful_life_years: int | None = None
    vendor_id: str | None = None
    warranty_expiry: date | None = None
    location_address_id: str | None = None
    department_id: str | None = None
    depreciation_method: str = "STRAIGHT_LINE"
    notes: str | None = None
    assigned_to: str | None = None  # settable at creation only, per §2.2

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not (2 <= len(v.strip()) <= 100):
            raise ValueError("Asset Name must be 2-100 characters")
        return v

    @field_validator("purchase_value")
    @classmethod
    def _validate_purchase_value(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("Purchase Value must be a positive number")
        return v

    @field_validator("useful_life_years")
    @classmethod
    def _validate_useful_life(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("Useful Life must be a positive number")
        return v


class AssetOut(BaseModel):
    id: str
    asset_tag: str
    financial_year_id: str
    name: str
    category_id: str
    serial_number: str | None
    order_date: date | None
    purchase_date: date
    purchase_value: Decimal | None = None
    useful_life_years: int | None
    vendor_id: str | None
    warranty_expiry: date | None
    location_address_id: str | None
    department_id: str | None
    status: str
    assigned_to: str | None
    depreciation_method: str
    notes: str | None
    retired_date: date | None
    retirement_reason: str | None
    current_value: Decimal | str | None = None
    value_as_of_fy_label: str | None = None
    model_config = ConfigDict(from_attributes=True)


class AssetAssignmentHistoryOut(BaseModel):
    id: str
    asset_id: str
    employee_id: str
    from_date: date
    to_date: date | None
    action: str
    performed_by: str
    reason: str | None
    model_config = ConfigDict(from_attributes=True)


class AssetAssignRequest(BaseModel):
    employee_id: str
    effective_date: date | None = None


class AssetTransferRequest(BaseModel):
    employee_id: str
    effective_date: date | None = None
    reason: str

    @field_validator("reason")
    @classmethod
    def _validate_reason(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("A reason is required to transfer an asset")
        return v


class AssetLocationWrite(BaseModel):
    """§6.1: Assignment & Location fields are edited only through this
    2.3-family action (Super Admin directly, HR "via Assign/Transfer/
    Unassign only") — never through the general Details-tab edit action,
    which Accountant also holds and must not be able to use to relocate
    an asset.
    """
    location_address_id: str | None = None
    department_id: str | None = None


class AssetMaintenanceWrite(BaseModel):
    log_date: date
    description: str
    cost: Decimal | None = None
    next_due_date: date | None = None
    serviced_by_vendor_id: str | None = None

    @field_validator("log_date")
    @classmethod
    def _validate_log_date(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("Date cannot be in the future")
        return v

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Description is required")
        return v

    @field_validator("cost")
    @classmethod
    def _validate_cost(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("Cost must be a positive number")
        return v


class AssetMaintenanceOut(BaseModel):
    id: str
    asset_id: str
    log_date: date
    description: str
    cost: Decimal | None
    next_due_date: date | None
    serviced_by_vendor_id: str | None
    is_system_generated: bool
    source_request_id: str | None
    # Derived from Next Due Date against today's date (§2.4) — never stored,
    # computed the same way Current Value is (asset_engine-style live calc).
    maintenance_status: str | None = None
    model_config = ConfigDict(from_attributes=True)


class AssetRequestWrite(BaseModel):
    asset_id: str
    request_type: str
    description: str
    photo_stored_file_id: str | None = None

    @field_validator("request_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ("REPAIR", "DAMAGE_REPORT", "RETURN"):
            raise ValueError("Invalid Request Type")
        return v

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Description is required")
        return v


class AssetRequestOut(BaseModel):
    id: str
    asset_id: str
    employee_id: str
    request_type: str
    description: str
    photo_stored_file_id: str | None
    status: str
    approved_by: str | None
    approved_at: datetime | None
    rejection_reason: str | None
    model_config = ConfigDict(from_attributes=True)


class AssetRequestRejectRequest(BaseModel):
    rejection_reason: str

    @field_validator("rejection_reason")
    @classmethod
    def _validate_reason(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("A reason is required to reject a request")
        return v


class AssetReclaimMarkReturnedRequest(BaseModel):
    working_condition: bool
    reason: str | None = None

    @model_validator(mode="after")
    def _validate_reason_required_if_damaged(self) -> "AssetReclaimMarkReturnedRequest":
        # A plain @field_validator on `reason` would NOT fire here — Pydantic
        # v2 skips field validators for a field left at its default (never
        # provided in the payload) unless validate_default=True is set. A
        # model-level "after" validator always runs regardless, which is
        # what a required-together-with-another-field rule actually needs.
        if self.working_condition is False and not (self.reason and self.reason.strip()):
            raise ValueError("A reason is required when marking an asset Not Working / Damaged")
        return self


class AssetFileCreate(BaseModel):
    # The file itself is already uploaded via the shared POST /files
    # endpoint (purpose asset_photo|asset_file, files.py) before this call —
    # same two-step pattern as DocumentUpload (schemas/employee.py).
    stored_file_id: str


class AssetFileOut(BaseModel):
    id: str
    asset_id: str
    stored_file_id: str
    original_filename: str
    mime_type: str
    size_bytes: int
    created_by: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
