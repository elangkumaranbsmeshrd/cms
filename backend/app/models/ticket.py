"""Ticket (04-ticket-module.md) — Phase 5. 3 tables.

ticket_entries (the conversation thread) and ticket_assignment_history are
both append-only logs — reduced column set, same reasoning as
task_comments/bug_comments in app/models/project.py.
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin, _now


class Ticket(Base, AuditMixin):
    __tablename__ = "tickets"

    ticket_number: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    category_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("ticket_categories.id"), nullable=True)
    subject: Mapped[str] = mapped_column(String(150), nullable=False)
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="MEDIUM")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    assigned_to: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    linked_project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="OPEN")
    raised_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    raised_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    satisfaction_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TicketEntry(Base):
    __tablename__ = "ticket_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(36), ForeignKey("tickets.id"), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(15), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    attachment_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class TicketAssignmentHistory(Base):
    __tablename__ = "ticket_assignment_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(36), ForeignKey("tickets.id"), nullable=False)
    previous_assignee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    new_assignee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    changed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
