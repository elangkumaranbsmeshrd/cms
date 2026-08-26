"""Document number allocation (Masters §3.6e / ARCH-1 D6/D7): every rendered
code — Employee Code, Offer/Appointment/Acceptance Letter Number,
Compensatory Hour Request Number — comes from here rather than an
AUTO_INCREMENT, because a code type can reset per financial year and its
Starting Number becomes immutable once anything has been generated (Masters
§3.6e). Concurrency-safe via SELECT ... FOR UPDATE inside the caller's own
transaction, matching ARCH-1's own stated design for document_number_sequences.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.masters import NumberPrefixRule
from app.models.numbering import DocumentNumberSequence, FinancialYear


async def get_current_financial_year(db: AsyncSession) -> FinancialYear:
    """The one FY flagged is_current=True (Masters §3.1) — every Phase 2
    record that snapshots a financial_year_id at creation time (Employee,
    Resignation, Salary Structure, Attendance, ...) resolves it from here
    rather than each router re-deriving "today's FY" its own way.
    """
    fy = (await db.execute(select(FinancialYear).where(FinancialYear.is_current.is_(True)))).scalar_one_or_none()
    if fy is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No Financial Year is marked current — Super Admin must set one in Masters first")
    return fy


async def allocate_number(db: AsyncSession, code_type: str, financial_year_id: str | None, fy_label: str | None) -> str:
    rule = (
        await db.execute(select(NumberPrefixRule).where(NumberPrefixRule.code_type == code_type).with_for_update())
    ).scalar_one_or_none()
    if rule is None:
        # HTTPException, not a bare ValueError: found by the Phase 2 audit
        # surfacing as an unhandled 500 on every call site (create_employee,
        # create_offer_letter, request_compensatory_hours) instead of a
        # clean 4xx — none of them caught ValueError, only DBAPIError.
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"No Number Prefix Rule configured for code type '{code_type}' — Super Admin must add one in Masters first")

    seq = (
        await db.execute(
            select(DocumentNumberSequence)
            .where(DocumentNumberSequence.code_type == code_type, DocumentNumberSequence.financial_year_id == financial_year_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if seq is None:
        seq = DocumentNumberSequence(
            id=str(uuid.uuid4()),
            code_type=code_type,
            financial_year_id=financial_year_id,
            prefix=rule.prefix,
            digits=rule.running_number_digits,
            next_number=rule.starting_number,
        )
        db.add(seq)
        await db.flush()

    running_number = seq.next_number
    rendered = str(running_number).zfill(rule.running_number_digits)
    code = f"{rule.prefix}-{fy_label}-{rendered}" if rule.include_fy_in_code and fy_label else f"{rule.prefix}-{rendered}"

    seq.next_number += 1
    from datetime import datetime, timezone

    seq.last_issued_number = running_number
    seq.last_issued_at = datetime.now(timezone.utc)

    if not rule.starting_number_locked:
        rule.starting_number_locked = True
        rule.first_generated_at = datetime.now(timezone.utc)
    rule.generated_count += 1

    return code
