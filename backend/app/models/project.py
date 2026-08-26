"""Project (10-project-module.md) — Phase 5. 10 tables, the biggest single
module in this phase: Project, Team Members, Task Board, Sprints, Bugs,
Milestones, Timesheets.

task_comments/bug_comments are genuinely append-only threads (§2.4/§2.6,
verbatim: "never deleted or edited once posted, only added to") — modeled
with the same reduced column set as PermissionChangeLog (id/fk/author/
content/created_at, no AuditMixin), not the full mutable shape.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin, _now


class Project(Base, AuditMixin):
    __tablename__ = "projects"

    project_code: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    project_name: Mapped[str] = mapped_column(String(150), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    opportunity_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("opportunities.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="NOT_STARTED")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    budget: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)


class ProjectMember(Base):
    __tablename__ = "project_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class Sprint(Base, AuditMixin):
    __tablename__ = "sprints"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE")


class Task(Base, AuditMixin):
    __tablename__ = "tasks"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="BACKLOG")
    priority: Mapped[str | None] = mapped_column(String(10), nullable=True)
    sprint_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sprints.id"), nullable=True)


class TaskComment(Base):
    __tablename__ = "task_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class TaskSubtask(Base, AuditMixin):
    __tablename__ = "task_subtasks"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    text: Mapped[str] = mapped_column(String(255), nullable=False)
    is_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)


class Bug(Base, AuditMixin):
    __tablename__ = "bugs"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="OPEN")
    assignee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reported_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)


class BugComment(Base):
    __tablename__ = "bug_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    bug_id: Mapped[str] = mapped_column(String(36), ForeignKey("bugs.id"), nullable=False)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class Milestone(Base, AuditMixin):
    __tablename__ = "milestones"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    milestone_name: Mapped[str] = mapped_column(String(150), nullable=False)
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="UPCOMING")


class MilestoneTask(Base):
    __tablename__ = "milestone_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    milestone_id: Mapped[str] = mapped_column(String(36), ForeignKey("milestones.id"), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class TimesheetEntry(Base, AuditMixin):
    __tablename__ = "timesheet_entries"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=True)
    category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hours: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="SUBMITTED")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
