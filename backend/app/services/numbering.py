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
from sqlalchemy import func, select
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

    # APPENDIX-B:47 — "when Resets Every FY = Yes, the running number restarts
    # at the Starting Number on the FIRST record created in each new financial
    # year." The restart is CONDITIONAL on the flag, and this used to key the
    # sequence on financial_year_id unconditionally, so every code type
    # restarted every year no matter how the flag was set. Setting it to No in
    # Masters did nothing at all, and FY2027 reissued INV-...-00001 — a
    # duplicate running number inside what is meant to be one continuous
    # series. Keying on NULL instead gives the single unbroken sequence the
    # flag promises; callers still pass the real FY, since fy_label is a
    # separate concern (include_fy_in_code decides whether it is rendered).
    sequence_fy_id = financial_year_id if rule.resets_every_fy else None

    seq = (
        await db.execute(
            select(DocumentNumberSequence)
            .where(DocumentNumberSequence.code_type == code_type, DocumentNumberSequence.financial_year_id == sequence_fy_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if seq is None:
        start_at = rule.starting_number
        if not rule.resets_every_fy:
            # Switching a code type from resetting to continuous must not
            # re-issue numbers already printed on real documents. Per-FY rows
            # from the old behaviour still exist, so the new unbroken series
            # begins above the highest number any of them reached rather than
            # back at the Starting Number.
            highest = (
                await db.execute(
                    select(func.max(DocumentNumberSequence.next_number)).where(
                        DocumentNumberSequence.code_type == code_type
                    )
                )
            ).scalar_one_or_none()
            if highest is not None and highest > start_at:
                start_at = highest

        seq = DocumentNumberSequence(
            id=str(uuid.uuid4()),
            code_type=code_type,
            financial_year_id=sequence_fy_id,
            prefix=rule.prefix,
            digits=rule.running_number_digits,
            next_number=start_at,
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
