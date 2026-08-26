"""GET /api/v1/files/{file_id} authorization — app/services/file_access.py.

The gap these cover: the download endpoint used to require only
`get_current_user`, so ANY authenticated user holding a StoredFile UUID could
fetch the bytes. Verified live against the dev database before the fix — a
plain Employee pulled two other employees' payslip PDFs (2735 and 3019 bytes
of real `%PDF`) with HTTP 200. Nothing in this suite would have caught it:
there were no route-level tests for files.py at all.

Style follows tests/test_expense_toggles.py — conftest's db_session +
seed_canonical (the real seeded RBAC policy, so 'own'/'full'/'none' behave
exactly as production), with app.main's real FastAPI app wired through an
httpx.AsyncClient and get_db/get_current_user overridden onto that session.

`file_storage.read_bytes` is monkeypatched rather than writing real files: the
authorization decision happens before any disk read, and the existing suite is
hermetic (in-memory SQLite, no filesystem side effects). A test that gets 200
therefore proves the check passed AND that real bytes were served.
"""

import uuid
from datetime import date, datetime

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.employee import Employee, EmployeeDocument
from app.models.finance import ExpenseClaim
from app.models.masters import CompanyProfile
from app.models.payroll import Payslip
from app.models.platform import StoredFile, User
from app.services import file_storage
from tests.conftest import seed_canonical

FILE_BYTES = b"%PDF-1.4 pretend document"


# ================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session, monkeypatch):
    async def _get_db_override():
        yield db_session

    # Every StoredFile in this module is a DB row with no file on disk; the
    # bytes themselves are not what's under test.
    monkeypatch.setattr(file_storage, "read_bytes", lambda stored_file: FILE_BYTES)

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


# =========================================================== shared scaffolding
async def _seed_base(db_session):
    ids = await seed_canonical(db_session)
    users = {
        code: await db_session.get(User, ids[f"user:{code}"])
        for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")
    }
    return ids, users


async def _make_user_with_employee(db_session, ids: dict, role_code: str, label: str) -> tuple[User, Employee]:
    """A login plus the Employee row it is linked through. Ownership in this
    codebase is an employee_id, never a user_id (app/services/org_scope.py),
    so a user with no Employee row can never satisfy an 'own' scope.
    """
    user = User(
        id=str(uuid.uuid4()), email=f"{label}@test.local", password_hash="x",
        full_name=label, role_id=ids[f"role:{role_code}"],
    )
    db_session.add(user)
    await db_session.flush()
    employee = Employee(
        id=str(uuid.uuid4()), employee_code=f"EMP-{label}", code_financial_year_id="fy-1",
        first_name=label, email=f"{label}.emp@test.local", department_id="dept-1",
        designation_id="desig-1", employment_type_id="emptype-1", joining_date=date(2020, 1, 1),
        user_id=user.id,
    )
    db_session.add(employee)
    await db_session.commit()
    return user, employee


async def _make_file(db_session, *, uploaded_by: str | None = None) -> StoredFile:
    tag = uuid.uuid4().hex
    row = StoredFile(
        id=str(uuid.uuid4()), storage_key=tag, original_filename="secret.pdf",
        mime_type="application/pdf", size_bytes=len(FILE_BYTES), content_hash=tag,
        uploaded_by=uploaded_by,
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _get(client: AsyncClient, file_id: str):
    return await client.get(f"/api/v1/files/{file_id}")


# ============ 1 — the headline: another employee's ID proof is not reachable
async def test_employee_cannot_download_another_employees_document(db_session, client):
    ids, users = await _seed_base(db_session)
    owner_user, owner_employee = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "owner")
    other_user, _ = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "stranger")

    # Uploaded by HR, not by the owner — so a pass here is the OWNERSHIP path,
    # not file_access's "you may re-read your own upload" allowance.
    stored = await _make_file(db_session, uploaded_by=users["HR"].id)
    db_session.add(
        EmployeeDocument(
            id=str(uuid.uuid4()), employee_id=owner_employee.id, document_type="ID_PROOF",
            file_id=stored.id, status="PENDING_VERIFICATION", uploaded_at=date.today(),
            uploaded_by_user_id=users["HR"].id, source="HR_UPLOAD",
        )
    )
    await db_session.commit()

    _as(other_user)
    denied = await _get(client, stored.id)
    assert denied.status_code == 403, "another employee's ID proof must not be downloadable by UUID"

    _as(owner_user)
    allowed = await _get(client, stored.id)
    assert allowed.status_code == 200, allowed.text
    assert allowed.content == FILE_BYTES

    # employee.documents is 'full' for HR and Super Admin — the cross-employee
    # verification queue must keep working.
    for code in ("HR", "SUPER_ADMIN"):
        _as(users[code])
        resp = await _get(client, stored.id)
        assert resp.status_code == 200, f"{code} lost access: {resp.text}"


# ================================ 2 — a salary document belonging to someone else
async def test_employee_cannot_download_another_employees_payslip(db_session, client):
    ids, users = await _seed_base(db_session)
    owner_user, owner_employee = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "payowner")
    other_user, _ = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "paystranger")

    stored = await _make_file(db_session, uploaded_by=users["SUPER_ADMIN"].id)
    db_session.add(
        Payslip(
            id=str(uuid.uuid4()), payroll_run_id="run-1", payroll_run_employee_id="pre-1",
            employee_id=owner_employee.id, financial_year_id="fy-1",
            pay_period_start=date(2026, 4, 1), pay_period_end=date(2026, 4, 30),
            salary_credit_date=date(2026, 5, 1), pay_cycle_type_snapshot="CALENDAR_MONTH",
            salary_credit_day_snapshot=1, period_month=4, period_year=2026,
            employee_code_snapshot=owner_employee.employee_code,
            employee_name_snapshot=owner_employee.first_name,
            generated_at=datetime(2026, 5, 1), generated_by=users["SUPER_ADMIN"].id,
            pdf_file_id=stored.id,
        )
    )
    await db_session.commit()

    # payroll.my_payslips is seeded mode='full' for EVERY role, and the route
    # ignores that mode and hard-filters to the caller's own employee id. If
    # file_access trusted `perms.mode` here instead of treating the "my ..."
    # screens as always-own, this assertion is what would fail.
    _as(other_user)
    assert (await _get(client, stored.id)).status_code == 403

    _as(owner_user)
    mine = await _get(client, stored.id)
    assert mine.status_code == 200, mine.text
    assert mine.content == FILE_BYTES

    # payroll.payslips_admin: 'full' for Accountant/HR/Super Admin, 'none' for Manager.
    for code in ("ACCOUNTANT", "HR", "SUPER_ADMIN"):
        _as(users[code])
        assert (await _get(client, stored.id)).status_code == 200, f"{code} lost payslip access"
    _as(users["MANAGER"])
    assert (await _get(client, stored.id)).status_code == 403, "Manager has no payslip screen at all"


# ========================================= 3 — expense receipts follow the claim
async def test_expense_receipt_reaches_its_claimant_and_the_accountant_only(db_session, client):
    ids, users = await _seed_base(db_session)
    owner_user, owner_employee = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "claimant")
    other_user, _ = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "notclaimant")

    stored = await _make_file(db_session, uploaded_by=owner_user.id)
    db_session.add(
        ExpenseClaim(
            id=str(uuid.uuid4()), employee_id=owner_employee.id, financial_year_id="fy-1",
            expense_type_id="et-1", claim_type="REIMBURSABLE", expense_type_name_snapshot="Travel",
            amount=100, expense_date=date(2026, 4, 5), description="cab",
            receipt_stored_file_id=stored.id, status="PENDING", submitted_at=date.today(),
        )
    )
    await db_session.commit()

    _as(other_user)
    assert (await _get(client, stored.id)).status_code == 403, "someone else's receipt"

    _as(owner_user)
    assert (await _get(client, stored.id)).status_code == 200

    # expense.all_expenses / expense.approvals are 'full' for Accountant.
    _as(users["ACCOUNTANT"])
    assert (await _get(client, stored.id)).status_code == 200
    # HR holds no expense screen.
    _as(users["HR"])
    assert (await _get(client, stored.id)).status_code == 403


# ===================== 4 — a file attached to nothing is not a public download
async def test_unattached_file_reaches_only_its_uploader_and_super_admin(db_session, client):
    ids, users = await _seed_base(db_session)
    uploader_user, _ = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "uploader")
    other_user, _ = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "opportunist")

    stored = await _make_file(db_session, uploaded_by=uploader_user.id)

    _as(other_user)
    assert (await _get(client, stored.id)).status_code == 403

    # The uploader must keep access: POST /files returns an id BEFORE the
    # parent record exists to reference it, so every create-with-attachment
    # form previews its own upload through this endpoint.
    _as(uploader_user)
    assert (await _get(client, stored.id)).status_code == 200

    _as(users["SUPER_ADMIN"])
    assert (await _get(client, stored.id)).status_code == 200


# ================================== 5 — org-wide branding stays org-wide
async def test_company_logo_is_downloadable_by_every_role(db_session, client):
    ids, users = await _seed_base(db_session)
    stored = await _make_file(db_session, uploaded_by=users["SUPER_ADMIN"].id)
    db_session.add(
        CompanyProfile(
            id=str(uuid.uuid4()), singleton_lock=True, legal_name="Meshrd", cin="C1", pan="P1",
            company_type="PRIVATE", year_of_incorporation=2020, phone="9999999999",
            official_email="a@b.c", logo_file_id=stored.id,
        )
    )
    await db_session.commit()

    # masters.company_profile is 'none' for HR/Accountant/Employee, yet the
    # logo is embedded in every generated PDF and rendered in the app shell —
    # _ORG_WIDE in file_access.py makes that explicit rather than accidental.
    for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"):
        _as(users[code])
        resp = await _get(client, stored.id)
        assert resp.status_code == 200, f"{code} could not load the company logo: {resp.text}"


# ============================================ 6 — a nonexistent id is still 404
async def test_unknown_file_id_is_404_not_403(db_session, client):
    ids, users = await _seed_base(db_session)
    _as(users["SUPER_ADMIN"])
    assert (await _get(client, str(uuid.uuid4()))).status_code == 404
