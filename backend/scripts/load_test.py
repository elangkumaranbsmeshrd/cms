"""Cross-cutting hardening — the REAL load test that replaces load_check.py.

load_check.py says, in its own docstring: "a basic local concurrency sanity
check, not a real load test... throughput/latency numbers here are not
meaningful benchmarks." This script is what it deferred: production-shaped
DATA VOLUME (10k+ invoices, 500 payroll-linked employees) driven over the
real HTTP/ASGI stack at real concurrency (1/10/50), plus a 50-concurrent-
session login/browse simulation that checks the Redis-backed login rate
limiter (app/core/rate_limit.py) doesn't false-positive under real
concurrency.

===========================================================================
READ THIS BEFORE TRUSTING ANY NUMBER THIS SCRIPT PRINTS
===========================================================================
This still cannot fix the one thing load_check.py could not fix either:
WHAT HARDWARE IT RUNS ON. Run against a local dev laptop (MySQL + Redis in
Docker Desktop, one uvicorn process, no nginx, no gunicorn workers), the
numbers below are a DEV-HARDWARE BASELINE, NOT a capacity or production
claim. They are internally comparable (e.g. "p95 grew 4x from concurrency
1 to 50 on THIS box") and they are useful for catching real breakage
(errors, timeouts, N+1 patterns, a saturated connection pool) — they are
NOT a prediction of what a real deployment (ARCH-3 Section 9.5: 4 vCPU, 5
gunicorn workers, real disks, a dedicated DB host) will do under the same
load. Docker Desktop's MySQL/Redis also sit behind a virtualised network
bridge on Windows, which adds its own noise a bare-metal/cloud deployment
would not have.

What THIS script is for: it is the real, reusable harness — point
--base-url at a real deployment's URL (and point this machine's .env
DATABASE_URL at that deployment's real database for the seeding step, same
as app/core/db.py already does for the live app) once production-shaped
hardware exists, and the numbers it prints there ARE a real capacity
measurement. Nothing about the test methodology changes between "run on my
laptop today" and "run against the droplet later" — only the hardware
underneath it does, and that is the whole point of keeping this script
around rather than writing a throwaway one.

===========================================================================
WHAT THIS DOES
===========================================================================
  1. Seeds production-shaped data DIRECTLY via SQLAlchemy against the same
     MySQL app/core/db.py points at (bulk INSERT, not 10,500 individual API
     calls — that would test the wrong thing and take hours):
       - 10,500+ Invoice rows (+ 1-3 line items each) across ~40 synthetic
         customers, varied dates/amounts/status, clearly marked
         (invoice_number LIKE 'LOADTEST-INV-%', customer_code LIKE
         'LOADTEST-CUST-%') so cleanup only ever touches its own rows.
       - 500 Employee rows with linked SalaryStructures (employee_code LIKE
         'LOADTEST-%', email @loadtest.invalid).
  2. Hits the real GET /api/v1/invoices endpoint (invoices.py's batched
     N+1-fixed loader, _load_invoice_outs) over real HTTP, at concurrency
     1/10/50, both with realistic narrowing filters and — because this
     endpoint has NO pagination at all, confirmed by reading invoices.py's
     Query params — with none, which is the true worst case for a caller
     who just opens the list screen. Reports p50/p95/p99/max per cell.
  3. Creates one real PayrollRun over the 500 seeded employees
     (SPECIFIC_EMPLOYEES — never touches this DB's other, real employees or
     their payroll history) and times POST /payroll/runs (=preview: a run
     always lands in DRAFT fully calculated — there is no separate preview
     endpoint) and POST /payroll/runs/{id}/confirm separately.
  4. Simulates 50 concurrent authenticated sessions (5 real demo accounts x
     10 concurrent logins each) doing login -> a few screens -> one record
     read, and separately proves the login rate limiter's "only FAILED
     attempts count" rule holds under actual concurrent success (not just
     the single-request unit tests) — plus an isolated positive-control
     probe (deliberate wrong-password attempts against a throwaway fake
     account) proving the limiter mechanism itself is alive, so "zero 429s
     under concurrent legitimate logins" cannot be misread as "the limiter
     is silently broken."
  5. Cleans up the invoice/customer data it made (chunked deletes, so this
     is safe to point at a much bigger dataset later too).

===========================================================================
WHAT IS **NOT** CLEANED UP, AND WHY (read before running --confirm-payroll)
===========================================================================
Confirming a payroll run generates real Payslip rows, and the DB schema
enforces `trg_payslips_no_delete` — "A payslip is never deleted, corrections
go through Reissue" — UNCONDITIONALLY, at the trigger level. That is a real
application invariant (payslips are meant to be a permanent audit trail),
not an oversight this script works around. Once it fires, the FK chain
(Payslip -[RESTRICT]-> PayrollRunEmployee -[RESTRICT]-> Employee/
SalaryStructure/PayrollRun/MonthlyHourReconciliation) makes the 500 seeded
Employees, their SalaryStructures, the PayrollRun, its 500
PayrollRunEmployee rows and 500 MonthlyHourReconciliation rows permanently
undeletable through normal SQL too — and `trg_email_send_log_reject_delete`
("email_send_log is append-only") does the same to the ~500 EmailSendLog
rows the confirm step writes (this dev box's Email Server Settings are
CUSTOM_SMTP pointed at a host that does not resolve on this network, so
every one of those logs FAILED fast — see the report this script prints).

Because of this, confirming payroll is gated behind an explicit
--confirm-payroll flag (default: create the run and time the preview only,
never call /confirm). Passing it is a deliberate, permanent, one-way change
to whatever database this script points at. All of that data is clearly
marked (employee_code / customer_code / invoice_number LIKE 'LOADTEST%',
email LIKE '%@loadtest.invalid') for anyone who later needs to find it; the
only way to actually remove it is a deliberate out-of-band DBA action
(temporarily disabling trg_payslips_no_delete / trg_email_send_log_reject_delete)
that this script deliberately does not perform on its own.

===========================================================================
USAGE
===========================================================================
    .venv/Scripts/python.exe scripts/load_test.py [options]

Key options (see --help for the rest):
  --base-url URL          Server to load-test (default http://127.0.0.1:8001)
  --confirm-payroll       Actually call POST /confirm (see warning above)
  --skip-seed             Reuse data a previous run already seeded
  --no-cleanup            Leave the invoice/customer data in place
  --cleanup-only          Just delete any LOADTEST-* rows this script left
                          behind (invoices/customers only — see above), then exit

The database it seeds/cleans is whatever DATABASE_URL app/core/config.py
resolves (this machine's backend/.env) — same connection the live app
itself uses, per the task's own instruction. There is deliberately no
separate --database-url flag: pointing this at another environment means
pointing THAT environment's .env at it, exactly like running the app does.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import bindparam, insert, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import get_settings
from app.models.customer import Customer
from app.models.employee import Employee, SalaryStructure
from app.models.finance import Invoice, InvoiceLineItem
from app.models.masters import CustomerStatus, Department, Designation, EmploymentType
from app.models.numbering import FinancialYear
from app.models.platform import User

MARKER = "LOADTEST"
ADMIN_EMAIL_DEFAULT = "superadmin@meshrd.in"
ADMIN_PASSWORD_DEFAULT = "Passw0rd!"
# Folded into every identifier this script generates (employee_code,
# customer_code, invoice_number, email) so a run is collision-safe against
# leftover data from an EARLIER run of this same script — in particular
# against a previous run's confirmed payroll, whose Employee/SalaryStructure
# rows are permanently undeletable (trg_payslips_no_delete — see docstring)
# and would otherwise clash on employee_code's unique constraint. Cleanup's
# own LIKE 'LOADTEST-%' patterns still match everything regardless of tag.
RUN_TAG = uuid.uuid4().hex[:4]

# The 5 demo accounts app/seed.py creates, all sharing one known dev
# password. Used (never created here) for the 50-concurrent-session
# simulation — real accounts across real roles, not accounts this script
# invents, so RBAC-shaped variety comes for free.
DEMO_ACCOUNTS = [
    ("superadmin@meshrd.in", "Passw0rd!"),
    ("manager@meshrd.in", "Passw0rd!"),
    ("accountant@meshrd.in", "Passw0rd!"),
    ("hr@meshrd.in", "Passw0rd!"),
    ("employee@meshrd.in", "Passw0rd!"),
]
SESSIONS_PER_ACCOUNT = 10  # 5 x 10 = 50 concurrent sessions

# One universal, screen-gate-free "extra" read per account is /api/v1/me
# itself; this adds one role-appropriate list/read on top so the sequence
# is "login, list a few screens, read one record" rather than just "login".
ROLE_EXTRA_ENDPOINT = {
    "superadmin@meshrd.in": "/api/v1/employees",
    "hr@meshrd.in": "/api/v1/employees",
    "accountant@meshrd.in": "/api/v1/invoices",
    "manager@meshrd.in": "/api/v1/employees/me",
    "employee@meshrd.in": "/api/v1/employees/me",
}

FIRST_NAMES = [
    "Aditi", "Arjun", "Priya", "Rohan", "Sneha", "Vikram", "Ananya", "Karthik", "Divya", "Rahul",
    "Meera", "Suresh", "Kavya", "Manoj", "Pooja", "Sanjay", "Neha", "Arun", "Deepa", "Vivek",
    "Lakshmi", "Ravi", "Shreya", "Ajay", "Nisha", "Kiran", "Swati", "Ramesh", "Anjali", "Naveen",
]
LAST_NAMES = [
    "Iyer", "Sharma", "Menon", "Reddy", "Nair", "Kulkarni", "Gupta", "Rao", "Pillai", "Verma",
    "Krishnan", "Bhat", "Desai", "Joshi", "Shetty", "Mehta", "Pandey", "Choudhary", "Agarwal", "Das",
]
COMPANY_WORDS_A = [
    "Bluepeak", "Silverline", "Northwind", "Crimson", "Everline", "Vantage", "Solstice", "Ironclad",
    "Meridian", "Amber", "Quartz", "Falcon", "Harbor", "Zenith", "Cobalt", "Lumen", "Granite", "Cascade",
]
COMPANY_WORDS_B = [
    "Textiles", "Logistics", "Systems", "Foods", "Retail", "Analytics", "Builders", "Energy", "Media",
    "Pharma", "Apparel", "Freight", "Software", "Hospitality", "Chemicals", "Electronics", "Agro", "Realty",
]
COMPANY_SUFFIXES = ["Pvt Ltd", "LLP", "Industries", "Group", "& Co", "Enterprises"]
LINE_DESCRIPTIONS = [
    "Consulting Services", "Software License Fee", "Monthly Retainer", "Implementation Services",
    "Support & Maintenance", "Cloud Hosting Charges", "Training Services", "Custom Development",
    "Data Migration Services", "Onsite Support Visit", "Annual Subscription", "Integration Services",
]
# (status, weight) — weights need not sum to 1, pick_status() normalizes by running total.
STATUS_WEIGHTS = [("DRAFT", 0.10), ("SENT", 0.35), ("PART_PAID", 0.20), ("PAID", 0.30), ("PEND_PAID", 0.05)]


def chunked(seq: list, size: int):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def pick_status() -> str:
    r = random.random()
    acc = 0.0
    for name, weight in STATUS_WEIGHTS:
        acc += weight
        if r <= acc:
            return name
    return "SENT"


def money(lo: int, hi: int) -> Decimal:
    """Random Decimal amount, lo/hi given in whole rupees."""
    return (Decimal(random.randint(lo * 100, hi * 100)) / 100).quantize(Decimal("0.01"))


# =========================================================================
# DB seeding — direct SQLAlchemy Core bulk inserts, no ORM object overhead,
# no allocate_number() calls (so this never touches the real running
# document-number sequences other invoices/employees are allocated from).
# =========================================================================


async def fetch_master_ids(engine: AsyncEngine, admin_email: str) -> dict:
    async with engine.connect() as conn:
        fy_id = (await conn.execute(select(FinancialYear.id).where(FinancialYear.is_current.is_(True)))).scalar_one()
        fy_start = (await conn.execute(select(FinancialYear.start_date).where(FinancialYear.id == fy_id))).scalar_one()
        admin_id = (await conn.execute(select(User.id).where(User.email == admin_email))).scalar_one()
        status_id = (await conn.execute(select(CustomerStatus.id).where(CustomerStatus.name == "Active"))).scalar_one()
        dept_ids = list((await conn.execute(select(Department.id).where(Department.is_active.is_(True)))).scalars().all())
        desig_ids = list((await conn.execute(select(Designation.id).where(Designation.is_active.is_(True)))).scalars().all())
        etype_ids = list((await conn.execute(select(EmploymentType.id).where(EmploymentType.is_active.is_(True)))).scalars().all())
    if not (dept_ids and desig_ids and etype_ids):
        raise RuntimeError("Masters (Department/Designation/EmploymentType) are empty — seed the app's own Masters first")
    return {
        "fy_id": fy_id, "fy_start": fy_start, "admin_id": admin_id, "status_id": status_id,
        "dept_ids": dept_ids, "desig_ids": desig_ids, "etype_ids": etype_ids,
    }


async def seed_customers(engine: AsyncEngine, n: int, ids: dict) -> list[dict]:
    now = datetime.now(timezone.utc)
    customers = []
    rows = []
    for i in range(1, n + 1):
        cid = str(uuid.uuid4())
        name = f"{MARKER} {random.choice(COMPANY_WORDS_A)} {random.choice(COMPANY_WORDS_B)} {random.choice(COMPANY_SUFFIXES)}"
        customers.append({"id": cid, "company_name": name})
        rows.append(dict(
            id=cid, customer_code=f"{MARKER}-CUST-{RUN_TAG}-{i:04d}", financial_year_id=ids["fy_id"],
            company_name=name, status_id=ids["status_id"], total_invoiced=Decimal("0"), received=Decimal("0"),
            created_at=now, updated_at=now, created_by=ids["admin_id"], updated_by=ids["admin_id"],
        ))
    async with engine.begin() as conn:
        for chunk in chunked(rows, 500):
            await conn.execute(insert(Customer), chunk)
    return customers


async def seed_invoices(engine: AsyncEngine, n: int, customers: list[dict], ids: dict) -> dict:
    now = datetime.now(timezone.utc)
    today = date.today()
    fy_start: date = ids["fy_start"]
    span_days = max(1, (today - fy_start).days)
    invoice_rows: list[dict] = []
    line_rows: list[dict] = []
    invoice_ids: list[str] = []

    for i in range(1, n + 1):
        inv_id = str(uuid.uuid4())
        invoice_ids.append(inv_id)
        customer = random.choice(customers)
        invoice_date = fy_start + timedelta(days=random.randint(0, span_days))
        due_date = invoice_date + timedelta(days=random.randint(10, 45))

        subtotal = Decimal("0")
        for seq in range(1, random.randint(1, 3) + 1):
            qty = Decimal(random.randint(1, 20))
            rate = money(500, 25000)
            subtotal += qty * rate
            line_rows.append(dict(
                id=str(uuid.uuid4()), invoice_id=inv_id, sequence=seq, description=random.choice(LINE_DESCRIPTIONS),
                quantity=qty, rate=rate, credited_amount=Decimal("0"),
                created_at=now, updated_at=now, created_by=ids["admin_id"], updated_by=ids["admin_id"],
            ))
        tax_amount = (subtotal * Decimal("0.18")).quantize(Decimal("0.01"))
        grand_total = subtotal + tax_amount
        inv_status = pick_status()

        if inv_status in ("DRAFT", "SENT"):
            amount_received = Decimal("0")
        elif inv_status == "PART_PAID":
            amount_received = (grand_total * Decimal(random.randint(20, 80)) / 100).quantize(Decimal("0.01"))
        else:  # PAID, PEND_PAID — settled in full
            amount_received = grand_total

        sent_at = sent_by = paid_at = None
        if inv_status != "DRAFT":
            sent_at = datetime.combine(invoice_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=random.randint(0, 2))
            sent_by = ids["admin_id"]
        if inv_status in ("PAID", "PEND_PAID"):
            paid_at = sent_at + timedelta(days=random.randint(3, 20))

        invoice_rows.append(dict(
            id=inv_id, invoice_number=f"{MARKER}-INV-{RUN_TAG}-{i:06d}", financial_year_id=ids["fy_id"], customer_id=customer["id"],
            invoice_date=invoice_date, due_date=due_date, customer_name_snapshot=customer["company_name"],
            subtotal=subtotal, tax_amount=tax_amount, amount_received=amount_received,
            credit_note_total=Decimal("0"), withheld_total=Decimal("0"), status=inv_status,
            sent_at=sent_at, sent_by=sent_by, paid_at=paid_at,
            created_at=now, updated_at=now, created_by=ids["admin_id"], updated_by=ids["admin_id"],
        ))

    async with engine.begin() as conn:
        for chunk in chunked(invoice_rows, 1000):
            await conn.execute(insert(Invoice), chunk)
        for chunk in chunked(line_rows, 2000):
            await conn.execute(insert(InvoiceLineItem), chunk)
    return {"invoice_ids": invoice_ids, "line_item_count": len(line_rows)}


async def seed_employees(engine: AsyncEngine, n: int, ids: dict) -> list[str]:
    now = datetime.now(timezone.utc)
    today = date.today()
    employee_rows = []
    structure_rows = []
    employee_ids = []
    for i in range(1, n + 1):
        eid = str(uuid.uuid4())
        employee_ids.append(eid)
        joining_date = today - timedelta(days=random.randint(15, 5 * 365))
        basic = money(25000, 150000)
        hra = (basic * Decimal("0.40")).quantize(Decimal("0.01"))
        special = (basic * Decimal("0.15")).quantize(Decimal("0.01"))
        employee_rows.append(dict(
            id=eid, employee_code=f"{MARKER}-{RUN_TAG}-{i:04d}", code_financial_year_id=ids["fy_id"],
            first_name=random.choice(FIRST_NAMES), last_name=random.choice(LAST_NAMES),
            email=f"loadtest.{RUN_TAG}.emp{i:04d}@loadtest.invalid",
            department_id=random.choice(ids["dept_ids"]), designation_id=random.choice(ids["desig_ids"]),
            employment_type_id=random.choice(ids["etype_ids"]), joining_date=joining_date, employment_status="ACTIVE",
            created_at=now, updated_at=now, created_by=ids["admin_id"], updated_by=ids["admin_id"],
        ))
        structure_rows.append(dict(
            id=str(uuid.uuid4()), employee_id=eid, financial_year_id=ids["fy_id"], effective_from=joining_date,
            changed_by=ids["admin_id"], basic_salary_monthly=basic, hra_monthly=hra, special_allowance_monthly=special,
            created_at=now, updated_at=now, created_by=ids["admin_id"], updated_by=ids["admin_id"],
        ))
    async with engine.begin() as conn:
        for chunk in chunked(employee_rows, 200):
            await conn.execute(insert(Employee), chunk)
        for chunk in chunked(structure_rows, 200):
            await conn.execute(insert(SalaryStructure), chunk)
    return employee_ids


async def chunked_delete(engine: AsyncEngine, sql: str, params: dict) -> int:
    """Repeats a `DELETE ... LIMIT n` until nothing is left, committing each
    chunk separately — safe against a real dataset far bigger than this
    script's own 10k+ rows, unlike one unbounded DELETE."""
    total = 0
    async with engine.connect() as conn:
        while True:
            result = await conn.execute(text(sql), params)
            await conn.commit()
            n = result.rowcount
            total += n
            if n == 0:
                break
    return total


async def cleanup_invoices_and_customers(engine: AsyncEngine) -> dict:
    t0 = time.perf_counter()
    # invoice_line_items/invoice_tax_lines both cascade off invoices, so
    # deleting invoices is enough — see fk_invlines_invoice/fk_invtax_invoice.
    invoices_deleted = await chunked_delete(
        engine, "DELETE FROM invoices WHERE invoice_number LIKE :pat LIMIT 1000", {"pat": f"{MARKER}-INV-%"}
    )
    customers_deleted = await chunked_delete(
        engine, "DELETE FROM customers WHERE customer_code LIKE :pat LIMIT 1000", {"pat": f"{MARKER}-CUST-%"}
    )
    return {"invoices_deleted": invoices_deleted, "customers_deleted": customers_deleted, "seconds": time.perf_counter() - t0}


async def payroll_residue_report(engine: AsyncEngine, run_id: str | None) -> dict:
    """Counts what payroll-related rows still exist for this run/employees
    and whether they are actually deletable, rather than assuming based on
    whether confirm was called — a failed confirm leaves no Payslips, so
    the run/employees/structures ARE still cleanable in that case."""
    async with engine.connect() as conn:
        employee_count = (
            await conn.execute(text("SELECT COUNT(*) FROM employees WHERE employee_code LIKE :pat"), {"pat": f"{MARKER}-%"})
        ).scalar_one()
        structure_count = (
            await conn.execute(
                text("SELECT COUNT(*) FROM salary_structures ss JOIN employees e ON e.id = ss.employee_id WHERE e.employee_code LIKE :pat"),
                {"pat": f"{MARKER}-%"},
            )
        ).scalar_one()
        payslip_count = 0
        run_status = None
        if run_id:
            payslip_count = (await conn.execute(text("SELECT COUNT(*) FROM payslips WHERE payroll_run_id = :rid"), {"rid": run_id})).scalar_one()
            run_status = (await conn.execute(text("SELECT status FROM payroll_runs WHERE id = :rid"), {"rid": run_id})).scalar_one_or_none()
        email_log_count = (
            await conn.execute(text("SELECT COUNT(*) FROM email_send_log WHERE recipient_email LIKE 'loadtest.%@loadtest.invalid'"))
        ).scalar_one()
    return {
        "employee_count": employee_count, "structure_count": structure_count,
        "payslip_count": payslip_count, "run_status": run_status, "email_log_count": email_log_count,
    }


async def cleanup_payroll_if_safe(engine: AsyncEngine, run_id: str | None, employee_ids: list[str]) -> str:
    """Only reachable when NO Payslip rows exist for this run (confirm was
    never called, or it failed) — in that case the whole tree really is
    deletable and this removes it. Returns a human-readable outcome string."""
    if run_id is None:
        return "no payroll run was created — nothing to clean up"
    async with engine.connect() as conn:
        payslip_count = (await conn.execute(text("SELECT COUNT(*) FROM payslips WHERE payroll_run_id = :rid"), {"rid": run_id})).scalar_one()
    if payslip_count > 0:
        return f"SKIPPED — {payslip_count} Payslip rows exist and trg_payslips_no_delete forbids deleting them (see docstring)"
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM payroll_run_employees WHERE payroll_run_id = :rid"), {"rid": run_id})
        await conn.execute(text("DELETE FROM payroll_runs WHERE id = :rid"), {"rid": run_id})
        if employee_ids:
            del_structures = text("DELETE FROM salary_structures WHERE employee_id IN :ids").bindparams(bindparam("ids", expanding=True))
            await conn.execute(del_structures, {"ids": employee_ids})
            del_employees = text("DELETE FROM employees WHERE id IN :ids").bindparams(bindparam("ids", expanding=True))
            await conn.execute(del_employees, {"ids": employee_ids})
    return "DELETED — the DRAFT run was never confirmed, so no Payslips existed and the full tree was removable"


# =========================================================================
# HTTP load helpers
# =========================================================================


@dataclass
class Sample:
    status: int
    ms: float
    error: str | None = None


def summarize(samples: list[Sample], wall_seconds: float) -> dict:
    latencies = sorted(s.ms for s in samples)
    n = len(latencies)

    def pct(p: float) -> float:
        if not latencies:
            return 0.0
        return latencies[min(n - 1, int(n * p))]

    codes: dict[int, int] = {}
    for s in samples:
        codes[s.status] = codes.get(s.status, 0) + 1
    server_errors = sum(1 for s in samples if s.status >= 500 or s.status == 0)
    return {
        "n": n, "p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99),
        "min": latencies[0] if latencies else 0.0, "max": latencies[-1] if latencies else 0.0,
        "mean": statistics.mean(latencies) if latencies else 0.0,
        "codes": codes, "server_errors": server_errors,
        "rps": n / wall_seconds if wall_seconds > 0 else 0.0, "wall_seconds": wall_seconds,
    }


async def run_concurrent(client: httpx.AsyncClient, concurrency: int, n: int, make_request) -> dict:
    sem = asyncio.Semaphore(concurrency)

    async def _one() -> Sample:
        async with sem:
            t0 = time.perf_counter()
            try:
                resp = await make_request(client)
                return Sample(resp.status_code, (time.perf_counter() - t0) * 1000)
            except Exception as exc:  # noqa: BLE001 — a timeout/connection error IS the finding
                return Sample(0, (time.perf_counter() - t0) * 1000, error=repr(exc))

    t_start = time.perf_counter()
    samples = list(await asyncio.gather(*(_one() for _ in range(n))))
    return summarize(samples, time.perf_counter() - t_start)


def fmt_row(label: str, r: dict) -> str:
    codes = ", ".join(f"{k}:{v}" for k, v in sorted(r["codes"].items()))
    return (
        f"  {label:<28} n={r['n']:<5} p50={r['p50']:>8.1f}ms  p95={r['p95']:>8.1f}ms  p99={r['p99']:>8.1f}ms  "
        f"max={r['max']:>9.1f}ms  rps={r['rps']:>6.1f}  5xx/errs={r['server_errors']:<4} codes=[{codes}]"
    )


# =========================================================================
# Scenario 1 — invoice list endpoint at concurrency 1/10/50
# =========================================================================


async def list_endpoint_load_test(base_url: str, token: str, customers: list[dict], concurrency_levels: list[int]) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    today = date.today()
    filter_pool = [
        {"customer_id": random.choice(customers)["id"]} if customers else {},
        {"status": "SENT"},
        {"status": "PAID"},
        {"invoice_date_from": (today - timedelta(days=30)).isoformat(), "invoice_date_to": today.isoformat()},
        {"search": MARKER},
        {"overdue": "true"},
        {"grand_total_min": "50000"},
    ]

    results: dict[str, dict] = {}
    async with httpx.AsyncClient(base_url=base_url, timeout=60, headers=headers, limits=httpx.Limits(max_connections=200)) as client:
        for concurrency in concurrency_levels:
            n_filtered = max(20, concurrency * 3)

            def _filtered_request(client: httpx.AsyncClient):
                params = random.choice(filter_pool)
                return client.get("/api/v1/invoices", params=params)

            r = await run_concurrent(client, concurrency, n_filtered, _filtered_request)
            key = f"filtered@{concurrency}"
            results[key] = r
            print(fmt_row(key, r))

        for concurrency in concurrency_levels:
            # Deliberately smaller n: this is the true worst case (returns
            # EVERY invoice in the table, no LIMIT/OFFSET exists on this
            # endpoint at all — confirmed by reading its Query params), so a
            # handful of samples per level is enough to see whether it is
            # merely slow or actually falls over, without the whole run
            # ballooning if it is very slow.
            n_unfiltered = max(5, min(30, concurrency))

            async def _unfiltered_request(client: httpx.AsyncClient):
                return await client.get("/api/v1/invoices")

            r = await run_concurrent(client, concurrency, n_unfiltered, _unfiltered_request)
            key = f"unfiltered@{concurrency}"
            results[key] = r
            print(fmt_row(key, r))

    return results


# =========================================================================
# Scenario 2 — payroll at scale
# =========================================================================


async def payroll_scale_test(base_url: str, token: str, employee_ids: list[str], do_confirm: bool) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    today = date.today()
    long_timeout = httpx.Timeout(600.0)
    async with httpx.AsyncClient(base_url=base_url, timeout=30, headers=headers) as client:
        t0 = time.perf_counter()
        resp = await client.post(
            "/api/v1/payroll/runs",
            json={
                "period_month": today.month, "period_year": today.year,
                "employee_selection_mode": "SPECIFIC_EMPLOYEES", "employee_ids": employee_ids,
            },
            timeout=long_timeout,
        )
        create_ms = (time.perf_counter() - t0) * 1000
        if resp.status_code != 201:
            return {"create_ms": create_ms, "create_status": resp.status_code, "create_error": resp.text[:2000], "run_id": None}

        run = resp.json()
        run_id = run["id"]
        outcome = {
            "create_ms": create_ms, "create_status": resp.status_code, "run_id": run_id,
            "employee_count": run.get("employee_count"), "total_gross": run.get("total_gross"), "total_net": run.get("total_net"),
            "confirm_attempted": do_confirm,
        }

        if not do_confirm:
            outcome["confirm_ms"] = None
            outcome["confirm_status"] = None
            return outcome

        t1 = time.perf_counter()
        resp2 = await client.post(f"/api/v1/payroll/runs/{run_id}/confirm", timeout=long_timeout)
        confirm_ms = (time.perf_counter() - t1) * 1000
        outcome["confirm_ms"] = confirm_ms
        outcome["confirm_status"] = resp2.status_code
        if resp2.status_code == 200:
            confirmed = resp2.json()
            outcome["confirmed_status_field"] = confirmed.get("status")
            outcome["confirmed_total_net"] = confirmed.get("total_net")
        else:
            outcome["confirm_error"] = resp2.text[:2000]
        return outcome


# =========================================================================
# Scenario 3 — 50 concurrent authenticated sessions + rate-limiter check
# =========================================================================


async def user_session(client: httpx.AsyncClient, email: str, password: str) -> list[tuple[str, int, float]]:
    steps: list[tuple[str, int, float]] = []
    t0 = time.perf_counter()
    try:
        r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    except Exception as exc:  # noqa: BLE001
        return [("login", 0, (time.perf_counter() - t0) * 1000)]
    steps.append(("login", r.status_code, (time.perf_counter() - t0) * 1000))
    if r.status_code != 200:
        return steps
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    for name, path, use_auth in [("me", "/api/v1/me", True), ("notifications", "/api/v1/notifications", True), ("health", "/health", False)]:
        t1 = time.perf_counter()
        try:
            rr = await client.get(path, headers=headers if use_auth else None)
            steps.append((name, rr.status_code, (time.perf_counter() - t1) * 1000))
        except Exception:  # noqa: BLE001
            steps.append((name, 0, (time.perf_counter() - t1) * 1000))

    extra = ROLE_EXTRA_ENDPOINT.get(email)
    if extra:
        t2 = time.perf_counter()
        try:
            rr = await client.get(extra, headers=headers)
            steps.append(("read_record", rr.status_code, (time.perf_counter() - t2) * 1000))
        except Exception:  # noqa: BLE001
            steps.append(("read_record", 0, (time.perf_counter() - t2) * 1000))
    return steps


async def concurrent_users_test(base_url: str, redis_url: str) -> dict:
    async with httpx.AsyncClient(base_url=base_url, timeout=30, limits=httpx.Limits(max_connections=200)) as client:
        tasks = [user_session(client, email, password) for email, password in DEMO_ACCOUNTS for _ in range(SESSIONS_PER_ACCOUNT)]
        t_start = time.perf_counter()
        all_steps = await asyncio.gather(*tasks)
        wall = time.perf_counter() - t_start

    flat = [s for session in all_steps for s in session]
    by_step: dict[str, list[Sample]] = {}
    for name, status_code, ms in flat:
        by_step.setdefault(name, []).append(Sample(status_code, ms))
    step_summary = {name: summarize(samples, wall) for name, samples in by_step.items()}

    login_statuses = [s[1] for s in (session[0] for session in all_steps if session)]
    logins_ok = sum(1 for c in login_statuses if c == 200)
    logins_429 = sum(1 for c in login_statuses if c == 429)

    # Did concurrent LEGITIMATE logins trip the limiter? They must not —
    # only failed attempts count (app/core/rate_limit.py). Checked two ways:
    # the HTTP status codes just observed, AND the Redis counters directly.
    rate_limit_state: dict[str, object] = {"logins_ok": logins_ok, "logins_429": logins_429, "total_sessions": len(all_steps)}
    try:
        import redis.asyncio as redis_asyncio

        r = redis_asyncio.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        acct_keys = [f"loginlimit:acct:{email}" for email, _ in DEMO_ACCOUNTS]
        values = await r.mget(acct_keys)
        rate_limit_state["post_test_account_counters"] = dict(zip((e for e, _ in DEMO_ACCOUNTS), values))
        ip_val = await r.get("loginlimit:ip:127.0.0.1")
        rate_limit_state["post_test_ip_counter"] = ip_val
        await r.aclose()
    except Exception as exc:  # noqa: BLE001
        rate_limit_state["redis_check_error"] = repr(exc)

    return {"wall_seconds": wall, "step_summary": step_summary, "rate_limit_state": rate_limit_state}


async def rate_limiter_positive_control(base_url: str, redis_url: str) -> dict:
    """Proves the limiter mechanism is actually alive (not just silent)
    before trusting concurrent_users_test's "zero 429s" as meaningful.
    Runs LAST and cleans up its own Redis keys immediately after, so it
    cannot poison the per-IP counter for any real login that follows from
    this same machine within the 15-minute window."""
    fake_email = "loadtest-ratelimit-probe@loadtest.invalid"
    attempts = []
    async with httpx.AsyncClient(base_url=base_url, timeout=15) as client:
        for attempt in range(1, 7):
            r = await client.post("/api/v1/auth/login", json={"email": fake_email, "password": "definitely-wrong-xyz"})
            attempts.append((attempt, r.status_code))

    result = {"attempts": attempts, "tripped_at": next((a for a, code in attempts if code == 429), None)}

    try:
        import redis.asyncio as redis_asyncio

        r = redis_asyncio.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        await r.delete(f"loginlimit:acct:{fake_email}", "loginlimit:ip:127.0.0.1")
        await r.aclose()
        result["cleaned_up"] = True
    except Exception as exc:  # noqa: BLE001
        result["cleanup_error"] = repr(exc)
    return result


# =========================================================================
# Orchestration
# =========================================================================


async def login(base_url: str, email: str, password: str) -> str:
    async with httpx.AsyncClient(base_url=base_url, timeout=15) as client:
        r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        if r.status_code != 200:
            raise RuntimeError(f"login failed for {email}: {r.status_code} {r.text}")
        return r.json()["access_token"]


async def main_async(args: argparse.Namespace) -> int:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)

    print("=" * 88)
    print("REAL LOAD TEST — dev-hardware baseline, NOT a production capacity claim (see docstring)")
    print(f"Target API : {args.base_url}")
    print(f"Target DB  : {settings.database_url.split('@')[-1]}  (from backend/.env, same as the live app)")
    print("=" * 88)

    if args.cleanup_only:
        print("\n--cleanup-only: deleting any LOADTEST-* invoices/customers, then exiting.")
        result = await cleanup_invoices_and_customers(engine)
        print(f"  invoices deleted:  {result['invoices_deleted']}")
        print(f"  customers deleted: {result['customers_deleted']}")
        print(f"  took {result['seconds']:.1f}s")
        await engine.dispose()
        return 0

    try:
        token = await login(args.base_url, args.admin_email, args.admin_password)
    except Exception as exc:
        print(f"FATAL: could not log in against {args.base_url} — is the server running? {exc}")
        await engine.dispose()
        return 1
    print(f"Logged in as {args.admin_email} OK.")

    ids = await fetch_master_ids(engine, args.admin_email)

    customers: list[dict] = []
    invoice_ids: list[str] = []
    employee_ids: list[str] = []

    if not args.skip_seed:
        print(f"\n--- Seeding {args.customer_count} customers + {args.invoice_count} invoices ---")
        t0 = time.perf_counter()
        customers = await seed_customers(engine, args.customer_count, ids)
        inv_result = await seed_invoices(engine, args.invoice_count, customers, ids)
        invoice_ids = inv_result["invoice_ids"]
        print(f"  {len(invoice_ids)} invoices + {inv_result['line_item_count']} line items in {time.perf_counter() - t0:.1f}s")

        print(f"\n--- Seeding {args.employee_count} employees + salary structures ---")
        t0 = time.perf_counter()
        employee_ids = await seed_employees(engine, args.employee_count, ids)
        print(f"  {len(employee_ids)} employees + salary structures in {time.perf_counter() - t0:.1f}s")
    else:
        print("\n--skip-seed: reusing whatever LOADTEST-* data already exists.")
        async with engine.connect() as conn:
            cust_rows = (await conn.execute(text("SELECT id, company_name FROM customers WHERE customer_code LIKE :p"), {"p": f"{MARKER}-CUST-%"})).all()
            customers = [{"id": row[0], "company_name": row[1]} for row in cust_rows]
            employee_ids = list((await conn.execute(text("SELECT id FROM employees WHERE employee_code LIKE :p"), {"p": f"{MARKER}-%"})).scalars().all())
        print(f"  found {len(customers)} customers, {len(employee_ids)} employees already seeded")

    concurrency_levels = [int(x) for x in args.concurrency_levels.split(",")]

    list_results: dict = {}
    if not args.skip_list_test:
        print(f"\n--- GET /api/v1/invoices load test @ concurrency {concurrency_levels} ---")
        list_results = await list_endpoint_load_test(args.base_url, token, customers, concurrency_levels)
    else:
        print("\n--skip-list-test: skipped.")

    payroll_result: dict = {}
    run_id = None
    if not args.skip_payroll and employee_ids:
        print(f"\n--- Payroll at scale: {len(employee_ids)} employees, confirm={'YES (permanent)' if args.confirm_payroll else 'no (preview only)'} ---")
        if not args.confirm_payroll:
            print("  (pass --confirm-payroll to also time POST /confirm — see the script docstring for why this is opt-in)")
        payroll_result = await payroll_scale_test(args.base_url, token, employee_ids, args.confirm_payroll)
        run_id = payroll_result.get("run_id")
        print(f"  create/preview: {payroll_result.get('create_status')} in {payroll_result.get('create_ms', 0):.0f}ms "
              f"(employee_count={payroll_result.get('employee_count')})")
        if args.confirm_payroll:
            print(f"  confirm:        {payroll_result.get('confirm_status')} in {payroll_result.get('confirm_ms', 0):.0f}ms")
    else:
        print("\n--skip-payroll or no employees: skipped.")

    concurrency_result: dict = {}
    probe_result: dict = {}
    if not args.skip_concurrency:
        print(f"\n--- {len(DEMO_ACCOUNTS) * SESSIONS_PER_ACCOUNT} concurrent authenticated sessions "
              f"({SESSIONS_PER_ACCOUNT} x {len(DEMO_ACCOUNTS)} accounts) ---")
        concurrency_result = await concurrent_users_test(args.base_url, settings.redis_url)
        for name, r in concurrency_result["step_summary"].items():
            print(fmt_row(name, r))
        print(f"  logins ok={concurrency_result['rate_limit_state']['logins_ok']} "
              f"429={concurrency_result['rate_limit_state']['logins_429']} "
              f"of {concurrency_result['rate_limit_state']['total_sessions']}")
        print(f"  post-test Redis account counters: {concurrency_result['rate_limit_state'].get('post_test_account_counters')}")
        print(f"  post-test Redis IP counter (127.0.0.1): {concurrency_result['rate_limit_state'].get('post_test_ip_counter')}")

        print("\n--- Rate limiter positive control (deliberate wrong-password attempts) ---")
        probe_result = await rate_limiter_positive_control(args.base_url, settings.redis_url)
        print(f"  attempts: {probe_result['attempts']}")
        print(f"  tripped at attempt #{probe_result['tripped_at']} (expected #6, since threshold is 5 and only the 6th check sees 5 prior failures)")
    else:
        print("\n--skip-concurrency: skipped.")

    cleanup_result: dict = {}
    if not args.no_cleanup:
        print("\n--- Cleanup: deleting seeded invoices/customers ---")
        cleanup_result = await cleanup_invoices_and_customers(engine)
        print(f"  invoices deleted:  {cleanup_result['invoices_deleted']}")
        print(f"  customers deleted: {cleanup_result['customers_deleted']}")
        print(f"  took {cleanup_result['seconds']:.1f}s")

        print("\n--- Payroll/employee data: attempting cleanup only if it is actually safe ---")
        payroll_cleanup_msg = await cleanup_payroll_if_safe(engine, run_id, employee_ids)
        print(f"  {payroll_cleanup_msg}")
    else:
        print("\n--no-cleanup: leaving all seeded data in place.")

    residue = await payroll_residue_report(engine, run_id)
    print("\n--- Final residue check (rows still in the DB matching LOADTEST-*) ---")
    print(f"  employees: {residue['employee_count']}  salary_structures: {residue['structure_count']}  "
          f"payslips for this run: {residue['payslip_count']}  run status: {residue['run_status']}  "
          f"email_send_log (loadtest.*@loadtest.invalid): {residue['email_log_count']}")

    await engine.dispose()

    print("\n" + "=" * 88)
    print("Done. See this script's own docstring for what these numbers do and do not claim.")
    print("=" * 88)
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Real load test for the Company Management Software backend (replaces load_check.py).")
    p.add_argument("--base-url", default="http://127.0.0.1:8001")
    p.add_argument("--admin-email", default=ADMIN_EMAIL_DEFAULT)
    p.add_argument("--admin-password", default=ADMIN_PASSWORD_DEFAULT)
    p.add_argument("--invoice-count", type=int, default=10500)
    p.add_argument("--customer-count", type=int, default=40)
    p.add_argument("--employee-count", type=int, default=500)
    p.add_argument("--concurrency-levels", default="1,10,50")
    p.add_argument("--confirm-payroll", action="store_true", help="Actually call POST /confirm — PERMANENT, see docstring")
    p.add_argument("--skip-seed", action="store_true", help="Reuse LOADTEST-* data a previous run already seeded")
    p.add_argument("--skip-list-test", action="store_true")
    p.add_argument("--skip-payroll", action="store_true")
    p.add_argument("--skip-concurrency", action="store_true")
    p.add_argument("--no-cleanup", action="store_true", help="Leave the seeded invoice/customer data in place")
    p.add_argument("--cleanup-only", action="store_true", help="Just delete LOADTEST-* invoices/customers and exit")
    return p.parse_args(argv)


def main() -> None:
    args = parse_args(sys.argv[1:])
    exit_code = asyncio.run(main_async(args))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
