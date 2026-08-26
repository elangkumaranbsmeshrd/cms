from datetime import date, datetime

from pydantic import BaseModel


class FinancialYearOut(BaseModel):
    id: str
    label: str
    start_date: date
    end_date: date
    status: str
    is_current: bool
    # Real columns (models/numbering.py), stamped by lock_financial_year but
    # previously dropped here — the API had no way to answer "who locked this
    # and when" even though the database always knew. locked_by_name (not the
    # raw id) since there is no /users endpoint for a client to resolve it.
    locked_at: datetime | None = None
    locked_by_name: str | None = None

    class Config:
        from_attributes = True


class FinancialYearCreate(BaseModel):
    start_date: date
    # MASTER-BUILD-PROMPT.md §4.1, explicit product decision reversing the
    # earlier "End Date is always derived, never typed" reading of §3.1: "a
    # company's financial year is not guaranteed to be exactly one year minus
    # a day from its start, and hardcoding that arithmetic is precisely the
    # class of assumption that must not exist. Derive a default End Date as a
    # convenience, then let it be overridden." Optional — the route computes
    # the same start+1y-1d default as before when this is omitted, so every
    # existing caller that never sends it keeps working unchanged.
    end_date: date | None = None


class FinancialYearUpdate(BaseModel):
    # §4.1: "add PUT .../{id}... make Start Date editable... make End Date an
    # entered field." Both editable post-creation now, gated at the route
    # level on the year still being 'open' — Invariant 4's freeze applies
    # here exactly as it applies to every other write once a year is locked.
    # Both required (not partial-update-optional): the edit form always loads
    # and resubmits the whole record, so there is no real "leave unspecified"
    # case to support, and requiring both avoids a null accidentally clearing
    # a real date.
    start_date: date
    end_date: date
