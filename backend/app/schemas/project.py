"""Pydantic schemas for Project (10-project-module.md)."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class ProjectWrite(BaseModel):
    project_name: str
    customer_id: str
    opportunity_id: str | None = None
    status: str = "NOT_STARTED"
    start_date: date | None = None
    end_date: date | None = None
    budget: Decimal | None = None
    description: str | None = None
    project_lead_id: str
    member_ids: list[str] = []

    @field_validator("project_name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not (2 <= len(v.strip()) <= 150):
            raise ValueError("Project Name must be 2-150 characters")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ("NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"):
            raise ValueError("Invalid Status")
        return v

    @field_validator("budget")
    @classmethod
    def _validate_budget(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("Budget must be a positive number")
        return v


class ProjectOut(BaseModel):
    id: str
    project_code: str
    financial_year_id: str
    project_name: str
    customer_id: str
    opportunity_id: str | None
    status: str
    start_date: date | None
    end_date: date | None
    budget: Decimal | None
    description: str | None
    project_lead_id: str
    member_ids: list[str] = []
    created_at: datetime
    created_by: str | None
    updated_by: str | None
    model_config = ConfigDict(from_attributes=True)


class TaskSubtaskWrite(BaseModel):
    text: str


class TaskSubtaskOut(BaseModel):
    id: str
    task_id: str
    text: str
    is_checked: bool
    sequence: int
    model_config = ConfigDict(from_attributes=True)


class TaskCommentWrite(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def _validate_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Comment cannot be empty")
        return v


class TaskCommentOut(BaseModel):
    id: str
    task_id: str
    author_id: str
    content: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TaskWrite(BaseModel):
    title: str
    description: str | None = None
    assignee_id: str
    due_date: date | None = None
    status: str = "BACKLOG"
    priority: str | None = None
    sprint_id: str | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Title is required")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ("BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"):
            raise ValueError("Invalid Status")
        return v

    @field_validator("priority")
    @classmethod
    def _validate_priority(cls, v: str | None) -> str | None:
        if v is not None and v not in ("LOW", "MEDIUM", "HIGH", "URGENT"):
            raise ValueError("Invalid Priority")
        return v


class TaskStatusUpdate(BaseModel):
    """Board drag-and-drop and Task Detail's Status dropdown are 'the same
    action from two entry points' (§4) — a narrow status-only write so
    neither silently wipes sprint_id/priority/due_date the way a full-replace
    PUT would if the caller only meant to move a card.
    """
    status: str

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ("BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"):
            raise ValueError("Invalid Status")
        return v


class TaskOut(BaseModel):
    id: str
    project_id: str
    title: str
    description: str | None
    assignee_id: str
    due_date: date | None
    status: str
    priority: str | None
    sprint_id: str | None
    subtasks: list[TaskSubtaskOut] = []
    comments: list[TaskCommentOut] = []
    created_at: datetime
    created_by: str | None
    updated_by: str | None
    model_config = ConfigDict(from_attributes=True)


class SprintWrite(BaseModel):
    name: str
    start_date: date
    end_date: date

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name is required")
        return v


class SprintOut(BaseModel):
    id: str
    project_id: str
    name: str
    start_date: date
    end_date: date
    status: str
    model_config = ConfigDict(from_attributes=True)


class BugCommentWrite(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def _validate_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Comment cannot be empty")
        return v


class BugCommentOut(BaseModel):
    id: str
    bug_id: str
    author_id: str
    content: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class BugWrite(BaseModel):
    title: str
    description: str | None = None
    severity: str
    status: str = "OPEN"
    assignee_id: str | None = None
    due_date: date | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Title is required")
        return v

    @field_validator("severity")
    @classmethod
    def _validate_severity(cls, v: str) -> str:
        if v not in ("LOW", "MEDIUM", "HIGH", "CRITICAL"):
            raise ValueError("Invalid Severity")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ("OPEN", "IN_PROGRESS", "FIXED", "CLOSED"):
            raise ValueError("Invalid Status")
        return v


class BugOut(BaseModel):
    id: str
    project_id: str
    title: str
    description: str | None
    severity: str
    status: str
    assignee_id: str | None
    due_date: date | None
    reported_by: str
    comments: list[BugCommentOut] = []
    created_at: datetime
    created_by: str | None
    updated_by: str | None
    model_config = ConfigDict(from_attributes=True)


class MilestoneWrite(BaseModel):
    milestone_name: str
    target_date: date
    description: str | None = None
    status: str = "UPCOMING"
    linked_task_ids: list[str] = []

    @field_validator("milestone_name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Milestone Name is required")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ("UPCOMING", "REACHED", "MISSED"):
            raise ValueError("Invalid Status")
        return v


class MilestoneOut(BaseModel):
    id: str
    project_id: str
    milestone_name: str
    target_date: date
    description: str | None
    status: str
    linked_task_ids: list[str] = []
    tasks_done: int | None = None
    tasks_total: int | None = None
    model_config = ConfigDict(from_attributes=True)


class TimesheetEntryWrite(BaseModel):
    entry_date: date
    task_id: str | None = None
    category: str | None = None
    hours: Decimal
    notes: str | None = None
    # §2.8/Appendix B: Draft -> Submitted -> Approved. Defaults to logging
    # directly as Submitted (a Draft may also be confirmed directly without
    # ever being saved as Draft, same pattern as Payroll's own Draft state).
    save_as_draft: bool = False

    @field_validator("hours")
    @classmethod
    def _validate_hours(cls, v: Decimal) -> Decimal:
        if not (0 < v <= 24):
            raise ValueError("Hours must be positive and no more than 24 per entry")
        return v

    @field_validator("category")
    @classmethod
    def _validate_category(cls, v: str | None) -> str | None:
        if v is not None and v not in ("BENCH", "INTERNAL_MEETING", "TRAINING", "ADMIN_OVERHEAD", "OTHER"):
            raise ValueError("Invalid Category")
        return v


class TimesheetEntryOut(BaseModel):
    id: str
    project_id: str
    employee_id: str
    entry_date: date
    task_id: str | None
    category: str | None
    hours: Decimal
    notes: str | None
    status: str
    submitted_at: datetime | None
    approved_by: str | None
    approved_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class TimesheetBulkApproveWrite(BaseModel):
    entry_ids: list[str]

    @field_validator("entry_ids")
    @classmethod
    def _validate_entry_ids(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("Select at least one entry to approve")
        return v


class TimesheetBulkApproveResult(BaseModel):
    approved: list[TimesheetEntryOut]
    skipped: list[str]
