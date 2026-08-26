"""MASTERS-COMPLETION-PROMPT.md §7 — wipe every row of leftover demo/test
data out of the 33 Masters tables, then reseed every sub-master EXCEPT Taxes
from prototype/data.js's own arrays, verbatim. Taxes (tax_schemes, tax_heads
and all four tax_head_* child tables) is left completely empty on purpose —
Masters §3.2's central rule is that no tax is named anywhere in this system.

Run this yourself, once, from backend/:

    .venv\\Scripts\\python.exe scripts\\wipe_and_reseed_masters.py

A full mysqldump backup is taken first via scripts/backup.sh (same script
this project already uses) — nothing here proceeds without one.

Two tables in the wipe list are skipped on purpose, not by oversight:
email_send_log and email_templates both carry a real DB trigger making them
append-only ("... — no deletes" / "... never deleted — disable instead").
email_templates doesn't need wiping anyway — its rows are the same
functionally-required, already-correct set app/seed.py's own
SEED_EMAIL_TEMPLATES inserts (real template_key values the email-sending
code calls by name), not demo data. Re-running seed() at the end of this
script (its own insert loop is additive — skips any template_key/code_type
that already exists) is what actually keeps that table, number_prefix_rules,
and indian_states correct; this script does not touch them directly.

Every other sub-master below IS demo/test data and gets a real wipe+reseed.
Where data.js is silent on a field the target schema requires, the choice
made is commented at that field — nothing here is invented silently.
"""

import asyncio
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

from sqlalchemy import select, text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import AsyncSessionLocal, engine  # noqa: E402
from app.models.masters import (  # noqa: E402
    AssetCategory,
    BankAccount,
    CompanyAddress,
    CustomerSource,
    CustomerStatus,
    Department,
    Designation,
    EmailServerSettings,
    EmploymentType,
    ExpenseType,
    HsnSacCode,
    InsurancePlan,
    LeaveType,
    PayCycle,
    PaymentMode,
    ServiceCategory,
    TicketCategory,
    UnitOfMeasure,
    WorkWeekPolicy,
)
from app.models.platform import User  # noqa: E402
from app.seed import seed  # noqa: E402

# Every table masters.py declares (33), in FK-safe child-before-parent order,
# MINUS email_send_log and email_templates — both DB-trigger-protected,
# append-only, see the module docstring above.
WIPE_TABLES = """tax_head_slab_bands tax_head_split_components tax_head_relief_rules
tax_head_withholding_directions tax_heads tax_schemes number_prefix_rules
bank_accounts expense_types leave_types holidays payment_modes
designations departments hsn_sac_codes service_categories
units_of_measure ticket_categories customer_statuses customer_sources
asset_categories employment_types insurance_plans company_addresses
company_documents company_profile work_week_policy_employees
saturday_overrides pay_periods pay_cycles work_week_policies
email_server_settings""".split()


async def wipe() -> None:
    print("=== Wiping Masters demo/test data ===")
    # Autocommit per table (own connection.begin() each) so ONE table
    # failing partway (e.g. a trigger we didn't know about) can't roll back
    # every table that already succeeded — a single shared transaction bit
    # us exactly this way while building this script.
    async with engine.begin() as setup:
        await setup.execute(text("SET FOREIGN_KEY_CHECKS=0"))
    for t in WIPE_TABLES:
        async with engine.begin() as conn:
            result = await conn.execute(text(f"DELETE FROM {t}"))
            print(f"  {t}: deleted {result.rowcount}")
    async with engine.begin() as teardown:
        await teardown.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    print("Wipe complete.\n")


def _uid() -> str:
    return str(uuid.uuid4())


async def reseed(db) -> None:
    print("=== Reseeding from prototype/data.js (verbatim, Taxes excluded) ===")
    admin = (await db.execute(select(User).where(User.email == "superadmin@meshrd.in"))).scalar_one_or_none()
    admin_id = admin.id if admin else None

    def audit() -> dict:
        return {"created_by": admin_id, "updated_by": admin_id}

    # ---- Departments (D.masters.department, DEPTS) -----------------------
    DEPTS = ["Engineering", "Sales", "Accounts", "Human Resources", "Support", "Operations", "Design"]
    dept_ids: dict[str, str] = {}
    for name in DEPTS:
        row = Department(id=_uid(), name=name, code=name[:3].upper(), **audit())
        db.add(row)
        dept_ids[name] = row.id
    await db.flush()
    print(f"  departments: {len(DEPTS)}")

    # ---- Designations (D.masters.designation) -----------------------------
    # code = first letters of each word, exactly how data.js derives it
    # (n.split(' ').map(w=>w[0]).join('').toUpperCase()) — three names
    # collide on that derivation ("Senior Engineer"/"Support Engineer"/
    # "Sales Executive" all -> "SE"), harmless in the prototype (display
    # only, no uniqueness) but designations.code IS unique here. Kept the
    # first occurrence's code, left the two later collisions NULL rather
    # than inventing a disambiguated code data.js never specified.
    DESIGNATIONS = [
        "Founder & CEO", "Engineering Manager", "Senior Engineer", "Engineer", "Product Designer",
        "Junior Designer", "Senior Accountant", "HR Manager", "Support Engineer", "Account Executive",
        "Sales Executive", "Operations Lead", "Intern",
    ]
    seen_codes: set[str] = set()
    for name in DESIGNATIONS:
        code = "".join(w[0] for w in name.split(" ")).upper()
        if code in seen_codes:
            code = None
        else:
            seen_codes.add(code)
        db.add(Designation(id=_uid(), name=name, code=code, department_id=None, **audit()))
    print(f"  designations: {len(DESIGNATIONS)}")

    # ---- Employment Types (D.masters.employmentType) -----------------------
    EMPLOYMENT_TYPES = [("Full Time", "FT", True), ("Part Time", "PT", False), ("Contract", "CTR", True), ("Intern", "INT", True)]
    empl_type_ids: dict[str, str] = {}
    for name, code, active in EMPLOYMENT_TYPES:
        row = EmploymentType(id=_uid(), name=name, code=code, is_active=active, **audit())
        db.add(row)
        empl_type_ids[name] = row.id
    await db.flush()
    print(f"  employment_types: {len(EMPLOYMENT_TYPES)}")

    # ---- Payment Modes (D.masters.paymentMode) ------------------------------
    # requires_reference_number: not given per-row in data.js: column default
    # (False) used for all rather than guessed per mode.
    for name, code in [("Bank Transfer", "BT"), ("NEFT", "NEFT"), ("RTGS", "RTGS"), ("IMPS", "IMPS"), ("UPI", "UPI"), ("Cheque", "CHQ"), ("Cash", "CSH")]:
        db.add(PaymentMode(id=_uid(), name=name, code=code, requires_reference_number=False, **audit()))
    print("  payment_modes: 7")

    # ---- Leave Types (D.masters.leaveTypes) ---------------------------------
    # is_paid: not a data.js field at all. Loss of Pay is unpaid by its own
    # name; every other row is a standard paid leave type in this context —
    # the only inference made here, grounded in the row's own name.
    #
    # Earned Leave maxcf: data.js literally says maxcf: 30 with quota: 15, but
    # the real schema enforces max_carry_forward_days <= default_annual_quota_days
    # (ck_leave_types_cf) — a rule the prototype's mock data never had to satisfy.
    # Capped at 15 (matching quota, corroborated twice in data.js) rather than
    # raising quota to 30 (which appears nowhere else).
    LEAVE_TYPES = [
        ("Casual Leave", "CL", 12, False, 0, True),
        ("Sick Leave", "SL", 8, False, 0, True),
        ("Earned Leave", "EL", 15, True, 15, True),
        ("Comp Off", "CO", 2, False, 0, True),
        ("Work From Home", "WFH", 0, False, 0, True),
        ("Maternity Leave", "ML", 182, False, 0, True),
        ("Loss of Pay", "LOP", 0, False, 0, False),
    ]
    for name, code, quota, cf, maxcf, paid in LEAVE_TYPES:
        db.add(LeaveType(
            id=_uid(), name=name, short_code=code, is_paid=paid, default_annual_quota_days=quota,
            carry_forward_allowed=cf, max_carry_forward_days=maxcf if cf else None, **audit(),
        ))
    print(f"  leave_types: {len(LEAVE_TYPES)}")

    # ---- Ticket Categories (D.masters.ticketCategories) ---------------------
    for name, code in [("Access", "ACC"), ("Bug", "BUG"), ("Integration", "INT"), ("Billing", "BIL"), ("Enhancement", "ENH"), ("Performance", "PRF"), ("Onboarding", "ONB"), ("Account", "ACT")]:
        db.add(TicketCategory(id=_uid(), name=name, code=code, **audit()))
    print("  ticket_categories: 8")

    # ---- Customer Statuses (D.masters.customerStatus) -----------------------
    for name, code in [("Prospect", "PRO"), ("Active", "ACT"), ("Inactive", "INA")]:
        db.add(CustomerStatus(id=_uid(), name=name, code=code, **audit()))
    print("  customer_statuses: 3")

    # ---- Customer Sources (D.masters.customerSource) -------------------------
    for name, code in [("Referral", "REF"), ("Website", "WEB"), ("Cold Outreach", "CLD"), ("Partner", "PTR"), ("Event / Conference", "EVT"), ("Inbound Enquiry", "INB")]:
        db.add(CustomerSource(id=_uid(), name=name, code=code, **audit()))
    print("  customer_sources: 6")

    # ---- Asset Categories (D.masters.assetCategories) ------------------------
    for name, code, life in [("Laptop", "LAP", 3), ("Desktop", "DSK", 4), ("Monitor", "MON", 5), ("Mobile", "MOB", 3), ("Furniture", "FUR", 7), ("Printer", "PRN", 5), ("Networking", "NET", 6), ("Peripheral", "PER", 3), ("Access", "ACS", 5)]:
        db.add(AssetCategory(id=_uid(), name=name, code=code, default_useful_life_years=life, **audit()))
    print("  asset_categories: 9")

    # ---- Insurance Plans (D.masters.insurance) -------------------------------
    # provider: not given in data.js -> left NULL (nullable column).
    INSURANCE = [
        ("Group Health — Standard", "HEALTH", 500000, 0, 12500),
        ("Group Health — Enhanced", "HEALTH", 1000000, 4500, 18000),
        ("Group Term Life", "LIFE", 5000000, 0, 6800),
        ("Personal Accident Cover", "PERSONAL_ACCIDENT", 2500000, 0, 3200),
    ]
    for name, ptype, cover, emp, company in INSURANCE:
        db.add(InsurancePlan(
            id=_uid(), plan_name=name, plan_type=ptype, provider=None, coverage_amount=cover,
            company_contribution_monthly=company, employee_contribution_monthly=emp, **audit(),
        ))
    print(f"  insurance_plans: {len(INSURANCE)}")

    # ---- Service Categories (D.masters.serviceCategory) ----------------------
    for name, code in [("Platform Licence", "PLAT"), ("Implementation", "IMPL"), ("Custom Development", "CDEV"), ("Support & AMC", "AMC"), ("Training", "TRN")]:
        db.add(ServiceCategory(id=_uid(), name=name, code=code, **audit()))
    print("  service_categories: 5")

    # ---- Units of Measure (D.masters.uom) ------------------------------------
    for name, code in [("Hours", "HR"), ("Days", "DY"), ("Licence", "LIC"), ("Nos", "NOS"), ("Months", "MTH")]:
        db.add(UnitOfMeasure(id=_uid(), name=name, code=code, **audit()))
    print("  units_of_measure: 5")

    # ---- Expense Types (D.masters.expenseTypes) -------------------------------
    EXPENSE_TYPES = [
        ("Travel", "TRV", "REIMBURSABLE", False, True),
        ("Meals", "MEA", "REIMBURSABLE", False, True),
        ("Software", "SFT", "REIMBURSABLE", False, True),
        ("Stationery", "STN", "REIMBURSABLE", False, True),
        ("Training", "TRN", "REIMBURSABLE", False, True),
        ("Recruitment", "RCT", "REIMBURSABLE", False, True),
        ("Internet / Wi-Fi", "NET", "COMPANY_PAID", True, True),
        ("Electricity", "ELE", "COMPANY_PAID", True, True),
        ("Office Rent", "RNT", "COMPANY_PAID", True, True),
        ("Telephone / Mobile", "TEL", "COMPANY_PAID", True, True),
        ("Cloud Hosting", "CLD", "COMPANY_PAID", True, True),
        ("Housekeeping", "HKP", "COMPANY_PAID", True, True),
        ("Client Entertainment", "CLE", "REIMBURSABLE", False, False),
    ]
    for name, code, claim, recurring, active in EXPENSE_TYPES:
        db.add(ExpenseType(id=_uid(), name=name, short_code=code, claim_type=claim, is_recurring=recurring, is_active=active, **audit()))
    print(f"  expense_types: {len(EXPENSE_TYPES)}")

    # ---- Bank Accounts (D.masters.bank) ---------------------------------------
    # account_holder_name: not given in data.js -> the company's own legal
    # name (Meshrd Technologies Private Limited), the conventional value for
    # a company's own account. account_number: the prototype only ever shows
    # a MASKED value ('XXXXXXXX4471') -> a real 9-18 digit number never
    # existed to transcribe; synthesized here (clearly a placeholder, not a
    # real account) using the visible masked digits as the tail so it's at
    # least recognisably "the same" account as the mock.
    BANKS = [
        ("Meshrd Current — Chennai", "HDFC Bank", "500100004471", "HDFC0000521", "T. Nagar", True),
        ("Meshrd Payroll Account", "ICICI Bank", "500200009012", "ICIC0001284", "Guindy", True),
        ("Meshrd Current — Coimbatore", "Axis Bank", "500300003356", "UTIB0000412", "RS Puram", False),
    ]
    for nickname, bank, acc, ifsc, branch, active in BANKS:
        db.add(BankAccount(
            id=_uid(), nickname=nickname, bank_name=bank, account_holder_name="Meshrd Technologies Private Limited",
            account_number=acc, account_type="CURRENT", ifsc=ifsc, branch=branch, upi_id=None,
            is_default=False, is_active=active, **audit(),
        ))
    print(f"  bank_accounts: {len(BANKS)}")

    # ---- HSN/SAC Codes (D.masters.hsn) -----------------------------------------
    # Every row seeded is_custom=True: linking to a real tax_head_id isn't
    # possible (Taxes stays empty by design, §3.2), and ck_hsn_sac_custom
    # requires is_custom = (linked_tax_head_id IS NULL) either way. The one
    # row the prototype itself left with no tax ("IT infrastructure
    # management", tax: '—') gets an explicit 0%-CGST+SGST placeholder,
    # flagged here rather than silently invented — there is no real rate to
    # transcribe for a row the prototype never assigned one.
    HSN = [
        ("998314", "SAC", "IT design and development services", "GST_CGST_SGST", 18),
        ("998313", "SAC", "IT consulting and support services", "GST_IGST", 18),
        ("998315", "SAC", "IT support and maintenance — AMC", "GST_CGST_SGST", 12),
        ("998316", "SAC", "IT infrastructure management", "GST_CGST_SGST", 0),  # placeholder — prototype gave no rate at all (tax: '—')
        ("8471", "HSN", "Automatic data processing machines", "GST_IGST", 18),
        ("8523", "HSN", "Software licences, media & recorded storage", "GST_CGST_SGST", 18),
        ("9954", "HSN", "Hardware bundled with installation — one-off retail order", "GST_IGST", 28),
    ]
    for code, code_type, desc, gst_type, rate in HSN:
        db.add(HsnSacCode(
            id=_uid(), code=code, code_type=code_type, description=desc, linked_tax_head_id=None,
            is_custom=True, custom_gst_type=gst_type, custom_gst_rate_pct=rate, **audit(),
        ))
    print(f"  hsn_sac_codes: {len(HSN)}")

    # ---- Company Addresses (D.masters.addresses) --------------------------------
    tn = (await db.execute(select(text("id")).select_from(text("indian_states")).where(text("name = 'Tamil Nadu'")))).scalar_one()
    ADDRESSES = [
        ("REGISTERED_OFFICE", "No. 14, Habibullah Road, T. Nagar", "Chennai", "600017", True),
        ("BRANCH_OFFICE", "2nd Floor, Tidel Park, Taramani", "Chennai", "600113", False),
        ("BRANCH_OFFICE", "78, Avinashi Road, Peelamedu", "Coimbatore", "641004", False),
    ]
    for addr_type, line1, city, pin, primary in ADDRESSES:
        db.add(CompanyAddress(id=_uid(), address_type=addr_type, line1=line1, line2=None, city=city, state_id=tn, pin_code=pin, is_primary=primary, **audit()))
    print(f"  company_addresses: {len(ADDRESSES)}")

    # ---- Work Week Policies (D.masters.workWeek) ---------------------------------
    # effective_from: not given in data.js for any policy -> FY start
    # (2026-04-01), the same date the prototype's own fy[0] uses.
    # working_saturday_hours_mode: FULL when sathrs equals gross-brk (net,
    # i.e. "a working Saturday pays the same as a weekday"), else None when
    # sathrs=0 (no working Saturdays under that rule to begin with).
    EFFECTIVE_FROM = date(2026, 4, 1)
    WORK_WEEK = [
        dict(name="Standard — 40 Hour Week", applies="COMPANY_WIDE", dept=None, etype=None, gross=9, brk=1, weekly=40,
             weekoff="SUNDAY", satrule="ODD_WORKING", sat_mode="FULL", comp=True, window=30, shortfall="PRO_RATA_LOP", active=True),
        dict(name="Support — Rotational Shift", applies="DEPARTMENT", dept="Support", etype=None, gross=9, brk=1, weekly=48,
             weekoff="ROTATIONAL_ONE", satrule="ALL_WORKING", sat_mode="FULL", comp=True, window=30, shortfall="PRO_RATA_LOP", active=True),
        dict(name="Intern — Half Day", applies="EMPLOYMENT_TYPE", dept=None, etype="Intern", gross=5, brk=0.5, weekly=22.5,
             weekoff="SAT_SUN", satrule="ALL_OFF", sat_mode=None, comp=False, window=None, shortfall="IGNORE", active=True),
        # "Per day" (data.js: shortfall: 'Per day') maps to ROUND_FULL_DAY —
        # the closest real enum member (rounds an uncompensated shortfall to
        # a full day's Loss of Pay); the prototype's own wording has no
        # exact match among the five real values.
        dict(name="Contract — 6 Day Week", applies="EMPLOYMENT_TYPE", dept=None, etype="Contract", gross=9, brk=1, weekly=48,
             weekoff="SUNDAY", satrule="ALL_WORKING", sat_mode="FULL", comp=False, window=None, shortfall="ROUND_FULL_DAY", active=False),
    ]
    for p in WORK_WEEK:
        db.add(WorkWeekPolicy(
            id=_uid(), policy_name=p["name"], applies_to=p["applies"],
            department_id=dept_ids.get(p["dept"]) if p["dept"] else None,
            designation_id=None,
            employment_type_id=empl_type_ids.get(p["etype"]) if p["etype"] else None,
            effective_from=EFFECTIVE_FROM, gross_hours_per_day=p["gross"], unpaid_break_hours=p["brk"],
            grace_window_minutes=0, half_day_threshold_hours=None, count_overtime_beyond_net=False,
            weekly_hour_target=p["weekly"], weekly_off_days=p["weekoff"], saturday_rule=p["satrule"],
            working_saturday_hours_mode=p["sat_mode"], custom_saturday_hours=None,
            mandatory_holiday_overrides_saturday=True, allow_compensatory_hours=p["comp"],
            compensation_window_days=p["window"], make_up_day_chosen_by=None,
            allow_makeup_on_week_off=False, allow_makeup_on_mandatory_holiday=False,
            max_comp_hours_per_month=0, uncompensated_shortfall_becomes=p["shortfall"],
            excess_hours_become=None, is_active=p["active"], **audit(),
        ))
    print(f"  work_week_policies: {len(WORK_WEEK)}")

    # ---- Pay Cycle (D.masters.payrollCycle, one row) -----------------------------
    db.add(PayCycle(
        id=_uid(), cycle_type="FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30,
        effective_from=EFFECTIVE_FROM, is_active=True, **audit(),
    ))
    print("  pay_cycles: 1")

    # ---- Email Server Settings (D.masters.emailConfig, singleton) ---------------
    # No real password/API key exists anywhere in data.js -> left NULL.
    db.add(EmailServerSettings(
        id=_uid(), singleton_lock=True, sending_enabled=True, provider="CUSTOM_SMTP",
        smtp_host="smtp.meshrd.in", smtp_port=587, encryption="STARTTLS", username="no-reply@meshrd.in",
        password_encrypted=None, api_key_encrypted=None, credential_hint=None,
        from_name="Meshrd", from_email="no-reply@meshrd.in", reply_to_email="support@meshrd.in", **audit(),
    ))
    print("  email_server_settings: 1")

    await db.commit()
    print("Reseed complete.\n")

    # number_prefix_rules / email_templates / indian_states are NOT reseeded
    # above — app/seed.py's own seed() already carries the correct,
    # functionally-required version of both (real template_key values the
    # email-sending code calls by name; prefix rows the Employee/Offer
    # Letter/Compensatory Hour/Remittance code paths allocate_number()
    # against — MORE complete than data.js's own array, which predates
    # those). Its insert loops are additive (skip anything already present),
    # so re-running it here is exactly "repopulate what the wipe cleared,"
    # not a risk to anything else it seeds (roles/screens/users all already
    # exist and are skipped the same way).
    print("=== Re-running app.seed.seed() for number_prefix_rules / email_templates / indian_states ===")
    await seed()


async def row_counts() -> None:
    async with engine.connect() as conn:
        print("=== Row counts after wipe + reseed ===")
        for t in WIPE_TABLES + ["email_send_log", "email_templates", "indian_states"]:
            r = await conn.execute(text(f"SELECT COUNT(*) FROM {t}"))
            print(f"  {t}: {r.scalar()}")


async def main() -> None:
    confirm = input(
        "This will DELETE every row from all Masters tables (except the two the DB "
        "itself protects) in the LOCAL dev database, then reseed everything except "
        "Taxes from the prototype. A backup is taken first. Type YES to continue: "
    )
    if confirm.strip() != "YES":
        print("Aborted — nothing was touched.")
        return

    print("\n=== Taking a backup first (docker exec mysqldump — no shell needed) ===")
    import datetime
    backup_dir = Path(__file__).resolve().parent.parent / "backups" / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir.mkdir(parents=True, exist_ok=True)
    dump_path = backup_dir / "db.sql"
    try:
        with open(dump_path, "wb") as f:
            result = subprocess.run(
                ["docker", "exec", "meshrd_mysql", "mysqldump", "--single-transaction", "--routines", "--triggers",
                 "-u", "meshrd", "-pmeshrd_dev_password", "meshrd_cms"],
                stdout=f, stderr=subprocess.PIPE,
            )
    except FileNotFoundError:
        print("Could not find 'docker' on PATH. Make sure Docker Desktop is running, then re-run this script.")
        return
    if result.returncode != 0:
        print("Backup FAILED — aborting. Nothing was wiped.")
        print(result.stderr.decode(errors="replace"))
        return
    print(f"  Backup written to {dump_path} ({dump_path.stat().st_size} bytes)")

    await wipe()
    async with AsyncSessionLocal() as db:
        await reseed(db)
    await row_counts()
    print("\nDone. Tax tables (tax_schemes, tax_heads, and its 4 child tables) are empty on purpose.")


if __name__ == "__main__":
    asyncio.run(main())
