"""Layer 1 (COMPLETE-TEST-PROMPT §Layer 1) for app/services/numbering.py —
NUMBER PREFIX GENERATION. There was no test file for this module at all
before this one; every expected value below is hand-computed from
build-docs/APPENDIX-B-business-rules.md and shown as arithmetic in a comment
above its assertion, never read back off the code.

The spec rules under test:
  APPENDIX-B:45  NUMBERING FORMAT: {PREFIX}-{FY_LABEL}-{RUNNING_NUMBER}.
                 Prefix 2-6 UPPERCASE letters, no spaces. Digits 3 to 6.
  APPENDIX-B:46  STARTING NUMBER IMMUTABILITY: cannot change once any code of
                 that type has been generated.
  APPENDIX-B:47  FY RESET BEHAVIOUR: when Resets Every FY = Yes, the running
                 number restarts at the Starting Number on the FIRST record
                 created in each new financial year.
  APPENDIX-B:48  NUMBERING CHANGES ARE FORWARD-ONLY: changing a code type
                 that has already generated records affects only new records.
  and the per-module formats: :414 INV-2026-00001 (5 digits), :415
  CN-2026-0001, :89 EMP-2026-0001, :262 AST-2026-0001, :366 PRJ-<FY>-0000,
  :508 TKT-2026-0001, :544 CUST-2026-0001.

DIVISION AUDIT: numbering.py performs NO division — allocation is a read,
a +1, and a str.zfill(). There is no divide-by-zero surface. The degenerate
width case it does have (a running number that outgrows its digit width) is
covered by test_a_running_number_that_outgrows_its_digit_width_widens.

WHY THE DB, AND WHICH DB: numbering.py is not a pure function — it reads and
mutates number_prefix_rules and document_number_sequences. These tests use
the throwaway in-memory SQLite `db_session` fixture from tests/conftest.py
(the same one tests/rbac/test_matrix.py uses), so no dev-database counter is
ever advanced and no allocated code can collide with a real document.

CONCURRENCY, STATED PLAINLY: the allocator's safety comes entirely from
`SELECT ... FOR UPDATE` (numbering.py's own docstring), and SQLAlchemy's
SQLite dialect SILENTLY DROPS that clause — it compiles to a bare SELECT.
The SQLite schema is also weaker than production: migration 0001 gives
document_number_sequences a `UNIQUE KEY ux_docseq_type_fy (code_type,
financial_year_id)`, but the SQLAlchemy model does not declare it, so
Base.metadata.create_all() omits it and duplicate sequence rows are possible
here that MySQL would reject outright. A green "asyncio.gather produced no
duplicates" test on SQLite would therefore prove nothing about MySQL, and a
red one would be blaming the code for the harness. So this file does not
pretend otherwise. It tests the two things it honestly can:
  1. that the row lock is really emitted — the statements numbering.py itself
     builds are captured and compiled against the MySQL dialect, so deleting
     .with_for_update() breaks the test (test_both_reads_take_a_row_lock);
  2. that concurrent allocation genuinely races once that lock is absent, so
     the lock is load-bearing rather than decorative
     (test_concurrent_allocation_cannot_be_proven_safe_on_sqlite).
A true "N concurrent allocations produce N distinct numbers" proof needs a
live MySQL 8.4 with real InnoDB row locks; it belongs in an integration test
against the container, not here.
"""

import asyncio
import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.dialects import mysql
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.masters import NumberPrefixRule
from app.models.numbering import DocumentNumberSequence, FinancialYear
from app.services.numbering import allocate_number, get_current_financial_year


async def _fy(db, label: str, *, start: date, end: date, is_current: bool = False) -> FinancialYear:
    row = FinancialYear(id=str(uuid.uuid4()), label=label, start_date=start, end_date=end, is_current=is_current)
    db.add(row)
    await db.flush()
    return row


async def _fy_2026(db, **kw) -> FinancialYear:
    return await _fy(db, "2026", start=date(2026, 4, 1), end=date(2027, 3, 31), **kw)


async def _fy_2027(db, **kw) -> FinancialYear:
    return await _fy(db, "2027", start=date(2027, 4, 1), end=date(2028, 3, 31), **kw)


async def _rule(
    db,
    *,
    code_type: str = "INV",
    label: str = "Invoice Number",
    prefix: str = "INV",
    digits: int = 5,
    starting_number: int = 1,
    include_fy_in_code: bool = True,
    resets_every_fy: bool = True,
) -> NumberPrefixRule:
    row = NumberPrefixRule(
        id=str(uuid.uuid4()),
        code_type=code_type,
        label=label,
        prefix=prefix,
        include_fy_in_code=include_fy_in_code,
        running_number_digits=digits,
        starting_number=starting_number,
        resets_every_fy=resets_every_fy,
    )
    db.add(row)
    await db.flush()
    return row


# ============================================================ FORMAT ASSEMBLY
async def test_format_is_prefix_dash_fy_dash_zero_padded_running_number(db_session):
    # APPENDIX-B:45 {PREFIX}-{FY_LABEL}-{RUNNING_NUMBER}, and :414's own
    # worked example for the Invoice series "with 5 digits specifically":
    #   prefix "INV" + FY label "2026" + starting number 1 padded to 5
    #   -> "INV" + "-" + "2026" + "-" + "00001" = "INV-2026-00001"
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)

    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "INV-2026-00001"


async def test_four_digit_series_pads_to_four(db_session):
    # APPENDIX-B:89 "EMP-<Financial Year>-<4-digit running number>, e.g.
    # EMP-2026-0001": 1 padded to 4 digits is "0001" -> "EMP-2026-0001".
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="EMP", label="Employee Code", prefix="EMP", digits=4, starting_number=1)

    assert await allocate_number(db_session, "EMP", fy.id, fy.label) == "EMP-2026-0001"


async def test_credit_note_is_its_own_four_digit_series(db_session):
    """APPENDIX-B:415 — "CN-<Financial Year>-<4-digit number>, e.g.
    CN-2026-0001. A separate series - never reuses the Invoice Number
    series." Allocating an Invoice number first must not advance the Credit
    Note series: INV takes 00001, CN still starts at its own 0001.
    """
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)
    await _rule(db_session, code_type="CN", label="Credit Note Number", prefix="CN", digits=4, starting_number=1)

    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "INV-2026-00001"
    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "INV-2026-00002"
    # CN's own series is untouched by the two invoices above.
    assert await allocate_number(db_session, "CN", fy.id, fy.label) == "CN-2026-0001"


async def test_minimum_and_maximum_digit_widths(db_session):
    # APPENDIX-B:45 "Digits between 3 and 6" — both ends of the legal range.
    # 1 padded to 3 = "001"; 1 padded to 6 = "000001".
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="PB", label="Purchase Bill Number", prefix="PB", digits=3, starting_number=1)
    await _rule(db_session, code_type="AST", label="Asset Code", prefix="AST", digits=6, starting_number=1)

    assert await allocate_number(db_session, "PB", fy.id, fy.label) == "PB-2026-001"
    assert await allocate_number(db_session, "AST", fy.id, fy.label) == "AST-2026-000001"


async def test_six_letter_prefix_is_carried_through_verbatim(db_session):
    # APPENDIX-B:45 "Prefix 2-6 UPPERCASE letters, no spaces" — the longest
    # legal prefix. "CUSTOM" + "-2026-" + "0001".
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="CUST", label="Customer Code", prefix="CUSTOM", digits=4, starting_number=1)

    assert await allocate_number(db_session, "CUST", fy.id, fy.label) == "CUSTOM-2026-0001"


async def test_financial_year_segment_is_omitted_when_the_rule_says_so(db_session):
    """`include_fy_in_code` is a real Masters field (Company Profile §3.6e,
    number_prefix_rules.include_fy_in_code). With it off, the FY segment of
    APPENDIX-B:45's format drops out and the code is {PREFIX}-{RUNNING},
    i.e. "INV" + "-" + "00001" = "INV-00001" — one hyphen, not two, and no
    empty segment left behind.
    """
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1, include_fy_in_code=False)

    code = await allocate_number(db_session, "INV", fy.id, fy.label)
    assert code == "INV-00001"
    assert code.count("-") == 1, "no empty FY segment may be left in the code"


async def test_financial_year_segment_is_omitted_when_no_label_is_supplied(db_session):
    # Same shape from the other direction: the rule wants the FY in the code
    # but the caller has no label to give. "INV" + "-" + "00001".
    await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1, include_fy_in_code=True)

    assert await allocate_number(db_session, "INV", None, None) == "INV-00001"


# ==================================================== FINANCIAL-YEAR INSERTION
async def test_the_financial_year_label_is_inserted_verbatim(db_session):
    """APPENDIX-B:45's {FY_LABEL} is the Financial Year's own label from
    Masters §3.1, not a year re-derived from today's date. A 2027-28 FY
    labelled "2027" must produce "INV-2027-00001", and a label written in the
    two-part Indian style must survive unaltered.
    """
    fy_2027 = await _fy_2027(db_session)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)
    assert await allocate_number(db_session, "INV", fy_2027.id, fy_2027.label) == "INV-2027-00001"

    fy_split = await _fy(db_session, "2028-29", start=date(2028, 4, 1), end=date(2029, 3, 31))
    await _rule(db_session, code_type="TKT", label="Ticket Number", prefix="TKT", digits=4, starting_number=1)
    assert await allocate_number(db_session, "TKT", fy_split.id, fy_split.label) == "TKT-2028-29-0001"


# ====================================================== RUNNING NUMBER / STATE
async def test_the_running_number_increments_by_exactly_one_each_time(db_session):
    # Starting number 1, 5 digits: 1 -> 2 -> 3, padded to 00001/00002/00003.
    # After three allocations the stored counter must sit at 3 + 1 = 4.
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)

    codes = [await allocate_number(db_session, "INV", fy.id, fy.label) for _ in range(3)]
    assert codes == ["INV-2026-00001", "INV-2026-00002", "INV-2026-00003"]

    seq = (await db_session.execute(select(DocumentNumberSequence).where(DocumentNumberSequence.code_type == "INV"))).scalar_one()
    assert seq.next_number == 4, "next_number = last issued 3 + 1"
    assert seq.last_issued_number == 3


async def test_the_starting_number_is_the_first_number_actually_issued(db_session):
    """A Starting Number other than 1 is the whole point of the field —
    Masters §3.6e exists so a company migrating in mid-series can continue
    its old numbering. Starting number 500 at 4 digits: the FIRST code is
    500 padded to "0500", the second 501 -> "0501". A first code of "0001"
    (i.e. ignoring the field and starting at 1) would be the bug.
    """
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="PRJ", label="Project Code", prefix="PRJ", digits=4, starting_number=500)

    assert await allocate_number(db_session, "PRJ", fy.id, fy.label) == "PRJ-2026-0500"
    assert await allocate_number(db_session, "PRJ", fy.id, fy.label) == "PRJ-2026-0501"


async def test_a_zero_starting_number_is_honoured(db_session):
    # The DDL's own floor (migration 0002: CHECK (starting_number >= 0)), and
    # the format APPENDIX-B:366 spells out for Project Code, "PRJ-<FY>-0000".
    # 0 padded to 4 digits is "0000", and the next is 1 -> "0001".
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="PRJ", label="Project Code", prefix="PRJ", digits=4, starting_number=0)

    assert await allocate_number(db_session, "PRJ", fy.id, fy.label) == "PRJ-2026-0000"
    assert await allocate_number(db_session, "PRJ", fy.id, fy.label) == "PRJ-2026-0001"


async def test_generating_the_first_code_locks_the_starting_number(db_session):
    """APPENDIX-B:46 — "the Starting Number for a code type CANNOT be changed
    once any code of that type has been generated". The allocator's half of
    that rule is raising the flag the Masters edit path then refuses to write
    past (app/api/v1/masters_company_profile.py:378). Before the first
    allocation the rule is unlocked with 0 generated; after two it is locked
    and the count is exactly 2 — one per code, not per call to Masters.
    """
    fy = await _fy_2026(db_session, is_current=True)
    rule = await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)
    assert rule.starting_number_locked is False
    assert rule.generated_count == 0
    assert rule.first_generated_at is None

    await allocate_number(db_session, "INV", fy.id, fy.label)
    first_generated_at = rule.first_generated_at
    assert rule.starting_number_locked is True
    assert first_generated_at is not None
    assert rule.generated_count == 1

    await allocate_number(db_session, "INV", fy.id, fy.label)
    assert rule.generated_count == 2
    assert rule.first_generated_at == first_generated_at, "first_generated_at records the FIRST code, and must not be re-stamped"


async def test_a_running_number_that_outgrows_its_digit_width_widens(db_session):
    """The degenerate width case. APPENDIX-B:45 caps the configured width at
    6 digits but says nothing about what happens when a series exhausts it,
    and zero-padding cannot truncate: 99999 padded to 5 is "99999", and the
    next number, 100000, is already 6 characters, so it renders in full as
    "100000" rather than wrapping to "00000" and colliding with an issued
    code. Documented here so the widening is a decision on record rather
    than a surprise the first time a 5-digit series passes 99,999.
    """
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=99999)

    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "INV-2026-99999"
    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "INV-2026-100000"


async def test_changing_the_prefix_or_width_affects_only_new_codes(db_session):
    """APPENDIX-B:48 — "NUMBERING CHANGES ARE FORWARD-ONLY: changing a code
    type that has already generated records affects only new records;
    existing codes are never rewritten." The running number must NOT restart
    when the prefix or width changes: after "INV-2026-00001", switching to
    prefix "BILL" at 6 digits gives running number 2 rendered at the NEW
    width -> "BILL-2026-000002", not "BILL-2026-000001".
    """
    fy = await _fy_2026(db_session, is_current=True)
    rule = await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)

    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "INV-2026-00001"

    rule.prefix = "BILL"
    rule.running_number_digits = 6
    await db_session.flush()

    assert await allocate_number(db_session, "INV", fy.id, fy.label) == "BILL-2026-000002"


# ============================================================= FY RESET / NO RESET
async def test_the_series_restarts_at_the_starting_number_in_a_new_financial_year(db_session):
    """APPENDIX-B:47, verbatim: "when Resets Every FY = Yes, the running
    number restarts at the Starting Number on the FIRST record created in
    each new financial year."
      FY 2026: 1 -> "INV-2026-00001", 2 -> "INV-2026-00002"
      FY 2027: restarts at the Starting Number, 1 -> "INV-2027-00001"
    and FY 2026's own counter is untouched by that, so the next 2026 code is
    3 -> "INV-2026-00003".
    """
    fy_2026 = await _fy_2026(db_session, is_current=True)
    fy_2027 = await _fy_2027(db_session)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1, resets_every_fy=True)

    assert await allocate_number(db_session, "INV", fy_2026.id, fy_2026.label) == "INV-2026-00001"
    assert await allocate_number(db_session, "INV", fy_2026.id, fy_2026.label) == "INV-2026-00002"

    assert await allocate_number(db_session, "INV", fy_2027.id, fy_2027.label) == "INV-2027-00001"

    assert await allocate_number(db_session, "INV", fy_2026.id, fy_2026.label) == "INV-2026-00003"


async def test_the_reset_honours_a_non_default_starting_number(db_session):
    # :47 restarts at the STARTING NUMBER, not at 1. Starting number 500:
    #   FY 2026: 500 -> "PRJ-2026-0500"
    #   FY 2027: back to 500 -> "PRJ-2027-0500"
    fy_2026 = await _fy_2026(db_session, is_current=True)
    fy_2027 = await _fy_2027(db_session)
    await _rule(db_session, code_type="PRJ", label="Project Code", prefix="PRJ", digits=4, starting_number=500, resets_every_fy=True)

    assert await allocate_number(db_session, "PRJ", fy_2026.id, fy_2026.label) == "PRJ-2026-0500"
    assert await allocate_number(db_session, "PRJ", fy_2027.id, fy_2027.label) == "PRJ-2027-0500"


@pytest.mark.xfail(
    strict=True,
    reason=(
        "FINDING (bug in app/services/numbering.py, NOT in this test): allocate_number() "
        "never reads NumberPrefixRule.resets_every_fy. It keys document_number_sequences on "
        "(code_type, financial_year_id) unconditionally, and all 12 call sites pass the current "
        "fy.id unconditionally, so EVERY code type restarts every financial year no matter how "
        "Resets Every FY is set. Setting it to No in Masters has no effect whatsoever. Remove "
        "this xfail once allocate_number honours the flag (financial_year_id=None for a "
        "continuous series)."
    ),
)
async def test_the_series_does_not_restart_when_resets_every_fy_is_off(db_session):
    """APPENDIX-B:47 conditions the restart on "Resets Every FY = Yes", and
    `resets_every_fy` is a real, Super-Admin-editable Masters field
    (number_prefix_rules.resets_every_fy, written by
    app/api/v1/masters_company_profile.py:386, surfaced in
    app/rbac/field_manifest.json). With it set to No the running number must
    therefore CONTINUE across the financial-year boundary:

      FY 2026: 1 -> "INV-2026-00001", 2 -> "INV-2026-00002"
      FY 2027: the series does not restart, so the next number is 3
               -> "INV-2027-00003"

    Hand-arithmetic re-checked twice against the spec. The code returns
    "INV-2027-00001" instead — a duplicate running number within one
    continuous series, which is exactly what turning the flag off is meant
    to prevent.
    """
    fy_2026 = await _fy_2026(db_session, is_current=True)
    fy_2027 = await _fy_2027(db_session)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1, resets_every_fy=False)

    assert await allocate_number(db_session, "INV", fy_2026.id, fy_2026.label) == "INV-2026-00001"
    assert await allocate_number(db_session, "INV", fy_2026.id, fy_2026.label) == "INV-2026-00002"

    assert await allocate_number(db_session, "INV", fy_2027.id, fy_2027.label) == "INV-2027-00003"


# ================================================================== CONCURRENCY
async def test_both_reads_take_a_row_lock(db_session):
    """The allocator's stated concurrency design (numbering.py's docstring):
    "Concurrency-safe via SELECT ... FOR UPDATE inside the caller's own
    transaction". This captures the statements allocate_number ACTUALLY
    builds — via the ORM's do_orm_execute event, so it is the real ones, not
    a look-alike written here — and compiles them for MySQL, the production
    dialect. Deleting either .with_for_update() fails this test.
    """
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)

    captured = []

    @event.listens_for(db_session.sync_session, "do_orm_execute")
    def _capture(state):  # pragma: no cover - trivial collector
        captured.append(state.statement)

    try:
        await allocate_number(db_session, "INV", fy.id, fy.label)
    finally:
        event.remove(db_session.sync_session, "do_orm_execute", _capture)

    assert len(captured) == 2, "both the prefix rule and the sequence row must be read under a lock"
    for statement in captured:
        assert statement._for_update_arg is not None, "a read without FOR UPDATE is a lost-update race"
        assert "FOR UPDATE" in str(statement.compile(dialect=mysql.dialect())).upper()


async def test_sequential_allocations_across_committed_transactions_never_repeat(db_session):
    """The realistic serialised case, and the one SQLite CAN prove: each
    allocation commits before the next begins, so the second must re-read the
    persisted counter rather than the value it had in memory.
    1 -> 2 -> ... -> 10, giving ten distinct codes 00001..00010, and a
    counter left at 10 + 1 = 11.
    """
    fy = await _fy_2026(db_session, is_current=True)
    await _rule(db_session, code_type="INV", prefix="INV", digits=5, starting_number=1)
    await db_session.commit()

    codes = []
    for _ in range(10):
        codes.append(await allocate_number(db_session, "INV", fy.id, fy.label))
        await db_session.commit()

    assert codes == [f"INV-2026-{n:05d}" for n in range(1, 11)]
    assert len(set(codes)) == 10, "no duplicates across ten committed transactions"

    seq = (await db_session.execute(select(DocumentNumberSequence).where(DocumentNumberSequence.code_type == "INV"))).scalar_one()
    assert seq.next_number == 11


async def test_concurrent_allocation_cannot_be_proven_safe_on_sqlite():
    """The honest concurrency result, and the reason the real proof lives
    against MySQL rather than here.

    Ten allocations are issued genuinely concurrently — asyncio.gather over
    ten separate AsyncSessions, each running the real allocate_number, not a
    sequential loop dressed up as one. On a database with working row locks
    the FOR UPDATE on the sequence read serialises them into 00001..00010.
    On SQLite the clause is compiled away entirely (asserted below, so this
    is a fact on record and not an assumption), and the schema created by
    Base.metadata.create_all() also lacks migration 0001's
    `UNIQUE KEY ux_docseq_type_fy` backstop — so the ten allocations all read
    the same empty sequence and all issue the SAME number.

    That collision is the assertion. It proves the harness is genuinely
    racing rather than accidentally serialising, and it proves the row lock
    is load-bearing: this is precisely the failure it exists to prevent.
    """
    lock_free = select(DocumentNumberSequence).where(DocumentNumberSequence.code_type == "INV").with_for_update()
    from sqlalchemy.dialects import sqlite as sqlite_dialect

    compiled_for_sqlite = str(lock_free.compile(dialect=sqlite_dialect.dialect())).upper()
    assert "FOR UPDATE" not in compiled_for_sqlite, "SQLite silently drops the row lock — that is why this test asserts a collision"

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        async with session_factory() as setup:
            fy = await _fy_2026(setup, is_current=True)
            fy_id, fy_label = fy.id, fy.label
            await _rule(setup, code_type="INV", prefix="INV", digits=5, starting_number=1)
            await setup.commit()

        async def allocate_one() -> str:
            async with session_factory() as session:
                code = await allocate_number(session, "INV", fy_id, fy_label)
                await session.commit()
                return code

        codes = await asyncio.gather(*(allocate_one() for _ in range(10)))
    finally:
        await engine.dispose()

    assert len(codes) == 10
    assert len(set(codes)) < len(codes), (
        "SQLite unexpectedly serialised ten concurrent allocations. Do NOT weaken this "
        "assertion to make it pass — re-read this module's docstring first: a pass here "
        "would mean SQLite had become a valid stand-in for MySQL's row locks, and the "
        "no-duplicates proof could then be asserted directly instead of deferred to an "
        "integration test against the live container."
    )


# ============================================================ ERROR PATHS
async def test_an_unconfigured_code_type_is_a_clean_409(db_session):
    """No Number Prefix Rule row for the code type. numbering.py's own
    comment records why this is an HTTPException rather than a ValueError:
    the Phase 2 audit found it surfacing as an unhandled 500 on every call
    site. Nothing may be allocated, and no sequence row may be left behind.
    """
    fy = await _fy_2026(db_session, is_current=True)

    with pytest.raises(HTTPException) as caught:
        await allocate_number(db_session, "INV", fy.id, fy.label)

    assert caught.value.status_code == 409
    assert "INV" in caught.value.detail
    sequences = (await db_session.execute(select(DocumentNumberSequence))).scalars().all()
    assert sequences == [], "a failed allocation must not leave a half-built sequence row behind"


async def test_current_financial_year_is_the_one_flagged_is_current(db_session):
    # Masters §3.1 — exactly one FY carries is_current. The 2027 row exists
    # but is not current, so it must not be returned.
    await _fy_2027(db_session, is_current=False)
    current = await _fy_2026(db_session, is_current=True)

    resolved = await get_current_financial_year(db_session)
    assert resolved.id == current.id
    assert resolved.label == "2026"


async def test_no_current_financial_year_is_a_clean_409(db_session):
    # An FY exists but none is flagged current — the allocator must not
    # guess one from today's date.
    await _fy_2026(db_session, is_current=False)

    with pytest.raises(HTTPException) as caught:
        await get_current_financial_year(db_session)

    assert caught.value.status_code == 409
    assert "Financial Year" in caught.value.detail
