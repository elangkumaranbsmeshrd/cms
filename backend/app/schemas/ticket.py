"""Pydantic schemas for Ticket (04-ticket-module.md)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, field_validator


class TicketWrite(BaseModel):
    customer_id: str
    category_id: str | None = None
    subject: str
    priority: str = "MEDIUM"
    description: str
    assigned_to: str | None = None
    linked_project_id: str | None = None
    due_date: date | None = None

    @field_validator("subject")
    @classmethod
    def _validate_subject(cls, v: str) -> str:
        if not (5 <= len(v.strip()) <= 150):
            raise ValueError("Subject must be 5-150 characters")
        return v

    @field_validator("priority")
    @classmethod
    def _validate_priority(cls, v: str) -> str:
        if v not in ("LOW", "MEDIUM", "HIGH", "URGENT"):
            raise ValueError("Invalid Priority")
        return v

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Description is required")
        return v


class TicketOut(BaseModel):
    id: str
    ticket_number: str
    financial_year_id: str
    customer_id: str
    category_id: str | None
    subject: str
    priority: str
    description: str
    assigned_to: str | None
    linked_project_id: str | None
    status: str
    raised_by: str
    raised_date: date
    due_date: date | None
    first_response_at: datetime | None
    resolved_at: datetime | None
    closed_at: datetime | None
    satisfaction_rating: int | None
    created_by: str | None
    updated_by: str | None
    first_response_duration: str | None = None
    resolve_duration: str | None = None
    model_config = ConfigDict(from_attributes=True)


class TicketEntryWrite(BaseModel):
    entry_type: str = "PUBLIC_REPLY"
    content: str
    attachment_stored_file_id: str | None = None

    @field_validator("entry_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ("PUBLIC_REPLY", "INTERNAL_NOTE"):
            raise ValueError("Invalid Entry Type")
        return v

    @field_validator("content")
    @classmethod
    def _validate_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Content is required")
        return v


class TicketEntryOut(BaseModel):
    id: str
    ticket_id: str
    entry_type: str
    content: str
    author_id: str
    attachment_stored_file_id: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TicketStatusUpdate(BaseModel):
    status: str
    satisfaction_rating: int | None = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"):
            raise ValueError("Invalid Status")
        return v

    @field_validator("satisfaction_rating")
    @classmethod
    def _validate_rating(cls, v: int | None) -> int | None:
        if v is not None and not (1 <= v <= 5):
            raise ValueError("Satisfaction Rating must be 1-5")
        return v


class TicketReassignRequest(BaseModel):
    new_assignee_id: str
    note: str | None = None


class TicketAssignmentHistoryOut(BaseModel):
    id: str
    ticket_id: str
    previous_assignee_id: str | None
    new_assignee_id: str
    changed_by: str
    changed_at: datetime
    note: str | None
    model_config = ConfigDict(from_attributes=True)
