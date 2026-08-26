"""Pydantic schemas for Opportunity (09-opportunity-module.md)."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class OpportunityWrite(BaseModel):
    title: str
    customer_id: str
    value: Decimal | None = None
    stage: str = "PROSPECTING"
    probability_pct: Decimal | None = None
    expected_close_date: date | None = None
    description: str | None = None
    owner_id: str | None = None
    lost_reason: str | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Title is required")
        return v

    @field_validator("value")
    @classmethod
    def _validate_value(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("Value must be a positive number")
        return v

    @field_validator("stage")
    @classmethod
    def _validate_stage(cls, v: str) -> str:
        if v not in ("PROSPECTING", "QUALIFYING", "PROPOSAL", "WON", "LOST"):
            raise ValueError("Invalid Stage")
        return v

    @field_validator("probability_pct")
    @classmethod
    def _validate_probability(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and not (0 <= v <= 100):
            raise ValueError("Probability must be between 0 and 100")
        return v


class OpportunityOut(OpportunityWrite):
    id: str
    opportunity_code: str
    financial_year_id: str
    last_activity_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class OpportunityActivityWrite(BaseModel):
    activity_type: str
    activity_date: date | None = None
    description: str
    related_contact_id: str | None = None

    @field_validator("activity_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ("CALL", "EMAIL", "MEETING", "NOTE"):
            raise ValueError("Invalid Activity Type")
        return v

    @field_validator("description")
    @classmethod
    def _validate_desc(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Description is required")
        return v


class OpportunityActivityOut(BaseModel):
    id: str
    opportunity_id: str
    activity_type: str
    activity_date: date
    description: str
    related_contact_id: str | None
    logged_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class OpportunityFileOut(BaseModel):
    id: str
    opportunity_id: str
    stored_file_id: str
    # File Name/Type/Size live on StoredFile, joined in by the endpoint
    # (opportunities.py's _load_opportunity_file_out) — same fields
    # CustomerFileOut/AssetFileOut already carry.
    original_filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    created_by: str | None
    model_config = ConfigDict(from_attributes=True)
