"""RBAC logic tests run against SQLite, not the real MySQL container — this
tests the PYTHON resolution logic (app/rbac/resolver.py), not MySQL-specific
DDL. Schema-level MySQL behaviour (generated columns, triggers) was proven
directly against a live MySQL 8.4 container during Phase 0 setup, not here —
see the manual verification log in the Phase 0 summary.
"""

import uuid

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.platform import User
from app.models.rbac import RolePermission, RolePermissionAction, Role, Screen, ScreenAction
from app.rbac.registry.screens import SCREENS

ROLE_CODES = ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"]

# The CANONICAL policy — Masters §3.0's access table for Phase 1, Financial
# Year's app-rbac.js transcription for Phase 0. Deliberately the same shape
# as app/seed.py's SCREEN_PERMISSIONS/SCREEN_ACTION_PERMISSIONS: this test
# package exists to prove the SEEDED DATABASE matches the intended policy,
# not to re-derive the policy a second time from the spec (that re-derivation
# happened once, in app/seed.py's comments citing each §3.0 row). What proves
# the comparison itself isn't vacuous is test_self_test.py, run alongside
# this — it injects a deliberately wrong permission and asserts it's caught.
def _super_admin_only() -> dict[str, str]:
    return {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"}


CANONICAL_SCREEN_MODE = {
    "masters.financial_year": _super_admin_only(),
    "masters.taxes": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "view", "HR": "none", "EMPLOYEE": "none"},
    "masters.expense_types": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "masters.leave_types": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "view"},
    "masters.holidays": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "view", "HR": "view", "EMPLOYEE": "view"},
    "masters.company_profile": {"SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "masters.bank_accounts": {"SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "masters.payment_modes": _super_admin_only(),
    "masters.departments": _super_admin_only(),
    "masters.designations": _super_admin_only(),
    "masters.hsn_sac_codes": _super_admin_only(),
    "masters.service_categories": _super_admin_only(),
    "masters.units_of_measure": _super_admin_only(),
    "masters.ticket_categories": _super_admin_only(),
    "masters.customer_statuses": _super_admin_only(),
    "masters.customer_sources": _super_admin_only(),
    "masters.asset_categories": _super_admin_only(),
    "masters.employment_types": _super_admin_only(),
    "masters.insurance_plans": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "view", "EMPLOYEE": "none"},
    "masters.work_week_hours": {"SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "none", "HR": "view", "EMPLOYEE": "none"},
    "masters.email_configuration": _super_admin_only(),

    "employee.directory": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "none"},
    "employee.master_record": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "none"},
    "employee.salary_structure": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "view", "HR": "view", "EMPLOYEE": "none"},
    "employee.insurance": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "employee.my_profile": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "employee.documents": {"SUPER_ADMIN": "full", "MANAGER": "own", "ACCOUNTANT": "own", "HR": "full", "EMPLOYEE": "own"},
    "employee.attendance": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "own"},
    "employee.onboarding": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "employee.offboarding": {"SUPER_ADMIN": "full", "MANAGER": "team", "ACCOUNTANT": "own", "HR": "full", "EMPLOYEE": "own"},
    "employee.tax_declarations": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "employee.offer_letters": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "employee.announcements": {"SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "view"},

    "leave.my_leave": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "leave.approvals": {"SUPER_ADMIN": "full", "MANAGER": "team", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "leave.balance_management": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "leave.compensatory_hours": {"SUPER_ADMIN": "full", "MANAGER": "team", "ACCOUNTANT": "own", "HR": "full", "EMPLOYEE": "own"},
    "leave.reports": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "none"},

    "payroll.run": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "payroll.adhoc_adjustments": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "payroll.my_payslips": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "payroll.payslips_admin": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "payroll.attendance_time_basis": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "none", "HR": "view", "EMPLOYEE": "none"},

    "customer.directory": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "vendor.directory": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "purchase_bill.list": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "invoice.dashboard": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "invoice.list": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "credit_note.list": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "expense.my_expenses": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "expense.approvals": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "expense.all_expenses": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "expense.company": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},

    "opportunity.pipeline": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "project.directory": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.board": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.sprints": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.milestones": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.report": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "project.timesheet.mine": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "project.timesheet.team": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "ticket.list": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "ticket.reports": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "asset.directory": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "asset.maintenance": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "full", "HR": "view", "EMPLOYEE": "none"},
    "asset.requests": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "asset.reports": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "asset.reclaim": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "employee.my_tickets": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "employee.my_projects_tasks": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "employee.my_assets": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "compliance.overview": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.obligations": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.obligations_by_document": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.remittances": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.credits": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.certificates": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "rbac.role_directory": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "rbac.permission_matrix": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "rbac.overrides": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "rbac.change_log": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
}
CANONICAL_ACTIONS = {
    "masters.financial_year": {
        "edit": {"SUPER_ADMIN"}, "lock": {"SUPER_ADMIN"}, "set_current": {"SUPER_ADMIN"},
        "unlock": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"},
    },
    "masters.taxes": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.expense_types": {"edit": {"SUPER_ADMIN", "MANAGER"}, "delete": {"SUPER_ADMIN"}},
    "masters.leave_types": {"edit": {"SUPER_ADMIN", "MANAGER", "HR"}, "delete": {"SUPER_ADMIN"}},
    "masters.holidays": {"edit": {"SUPER_ADMIN", "MANAGER"}, "delete": {"SUPER_ADMIN"}, "import": {"SUPER_ADMIN", "MANAGER"}},
    "masters.company_profile": {"edit": {"SUPER_ADMIN"}},
    "masters.bank_accounts": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.payment_modes": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.departments": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.designations": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.hsn_sac_codes": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.service_categories": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.units_of_measure": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.ticket_categories": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.customer_statuses": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.customer_sources": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.asset_categories": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.employment_types": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.insurance_plans": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}},
    "masters.work_week_hours": {"edit": {"SUPER_ADMIN"}, "delete": {"SUPER_ADMIN"}, "override_saturday": {"SUPER_ADMIN"}},
    "masters.email_configuration": {"edit": {"SUPER_ADMIN"}, "create": {"SUPER_ADMIN"}, "send_test": {"SUPER_ADMIN"}},

    "employee.master_record": {"edit": {"SUPER_ADMIN", "HR"}, "manage_login": {"SUPER_ADMIN", "HR"}},
    "employee.salary_structure": {"edit": {"SUPER_ADMIN"}, "edit_applicability": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "employee.insurance": {"edit": {"SUPER_ADMIN", "HR"}},
    "employee.my_profile": {
        "edit": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "request_change": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "approve_change": {"SUPER_ADMIN", "HR"},
    },
    "employee.documents": {
        "upload": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "delete": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "verify": {"SUPER_ADMIN", "HR"},
    },
    "employee.attendance": {"record": {"SUPER_ADMIN"}},
    "employee.onboarding": {"edit": {"SUPER_ADMIN", "HR"}, "send_welcome_email": {"SUPER_ADMIN", "HR"}},
    "employee.offboarding": {
        "raise_resignation": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "acknowledge": {"SUPER_ADMIN", "MANAGER", "HR"},
        "process_exit": {"SUPER_ADMIN", "HR"},
    },
    "employee.tax_declarations": {
        "edit": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "submit": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "verify": {"SUPER_ADMIN", "ACCOUNTANT", "HR"},
        "manage": {"SUPER_ADMIN"},
    },
    "employee.offer_letters": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}, "generate": {"SUPER_ADMIN", "ACCOUNTANT"}, "send": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "employee.announcements": {"post": {"SUPER_ADMIN", "HR"}},

    "leave.my_leave": {"apply": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"}, "cancel": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"}},
    "leave.approvals": {"approve": {"SUPER_ADMIN", "MANAGER", "HR"}},
    "leave.balance_management": {"adjust": {"SUPER_ADMIN", "HR"}, "run_carry_forward": {"SUPER_ADMIN", "HR"}},
    "leave.compensatory_hours": {
        "request": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"},
        "approve": {"SUPER_ADMIN", "MANAGER", "HR"},
    },

    "payroll.run": {"run": {"SUPER_ADMIN", "ACCOUNTANT", "HR"}, "confirm": {"SUPER_ADMIN", "ACCOUNTANT", "HR"}},
    "payroll.adhoc_adjustments": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "payroll.payslips_admin": {"reissue": {"SUPER_ADMIN", "ACCOUNTANT", "HR"}},

    "customer.directory": {"edit": {"SUPER_ADMIN", "MANAGER"}},
    "vendor.directory": {"edit": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT"}, "edit_banking": {"SUPER_ADMIN", "ACCOUNTANT"}, "deactivate": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT"}, "activate": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT"}, "approve_vendor": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "purchase_bill.list": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}, "record_payment": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "invoice.list": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}, "send": {"SUPER_ADMIN", "ACCOUNTANT"}, "record_payment": {"SUPER_ADMIN", "ACCOUNTANT"}, "view_financial_summary": {"SUPER_ADMIN"}, "confirm_paid": {"SUPER_ADMIN"}},
    "credit_note.list": {"raise": {"SUPER_ADMIN", "ACCOUNTANT"}, "approve": {"SUPER_ADMIN"}},
    "expense.approvals": {"approve": {"SUPER_ADMIN", "ACCOUNTANT"}, "reject": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "expense.all_expenses": {"mark_reimbursed": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "expense.company": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}},

    "opportunity.pipeline": {"edit": {"SUPER_ADMIN", "MANAGER"}},
    "project.directory": {"edit": {"SUPER_ADMIN", "MANAGER"}},
    "project.board": {"delete": {"SUPER_ADMIN", "MANAGER"}},
    "project.sprints": {"manage": {"SUPER_ADMIN", "MANAGER"}},
    "project.milestones": {"manage": {"SUPER_ADMIN", "MANAGER"}},
    "project.timesheet.team": {"approve": {"SUPER_ADMIN", "MANAGER"}},
    "ticket.list": {"create": {"SUPER_ADMIN", "MANAGER"}, "reassign": {"SUPER_ADMIN", "MANAGER"}, "close": {"SUPER_ADMIN", "MANAGER"}},
    "asset.directory": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}, "assign": {"SUPER_ADMIN", "HR"}},
    "asset.maintenance": {"edit": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "asset.requests": {"approve": {"SUPER_ADMIN", "MANAGER"}},
    "asset.reclaim": {"mark_returned": {"SUPER_ADMIN", "HR"}},
    "employee.my_assets": {"raise_request": {"SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"}},
    "compliance.remittances": {"record": {"SUPER_ADMIN", "ACCOUNTANT"}, "reverse": {"SUPER_ADMIN"}},
    "compliance.certificates": {"log": {"SUPER_ADMIN", "ACCOUNTANT"}, "void": {"SUPER_ADMIN"}, "claim": {"SUPER_ADMIN", "ACCOUNTANT"}},
    "rbac.permission_matrix": {"edit": {"SUPER_ADMIN"}},
    "rbac.overrides": {"add": {"SUPER_ADMIN"}, "remove": {"SUPER_ADMIN"}},
}


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_canonical(db: AsyncSession) -> dict[str, dict[str, str]]:
    """Seeds the DB with the CANONICAL (correct) policy. Returns {role_code: role_id, screen_key: screen_id}."""
    return await _seed(db, CANONICAL_SCREEN_MODE, CANONICAL_ACTIONS)


async def seed_with_override(db: AsyncSession, screen_mode_override: dict) -> dict:
    """Seeds with the canonical policy EXCEPT the given screen-mode overrides
    applied on top — used only by the self-test to inject a deliberately
    wrong configuration and prove the comparison catches it.
    """
    modes = {k: dict(v) for k, v in CANONICAL_SCREEN_MODE.items()}
    for screen_key, role_overrides in screen_mode_override.items():
        modes.setdefault(screen_key, {}).update(role_overrides)
    return await _seed(db, modes, CANONICAL_ACTIONS)


async def _seed(db: AsyncSession, screen_modes: dict, screen_actions: dict) -> dict:
    ids: dict[str, str] = {}

    for code in ROLE_CODES:
        role = Role(id=str(uuid.uuid4()), code=code, name=code.title())
        db.add(role)
        ids["role:" + code] = role.id
    await db.flush()

    for key, screen_def in SCREENS.items():
        screen = Screen(id=str(uuid.uuid4()), screen_key=key, module_key=screen_def.module, label=screen_def.label, has_scope=screen_def.has_scope)
        db.add(screen)
        ids["screen:" + key] = screen.id
        for action_key in screen_def.actions:
            db.add(ScreenAction(id=str(uuid.uuid4()), screen_id=screen.id, action_key=action_key, label=action_key))
    await db.flush()

    for screen_key, per_role in screen_modes.items():
        for role_code, mode in per_role.items():
            db.add(RolePermission(id=str(uuid.uuid4()), role_id=ids["role:" + role_code], screen_id=ids["screen:" + screen_key], mode=mode))

    for screen_key, per_action in screen_actions.items():
        for action_key, allowed_roles in per_action.items():
            for role_code in allowed_roles:
                db.add(
                    RolePermissionAction(
                        id=str(uuid.uuid4()),
                        role_id=ids["role:" + role_code],
                        screen_id=ids["screen:" + screen_key],
                        action_key=action_key,
                        allowed=True,
                    )
                )
    await db.flush()

    for code in ROLE_CODES:
        user = User(id=str(uuid.uuid4()), email=f"{code.lower()}@test.local", password_hash="x", full_name=code, role_id=ids["role:" + code])
        db.add(user)
        ids["user:" + code] = user.id

    await db.commit()
    return ids
