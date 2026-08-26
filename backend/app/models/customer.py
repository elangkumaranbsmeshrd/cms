"""Customer module (08-customer-module.md), pulled forward from Phase 5
(Operations) into Phase 4 because Invoice/Credit Note need a real `customers`
FK target — see alembic/versions/0005_finance.py's docstring for the full
account of why. 4 tables.

Every real MySQL `GENERATED ALWAYS AS ... STORED` column is wrapped in
Computed() here, never a plain mapped_column — the Phase 2 bug class
(MySQL error 3105 on any INSERT/UPDATE that supplies a value for one).
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Computed, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class Customer(Base, AuditMixin):
    __tablename__ = "customers"

    customer_code: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True)
    status_id: Mapped[str] = mapped_column(String(36), ForeignKey("customer_statuses.id"), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("customer_sources.id"), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    mobile_number: Mapped[str | None] = mapped_column(String(10), nullable=True)
    email: Mapped[str | None] = mapped_column(String(191), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    bank_account_name: Mapped[str | None] = mapped_column(String(191), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(191), nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(String(34), nullable=True)
    bank_account_number_masked: Mapped[str | None] = mapped_column(
        String(50), Computed("CASE WHEN bank_account_number IS NULL THEN NULL ELSE CONCAT(COALESCE(bank_name, ''), ' ••••', SUBSTR(bank_account_number, -4)) END"), nullable=True
    )
    collected_into_bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    total_invoiced: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    received: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    outstanding: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("total_invoiced - received"), nullable=False)
    # §2.1's deferred "Last Activity date range" filter — a plain rollup,
    # API-written on every POST /customers/{id}/activities (same pattern as
    # total_invoiced/received above: a stored column kept current by the
    # module that owns the writes, not summed live on read). A Date, not a
    # DateTime — matches CustomerActivity.activity_date, and is set to
    # max(current value, the new activity's date) so a backdated activity
    # added after a more recent one can never move this backwards.
    last_activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class CustomerContact(Base, AuditMixin):
    __tablename__ = "customer_contacts"

    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(191), nullable=False)
    designation: Mapped[str | None] = mapped_column(String(191), nullable=True)
    email: Mapped[str | None] = mapped_column(String(191), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    primary_guard: Mapped[str | None] = mapped_column(String(36), Computed("IF(is_primary = 1, customer_id, NULL)"), nullable=True)


class CustomerActivity(Base, AuditMixin):
    __tablename__ = "customer_activities"

    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(10), nullable=False)
    activity_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    related_contact_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("customer_contacts.id"), nullable=True)
    logged_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)


class CustomerFile(Base, AuditMixin):
    __tablename__ = "customer_files"

    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    stored_file_id: Mapped[str] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=False)
