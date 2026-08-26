"""Seeds the 5 roles, the screen registry (from code), and one Super Admin
user. Run once against a freshly-migrated database:

    python -m app.seed

Financial Year's role permissions are transcribed exactly from the
prototype's app-rbac.js POLICY/ACTIONS tables — 'superadmin': 'full',
everyone else 'none'; Lock and Edit restricted to superadmin — not invented
fresh here.
"""

import asyncio
import uuid

from sqlalchemy import select

from app.auth.security import hash_password
from app.core.db import AsyncSessionLocal
from app.models.masters import EmailTemplate, NumberPrefixRule
from app.models.platform import IndianState, User
from app.models.rbac import FeatureToggle, RolePermission, RolePermissionAction, RolePermissionField, Role, Screen, ScreenAction, ScreenSensitiveField
from app.rbac.field_sync import MANIFEST_PATH, sync_fields_from_manifest
from app.rbac.registry.screens import SCREENS
from app.rbac.toggles import TOGGLE_DEFAULTS

ROLES = [
    ("SUPER_ADMIN", "Super Admin"),
    ("MANAGER", "Manager"),
    ("ACCOUNTANT", "Accountant"),
    ("HR", "HR"),
    ("EMPLOYEE", "Employee"),
]

def _super_admin_only(*extra_none_roles: str) -> dict[str, str]:
    modes = {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"}
    return modes


# screen_key -> {role_code: mode}. Matches prototype app-rbac.js line 144:
# 'masters.fy': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' }
#
# Masters §3.0's access table is the source of truth for every screen below.
# The 13 sub-masters with no table row of their own default to "everything
# not spelled out is Super Admin only" (§3.0), same as Financial Year.
SCREEN_PERMISSIONS = {
    "masters.financial_year": _super_admin_only(),
    "masters.taxes": {  # §3.0: Accountant gets View by default (Manage needs the RBAC flag — not wired yet)
        "SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "view", "HR": "none", "EMPLOYEE": "none",
    },
    "masters.expense_types": {  # §3.0: Manager Manage (no delete)
        "SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none",
    },
    "masters.leave_types": {  # §3.0: Manager + HR both Manage (no delete)
        # Leave §2.1/§2.2 "Apply for Leave" needs the Leave Types lookup for
        # EVERY role that can apply — found blocking EMPLOYEE/ACCOUNTANT
        # entirely (404 on the lookup), same class of bug as the
        # masters.holidays fix above. view-only for the two added roles;
        # edit/delete stay Manager/HR/Super-Admin-only, unaffected.
        "SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "view",
    },
    "masters.holidays": {  # §3.0: Manager Manage (no delete) + bulk import.
        # Leave §2.4 "Company Holiday Calendar": "Who can open it: All 5
        # roles ... identical filter set" — this is that same screen viewed
        # from Leave; found blocking 3 of 5 roles entirely by the Phase 2
        # audit. view-only for the three added roles; edit/delete/import
        # stay Manager/Super-Admin-only, unaffected (see SCREEN_ACTION_PERMISSIONS).
        "SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "view", "HR": "view", "EMPLOYEE": "view",
    },
    "masters.company_profile": {  # §3.0: Manager View only
        "SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none",
    },
    "masters.bank_accounts": {  # §3.6c / §3.7 Role Access: Manager sees these read-only inside Company Profile
        # ACCOUNTANT was briefly "view" (2026-08-08) to un-404 Invoice/
        # Purchase Bill/Expense forms' bank-account picker — but that reused
        # the SAME screen-level permission that also opens the standalone
        # Bank Account master (real account numbers), which §3.7 says
        # Accountant should never be able to reach on their own. 2026-08-11
        # RBAC audit: reverted to "none", now that
        # `GET /masters/bank-accounts/options` (masters_bank_accounts.py)
        # serves that picker need without a screen-level grant at all.
        "SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none",
    },
    # KNOWN GAP (2026-08-05 audit): §3.7 Role Access says Manager may see Bank
    # Account "read-only inside Company Profile, but cannot open or edit the
    # Bank Account master itself" (prototype app-rbac.js:137 agrees:
    # 'masters.bank': manager 'none'). But bank-accounts.list.config.ts is
    # the SAME screen id ('masters.bank_accounts') used both as the
    # standalone /masters/bank-accounts route + its own top-level Masters nav
    # entry (nav-registry.ts:40, masters.routes.ts:57-59) AND as the
    # embedded "Bank Details" tab inside Company Profile
    # (company-profile.tabbed.config.ts:42). One RBAC screen id currently
    # governs both, so the MANAGER: "view" grant above — needed for the
    # embedded tab — also unlocks the standalone master screen, which the
    # spec says Manager should never be able to open on its own. Not
    # fixable from this seed file alone: it needs the RBAC/embedding layer
    # to tell "viewed as a Company Profile tab" apart from "opened as its
    # own screen" (e.g. gate the standalone route/nav entry on a stricter
    # check while the embedded tab keeps riding on masters.company_profile's
    # own MANAGER "view" grant). Left as MANAGER: "view" here, matching
    # today's single-screen-id reality, until that split exists.
    # ACCOUNTANT was briefly "view" (2026-08-08) to un-404 Invoice/Purchase
    # Bill/Expense forms' Payment Mode picker — same over-grant class as
    # masters.bank_accounts above. 2026-08-11 RBAC audit: reverted to
    # Super-Admin-only, now that `GET /masters/payment-modes/options`
    # (masters_lookup.py's `label_field` route) serves the picker without a
    # screen-level grant.
    "masters.payment_modes": _super_admin_only(),
    "masters.departments": _super_admin_only(),
    "masters.designations": _super_admin_only(),
    # Same fix, same reason, for the HSN/SAC Code line-item lookup on
    # Invoice/Purchase Bill — now served by `GET /masters/hsn-sac-codes/options`.
    "masters.hsn_sac_codes": _super_admin_only(),
    "masters.service_categories": _super_admin_only(),
    "masters.units_of_measure": _super_admin_only(),
    "masters.ticket_categories": _super_admin_only(),
    "masters.customer_statuses": _super_admin_only(),
    "masters.customer_sources": _super_admin_only(),  # §3.16 Role Access, not in the §3.0 table
    "masters.asset_categories": _super_admin_only(),
    "masters.employment_types": _super_admin_only(),
    "masters.insurance_plans": {  # §3.0: HR View only
        "SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "view", "EMPLOYEE": "none",
    },
    "masters.work_week_hours": {  # §3.20 Role Access: HR + Manager both View only, Accountant no access
        "SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "none", "HR": "view", "EMPLOYEE": "none",
    },
    "masters.email_configuration": _super_admin_only(),  # §3.21 Role Access: Super Admin only, full stop

    # ==================================================== PHASE 2 — EMPLOYEE
    # Employee §6.1's access table, transcribed column by column (Employee /
    # Manager / Accountant / HR / Super Admin).
    "employee.directory": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "none"},
    "employee.master_record": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "none"},
    # Salary Structure: Super Admin edits; Accountant/HR view-only (Accountant
    # additionally gets the applicability-toggle action below).
    "employee.salary_structure": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "view", "HR": "view", "EMPLOYEE": "none"},
    "employee.insurance": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "employee.my_profile": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},  # always "own"
    # §2.6: own for everyone at baseline; HR/Super Admin additionally see the
    # cross-employee Verification Queue via the 'verify' action + full scope.
    "employee.documents": {"SUPER_ADMIN": "full", "MANAGER": "own", "ACCOUNTANT": "own", "HR": "full", "EMPLOYEE": "own"},
    "employee.attendance": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "own"},
    "employee.onboarding": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    # §2.13: raising your own resignation is universal; Manager additionally
    # acknowledges direct reports.
    "employee.offboarding": {"SUPER_ADMIN": "full", "MANAGER": "team", "ACCOUNTANT": "own", "HR": "full", "EMPLOYEE": "own"},
    "employee.tax_declarations": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},  # own baseline; 'verify' action unlocks cross-employee view
    # §2.15 — Accountant + Super Admin ONLY, per the module's own access
    # table. Not a typo: HR does not get this screen.
    "employee.offer_letters": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "employee.announcements": {"SUPER_ADMIN": "full", "MANAGER": "view", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "view"},

    # ======================================================= PHASE 2 — LEAVE
    # Leave §6: "nobody's access to their own leave should ever be narrower
    # than a plain Employee's" — all 5 get the same baseline mode.
    "leave.my_leave": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "leave.approvals": {"SUPER_ADMIN": "full", "MANAGER": "team", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    "leave.balance_management": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},
    # §2.6 Role Access: Accountant/Employee are Own scope only — Accountant
    # "holds no approval rights anywhere in this module". Was seeded "full"
    # (company-wide, no filter) for both — a real over-grant, found by the
    # Phase 2 audit and not exploitable through the two endpoints that exist
    # today, but wrong the moment any endpoint trusts the mode via apply_scope.
    "leave.compensatory_hours": {"SUPER_ADMIN": "full", "MANAGER": "team", "ACCOUNTANT": "own", "HR": "full", "EMPLOYEE": "own"},
    # §2.5 / §6: Accountant's read access to Leave Reports is their only
    # capability anywhere in this module — found unimplemented by the audit.
    "leave.reports": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "view", "HR": "full", "EMPLOYEE": "none"},

    # ===================================================== PHASE 3 — PAYROLL
    "payroll.run": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "payroll.adhoc_adjustments": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "payroll.my_payslips": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},  # own baseline
    "payroll.payslips_admin": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    # §2.4 Role Access, verbatim: "Manager — view, Team scope only" — a
    # read-only mode ('view_team'), not the writable-by-construction 'team'
    # this screen has no write action on today, but the mode string itself
    # should still say read-only per PermissionSet.read_only / the same
    # convention employee.attendance's own Manager cell already uses.
    "payroll.attendance_time_basis": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "none", "HR": "view", "EMPLOYEE": "none"},

    # ===================================================== PHASE 4 — FINANCE
    # §6: Customer/CRM data doesn't carry payroll's personal-privacy weight —
    # Manager's broad company-wide grant is kept as-is (unlike Payroll's
    # defaulted-down Manager access).
    "customer.directory": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "vendor.directory": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    # Money-movement modules: Manager gets nothing by default (same rule as
    # Payroll) — "Give Manager Read-Only Access to Purchase Bills" toggle OFF.
    "purchase_bill.list": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "invoice.dashboard": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "invoice.list": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "credit_note.list": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "expense.my_expenses": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},  # own baseline
    "expense.approvals": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "expense.all_expenses": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "expense.company": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},

    # ===================================================== PHASE 5 — OPERATIONS
    "opportunity.pipeline": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},

    # §2.1: Employee's mode is 'own' here specifically to mean "team member
    # of THIS project" (checked in app/services/project_scope.py, not
    # org_scope.py — project membership has nothing to do with the employee
    # reporting hierarchy 'own'/'team' otherwise means in this codebase).
    "project.directory": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.board": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.sprints": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.milestones": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "project.report": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    # "My Timesheet" — a dedicated self-service screen, same "own baseline"
    # pattern as expense.my_expenses: 'full' for every role, the endpoint
    # itself always filters to the caller's own entries regardless of mode.
    "project.timesheet.mine": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "project.timesheet.team": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},

    # §2.1: Employee's 'own' here means "tickets assigned to them" —
    # filtered in the router, same convention as employee.attendance's own Employee cell.
    "ticket.list": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "own"},
    "ticket.reports": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},

    # §6.1/6.2: Manager 'view_team' reuses org_scope.py's existing direct-
    # report concept directly (Asset's Manager scope really is "my direct
    # reports," unlike Project's team-membership) — Accountant/HR get 'full'
    # (see-everything, actions gated separately).
    "asset.directory": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "asset.maintenance": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "full", "HR": "view", "EMPLOYEE": "none"},
    "asset.requests": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "none", "HR": "none", "EMPLOYEE": "none"},
    "asset.reports": {"SUPER_ADMIN": "full", "MANAGER": "view_team", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "none"},
    "asset.reclaim": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "none", "HR": "full", "EMPLOYEE": "none"},

    # Employee self-service — dedicated "own baseline" screens, same
    # 'full'-for-everyone pattern as expense.my_expenses/My Timesheet above.
    "employee.my_tickets": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "employee.my_projects_tasks": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},
    "employee.my_assets": {"SUPER_ADMIN": "full", "MANAGER": "full", "ACCOUNTANT": "full", "HR": "full", "EMPLOYEE": "full"},

    # ============================================ MODULE 15 — TAX & COMPLIANCE
    # §6: "Accountant — full access to every screen. This is their monthly
    # cycle." / "Manager, HR, Employee — no access, and the module does not
    # appear in their navigation."
    "compliance.overview": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.obligations": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.obligations_by_document": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.remittances": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.credits": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},
    "compliance.certificates": {"SUPER_ADMIN": "full", "MANAGER": "none", "ACCOUNTANT": "full", "HR": "none", "EMPLOYEE": "none"},

    # =================================================== RBAC ADMIN SCREENS
    "rbac.role_directory": _super_admin_only(),
    "rbac.permission_matrix": _super_admin_only(),
    "rbac.overrides": _super_admin_only(),
    "rbac.change_log": _super_admin_only(),
}

# screen_key -> action_key -> [role_codes allowed]. Matches app-rbac.js line 226:
# 'masters.fy': { 'Lock': ['superadmin'], 'Edit': ['superadmin'] }
#
# "Manage (no delete)" (§3.0 rule 1: Delete/Deactivate are ALWAYS Super Admin
# only, even on a sub-master a role can otherwise add/edit) is expressed here
# by simply never listing that role under the 'delete' action.
SCREEN_ACTION_PERMISSIONS = {
    "masters.financial_year": {"edit": ["SUPER_ADMIN"], "lock": ["SUPER_ADMIN"], "set_current": ["SUPER_ADMIN"], "unlock": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.taxes": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.expense_types": {"edit": ["SUPER_ADMIN", "MANAGER"], "delete": ["SUPER_ADMIN"]},
    "masters.leave_types": {"edit": ["SUPER_ADMIN", "MANAGER", "HR"], "delete": ["SUPER_ADMIN"]},
    "masters.holidays": {"edit": ["SUPER_ADMIN", "MANAGER"], "delete": ["SUPER_ADMIN"], "import": ["SUPER_ADMIN", "MANAGER"]},
    "masters.company_profile": {"edit": ["SUPER_ADMIN"]},
    "masters.bank_accounts": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.payment_modes": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.departments": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.designations": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.hsn_sac_codes": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.service_categories": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.units_of_measure": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.ticket_categories": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.customer_statuses": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.customer_sources": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.asset_categories": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.employment_types": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.insurance_plans": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"]},
    "masters.work_week_hours": {"edit": ["SUPER_ADMIN"], "delete": ["SUPER_ADMIN"], "override_saturday": ["SUPER_ADMIN"]},
    "masters.email_configuration": {"edit": ["SUPER_ADMIN"], "create": ["SUPER_ADMIN"], "send_test": ["SUPER_ADMIN"]},

    "employee.master_record": {"edit": ["SUPER_ADMIN", "HR"], "manage_login": ["SUPER_ADMIN", "HR"]},
    "employee.salary_structure": {"edit": ["SUPER_ADMIN"], "edit_applicability": ["SUPER_ADMIN", "ACCOUNTANT"]},
    "employee.insurance": {"edit": ["SUPER_ADMIN", "HR"]},
    "employee.my_profile": {
        "edit": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "request_change": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "approve_change": ["SUPER_ADMIN", "HR"],
    },
    "employee.documents": {
        "upload": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "delete": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],  # own-Pending-only enforced at the API layer
        "verify": ["SUPER_ADMIN", "HR"],
    },
    "employee.attendance": {"record": ["SUPER_ADMIN"]},  # §2.2: "only Super Admin can manually record" today
    "employee.onboarding": {"edit": ["SUPER_ADMIN", "HR"], "send_welcome_email": ["SUPER_ADMIN", "HR"]},
    "employee.offboarding": {
        "raise_resignation": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "acknowledge": ["SUPER_ADMIN", "MANAGER", "HR"],
        "process_exit": ["SUPER_ADMIN", "HR"],
    },
    "employee.tax_declarations": {
        "edit": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "submit": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "verify": ["SUPER_ADMIN", "ACCOUNTANT", "HR"],  # view-only cross-employee, §2.14
        "manage": ["SUPER_ADMIN"],  # edit reach on ANY employee's declaration — SA only
    },
    "employee.offer_letters": {"edit": ["SUPER_ADMIN", "ACCOUNTANT"], "generate": ["SUPER_ADMIN", "ACCOUNTANT"], "send": ["SUPER_ADMIN", "ACCOUNTANT"]},
    "employee.announcements": {"post": ["SUPER_ADMIN", "HR"]},

    "leave.my_leave": {"apply": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"], "cancel": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"]},
    "leave.approvals": {"approve": ["SUPER_ADMIN", "MANAGER", "HR"]},
    "leave.balance_management": {"adjust": ["SUPER_ADMIN", "HR"], "run_carry_forward": ["SUPER_ADMIN", "HR"]},
    "leave.compensatory_hours": {
        "request": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"],
        "approve": ["SUPER_ADMIN", "MANAGER", "HR"],
    },

    # ===================================================== PHASE 3 — PAYROLL
    "payroll.run": {"run": ["SUPER_ADMIN", "ACCOUNTANT", "HR"], "confirm": ["SUPER_ADMIN", "ACCOUNTANT", "HR"]},
    "payroll.adhoc_adjustments": {"edit": ["SUPER_ADMIN", "ACCOUNTANT"]},
    "payroll.payslips_admin": {"reissue": ["SUPER_ADMIN", "ACCOUNTANT", "HR"]},

    # ===================================================== PHASE 4 — FINANCE
    "customer.directory": {"edit": ["SUPER_ADMIN", "MANAGER"]},
    # 'edit_banking' deliberately excludes MANAGER — "Allow Manager to Edit
    # Vendor Bank & GST Details" toggle default OFF (§6.1).
    "vendor.directory": {
        "edit": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT"], "edit_banking": ["SUPER_ADMIN", "ACCOUNTANT"],
        "deactivate": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT"], "activate": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT"],
        # §6.1 "Require Approval to Add a New Vendor" — "Accountant or Super
        # Admin sign-off," deliberately excluding Manager despite Manager's
        # otherwise-broad vendor access.
        "approve_vendor": ["SUPER_ADMIN", "ACCOUNTANT"],
    },
    "purchase_bill.list": {"edit": ["SUPER_ADMIN", "ACCOUNTANT"], "record_payment": ["SUPER_ADMIN", "ACCOUNTANT"]},
    # 'view_financial_summary' deliberately excludes ACCOUNTANT here — that's
    # the toggle-gated half (ACTION_TOGGLE_GATES in rbac/toggles.py), OFF by
    # default; Super Admin's own grant is static, same as every other action.
    "invoice.list": {
        "edit": ["SUPER_ADMIN", "ACCOUNTANT"], "send": ["SUPER_ADMIN", "ACCOUNTANT"], "record_payment": ["SUPER_ADMIN", "ACCOUNTANT"],
        "view_financial_summary": ["SUPER_ADMIN"],
        # §6.2 "Require Second Approval Before an Invoice Locks as Paid" —
        # "Super Admin must confirm first," never Accountant, same reasoning
        # as credit_note.list's own 'approve' just below.
        "confirm_paid": ["SUPER_ADMIN"],
    },
    # 'approve' is Super Admin only — Credit Note's own stated approval rule.
    "credit_note.list": {"raise": ["SUPER_ADMIN", "ACCOUNTANT"], "approve": ["SUPER_ADMIN"]},
    "expense.approvals": {"approve": ["SUPER_ADMIN", "ACCOUNTANT"], "reject": ["SUPER_ADMIN", "ACCOUNTANT"]},
    "expense.all_expenses": {"mark_reimbursed": ["SUPER_ADMIN", "ACCOUNTANT"]},
    "expense.company": {"edit": ["SUPER_ADMIN", "ACCOUNTANT"]},

    # ===================================================== PHASE 5 — OPERATIONS
    "opportunity.pipeline": {"edit": ["SUPER_ADMIN", "MANAGER"]},
    "project.directory": {"edit": ["SUPER_ADMIN", "MANAGER"]},
    "project.board": {"delete": ["SUPER_ADMIN", "MANAGER"]},
    "project.sprints": {"manage": ["SUPER_ADMIN", "MANAGER"]},
    "project.milestones": {"manage": ["SUPER_ADMIN", "MANAGER"]},
    "project.timesheet.team": {"approve": ["SUPER_ADMIN", "MANAGER"]},
    # 'create'/'reassign' deliberately exclude EMPLOYEE — both toggles
    # ("Allow Staff to Create New Tickets" / "...Reassign Their Own
    # Ticket") default OFF (§6.2). 'close' also excludes EMPLOYEE — closing
    # is reserved for whoever confirms resolution, never the assignee alone.
    "ticket.list": {"create": ["SUPER_ADMIN", "MANAGER"], "reassign": ["SUPER_ADMIN", "MANAGER"], "close": ["SUPER_ADMIN", "MANAGER"]},
    # §6.1: 'edit' = Core Info + Purchase & Financial fields (Details tab);
    # 'assign' = the Assign/Transfer/Unassign actions (§2.3).
    "asset.directory": {"edit": ["SUPER_ADMIN", "ACCOUNTANT"], "assign": ["SUPER_ADMIN", "HR"]},
    "asset.maintenance": {"edit": ["SUPER_ADMIN", "ACCOUNTANT"]},
    "asset.requests": {"approve": ["SUPER_ADMIN", "MANAGER"]},
    "asset.reclaim": {"mark_returned": ["SUPER_ADMIN", "HR"]},
    # Every role can raise a request for their own assigned asset (§2.9).
    "employee.my_assets": {"raise_request": ["SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE"]},

    # ============================================ MODULE 15 — TAX & COMPLIANCE
    "compliance.remittances": {"record": ["SUPER_ADMIN", "ACCOUNTANT"], "reverse": ["SUPER_ADMIN"]},
    "compliance.certificates": {"log": ["SUPER_ADMIN", "ACCOUNTANT"], "void": ["SUPER_ADMIN"], "claim": ["SUPER_ADMIN", "ACCOUNTANT"]},

    # =================================================== RBAC ADMIN SCREENS
    "rbac.permission_matrix": {"edit": ["SUPER_ADMIN"]},
    "rbac.overrides": {"add": ["SUPER_ADMIN"], "remove": ["SUPER_ADMIN"]},
}

# Layer 3 field sensitivity — default is 'show' for every role on every
# field; only entries that need to deviate from that (MANAGER 'hide' here)
# need a row at all. See app/rbac/resolver.py's Layer-3 docstring.
SCREEN_FIELD_PERMISSIONS = {
    # §6.1 "Allow Manager to Edit Vendor Bank & GST Details" OFF by default:
    # Manager holds 'edit' but not 'edit_banking', and per §2.1/§2.3 "All
    # three banking columns are withheld from Manager, on the same rule as
    # GSTIN" — the read-side mirror of the write-side edit_banking gate.
    "vendor.directory": {
        "gstin": {"MANAGER": "hide"},
        "pan": {"MANAGER": "hide"},
        "bank_account_name": {"MANAGER": "hide"},
        "bank_name": {"MANAGER": "hide"},
        "bank_account_number": {"MANAGER": "hide"},
        "ifsc_code": {"MANAGER": "hide"},
        # VendorOut's own masked-summary field — see screens.py's
        # sensitive_fields comment for why this needed its own entry.
        "bank_account_number_masked": {"MANAGER": "hide"},
        # §2.3 Vendor Usage columns — "not the banking columns... Visible to
        # Accountant and Super Admin only."
        "paid_from": {"MANAGER": "hide"},
        "paid_into": {"MANAGER": "hide"},
        "account_number_masked": {"MANAGER": "hide"},
    },
    # §2.1: "Collected Into ... Withheld from Manager — it is a company
    # banking detail, not an account-relationship one." The customer's OWN
    # bank_account_name/bank_name/bank_account_number carry no such
    # carve-out (Manager has unqualified full access to Customer).
    "customer.directory": {
        "collected_into_bank_account_id": {"MANAGER": "hide"},
    },
    # §6.1/6.2: "Show Purchase Value to Manager" toggle OFF by default —
    # governs Purchase Value AND Current Value together (Appendix B: "one
    # switch"). Accountant/HR/Super Admin always see both.
    "asset.directory": {
        "purchase_value": {"MANAGER": "hide"},
        "current_value": {"MANAGER": "hide"},
    },
    "asset.reports": {
        "purchase_value": {"MANAGER": "hide"},
        "current_value": {"MANAGER": "hide"},
    },
    # §2.9 (Employee module): My Assets never shows value figures, to
    # anyone — hidden for all 5 roles, unlike the toggle-gated Manager-only
    # hide on the Directory/Reports above.
    "employee.my_assets": {
        "purchase_value": {"SUPER_ADMIN": "hide", "MANAGER": "hide", "ACCOUNTANT": "hide", "HR": "hide", "EMPLOYEE": "hide"},
        "current_value": {"SUPER_ADMIN": "hide", "MANAGER": "hide", "ACCOUNTANT": "hide", "HR": "hide", "EMPLOYEE": "hide"},
    },
}

# Standard, fixed reference data (India's states/UTs + their official GST
# state codes) — found genuinely missing entirely: the `indian_states` table
# and its FK from company_addresses.state_id have existed since migration
# 0001, but no seed rows and no read endpoint existed anywhere, so no
# Company Address could ever be created with a real, valid state. Discovered
# while wiring the Company Profile frontend screen's Addresses form.
SEED_INDIAN_STATES = [
    # name, code, gst_state_code
    ("Jammu and Kashmir", "JK", "01"), ("Himachal Pradesh", "HP", "02"), ("Punjab", "PB", "03"),
    ("Chandigarh", "CH", "04"), ("Uttarakhand", "UK", "05"), ("Haryana", "HR", "06"),
    ("Delhi", "DL", "07"), ("Rajasthan", "RJ", "08"), ("Uttar Pradesh", "UP", "09"),
    ("Bihar", "BR", "10"), ("Sikkim", "SK", "11"), ("Arunachal Pradesh", "AR", "12"),
    ("Nagaland", "NL", "13"), ("Manipur", "MN", "14"), ("Mizoram", "MZ", "15"),
    ("Tripura", "TR", "16"), ("Meghalaya", "ML", "17"), ("Assam", "AS", "18"),
    ("West Bengal", "WB", "19"), ("Jharkhand", "JH", "20"), ("Odisha", "OR", "21"),
    ("Chhattisgarh", "CG", "22"), ("Madhya Pradesh", "MP", "23"), ("Gujarat", "GJ", "24"),
    ("Dadra and Nagar Haveli and Daman and Diu", "DNHDD", "26"), ("Maharashtra", "MH", "27"),
    ("Karnataka", "KA", "29"), ("Goa", "GA", "30"), ("Lakshadweep", "LD", "31"),
    ("Kerala", "KL", "32"), ("Tamil Nadu", "TN", "33"), ("Puducherry", "PY", "34"),
    ("Andaman and Nicobar Islands", "AN", "35"), ("Telangana", "TG", "36"),
    ("Andhra Pradesh", "AP", "37"), ("Ladakh", "LA", "38"),
]

# Masters §3.6e "Proposed starting defaults, all editable by Super Admin" —
# transcribed verbatim from the table in 01-masters-module.md. Business data,
# not RBAC, but seeded here for the same reason the 2 starting users are:
# without it the feature is unusable on a fresh install (found by the Phase 1
# audit — nothing populated this table before).
SEED_NUMBER_PREFIX_RULES = [
    # code_type, label,               prefix, fy,   digits, start
    ("CUST", "Customer Code",      "CUST", True, 4, 1),
    ("OPP",  "Opportunity Code",   "OPP",  True, 4, 1),
    ("PRJ",  "Project Code",       "PRJ",  True, 4, 1),
    ("INV",  "Invoice Number",     "INV",  True, 5, 1),
    ("PB",   "Purchase Bill Number", "PB", True, 4, 1),
    ("TKT",  "Ticket Number",      "TKT",  True, 4, 1),
    ("AST",  "Asset Code",         "AST",  True, 4, 1),
    ("QUO",  "Quotation Number",   "QUO",  True, 4, 1),  # currently unused (Opportunity's Quote tab was removed) — kept so its series is ready if reintroduced
    ("CN",   "Credit Note Number", "CN",   True, 4, 1),
    # Phase 2 — found missing by its own audit: create_employee/create_offer_letter/
    # request_compensatory_hours all call allocate_number for these three
    # code types, which raised an unhandled 500 on any fresh install/reseed
    # since no row existed for them until now (the same "seed the prefix
    # rule the API code type needs" gap the Phase 1 audit already fixed once
    # for CUST/OPP/etc — recurred here for the three Phase 2 code types).
    ("EMP",  "Employee Code",           "EMP", True, 4, 1),
    ("LTR",  "Offer/Appointment/Acceptance Letter Number", "LTR", True, 4, 1),
    ("CHR",  "Compensatory Hour Request Number", "CHR", True, 4, 1),
    # Module 15 §2.4/§5 — "its own number series (RMT-<FY>-0000)".
    ("RMT",  "Remittance Number", "RMT", True, 4, 1),
]

# Masters §3.21 "Starting rows, one per notification point already documented
# across the other thirteen modules" — the 16 rows named in that paragraph.
# triggered_from_module names the OWNING module, not this one; subject/body
# are placeholder copy an implementer fills in per module as it's built —
# what matters for Phase 1 is that a row exists to enable/disable and that
# no future module needs a schema change to gain one (POST now exists too).
SEED_EMAIL_TEMPLATES = [
    ("welcome_email", "Welcome Email", "Employee", "Welcome to Meshrd, {{first_name}}", "Hi {{first_name}}, welcome aboard."),
    ("temporary_password", "Temporary Password", "Employee", "Your temporary password", "Hi {{first_name}}, your temporary password is {{temp_password}}."),
    ("offer_appointment_letter", "Offer / Appointment Letter", "Employee", "Your {{letter_type}} from Meshrd", "Hi {{first_name}}, please find your {{letter_type}} attached."),
    ("payslip_available", "Payslip Available", "Payroll", "Your payslip for {{month}} is ready", "Hi {{first_name}}, your payslip for {{month}} is now available."),
    ("payslip_reissued", "Payslip Reissued", "Payroll", "Your payslip for {{month}} has been reissued", "Hi {{first_name}}, your payslip for {{month}} was reissued."),
    ("leave_approved", "Leave Approved", "Leave", "Your leave request has been approved", "Hi {{first_name}}, your leave from {{start_date}} to {{end_date}} was approved."),
    ("leave_rejected", "Leave Rejected", "Leave", "Your leave request has been rejected", "Hi {{first_name}}, your leave from {{start_date}} to {{end_date}} was rejected."),
    ("document_verified", "Document Verified", "Employee", "Your document has been verified", "Hi {{first_name}}, your {{document_name}} was verified."),
    ("document_rejected", "Document Rejected", "Employee", "Your document was rejected", "Hi {{first_name}}, your {{document_name}} was rejected."),
    ("profile_change_approved", "Profile Change Approved", "Employee", "Your profile change was approved", "Hi {{first_name}}, your requested profile change was approved."),
    ("profile_change_rejected", "Profile Change Rejected", "Employee", "Your profile change was rejected", "Hi {{first_name}}, your requested profile change was rejected."),
    ("ticket_assigned", "Ticket Assigned", "Ticket", "Ticket {{ticket_no}} assigned to you", "Hi {{first_name}}, ticket {{ticket_no}} has been assigned to you."),
    ("asset_request_approved", "Asset Request Approved", "Asset Management", "Your asset request was approved", "Hi {{first_name}}, your request for {{asset_name}} was approved."),
    ("asset_request_rejected", "Asset Request Rejected", "Asset Management", "Your asset request was rejected", "Hi {{first_name}}, your request for {{asset_name}} was rejected."),
    ("resignation_acceptance_letter", "Resignation Acceptance Letter", "Employee", "Your resignation has been accepted", "Hi {{first_name}}, your resignation dated {{resignation_date}} has been accepted."),
    # {{reset_link}} carries a newly-generated temporary password, not a URL
    # — this codebase's reset_password flow has no click-a-link mechanism,
    # only a Super-Admin-issued temporary password (same pattern as
    # temporary_password's own create-login email). Wording matches that
    # reality rather than promising a link that doesn't exist.
    ("password_reset", "Password Reset", "Account", "Your password has been reset", "Hi {{first_name}}, your password has been reset. Your new temporary password is {{reset_link}} — please log in and change it immediately."),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        role_ids: dict[str, str] = {}
        for code, name in ROLES:
            existing = (await db.execute(select(Role).where(Role.code == code))).scalar_one_or_none()
            if existing:
                role_ids[code] = existing.id
                continue
            role = Role(id=str(uuid.uuid4()), code=code, name=name)
            db.add(role)
            role_ids[code] = role.id
        await db.flush()

        # RBAC §2.1's 47 named toggles (app/rbac/toggles.py, transcribed
        # verbatim from app-rbac.js's TOGGLES table). Seeded here as their
        # OWN table, independent of any screen — a toggle can gate an action
        # on a screen (app/rbac/toggles.py's ACTION_TOGGLE_GATES) but is not
        # owned by one.
        for toggle_key, module_key, default_enabled in TOGGLE_DEFAULTS:
            existing = (await db.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
            if existing:
                # Stage 15 (RBAC re-verification) found this branch used to do
                # nothing at all on re-seed — a toggle's module_key (admin-UI
                # grouping only) or default_enabled correcting in code never
                # reached an already-seeded row, exactly the class of drift
                # the Screen/ScreenAction sync fix above already closed for
                # actions. `enabled` is deliberately NEVER touched here — it's
                # Super Admin's own live runtime state, not something a
                # reseed should ever reset — only the declarative fields code
                # actually owns.
                existing.module_key = module_key
                existing.default_enabled = default_enabled
                continue
            db.add(
                FeatureToggle(
                    id=str(uuid.uuid4()), toggle_key=toggle_key, module_key=module_key,
                    label=toggle_key, enabled=default_enabled, default_enabled=default_enabled,
                )
            )
        await db.flush()

        screen_ids: dict[str, str] = {}
        new_action_rows = 0
        for key, screen_def in SCREENS.items():
            existing = (await db.execute(select(Screen).where(Screen.screen_key == key))).scalar_one_or_none()
            if existing:
                screen_ids[key] = existing.id
                # A screen row surviving from an earlier seed run doesn't
                # mean its ScreenAction children are still complete — a
                # later stage's ScreenDef can add a new action_key to an
                # ALREADY-seeded screen (e.g. Expense §6.1's manager_approve
                # added to expense.approvals, Invoice §6's confirm_paid/
                # view_financial_summary added to invoice.list), and this
                # loop used to `continue` right past that screen without
                # ever re-checking its actions. ScreenAction only backs the
                # RBAC admin Matrix UI's own per-role action checkboxes
                # (resolve_permission reads RolePermissionAction + the code-
                # level ACTION_TOGGLE_GATES, never this table) — so the gap
                # was silent: the toggle-gated action still worked correctly
                # end-to-end, it just never appeared as a Matrix UI row.
                existing_action_keys = {
                    a for a in (await db.execute(select(ScreenAction.action_key).where(ScreenAction.screen_id == existing.id))).scalars()
                }
                for action_key in screen_def.actions:
                    if action_key in existing_action_keys:
                        continue
                    db.add(ScreenAction(id=str(uuid.uuid4()), screen_id=existing.id, action_key=action_key, label=action_key.title()))
                    new_action_rows += 1
                continue
            screen = Screen(
                id=str(uuid.uuid4()),
                screen_key=key,
                module_key=screen_def.module,
                label=screen_def.label,
                has_scope=screen_def.has_scope,
            )
            db.add(screen)
            screen_ids[key] = screen.id
            for action_key in screen_def.actions:
                db.add(ScreenAction(id=str(uuid.uuid4()), screen_id=screen.id, action_key=action_key, label=action_key.title()))
            for field_key in screen_def.sensitive_fields:
                db.add(ScreenSensitiveField(id=str(uuid.uuid4()), screen_id=screen.id, field_key=field_key, label=field_key.replace("_", " ").title()))
        await db.flush()
        if new_action_rows:
            print(f"Action sync: added {new_action_rows} missing ScreenAction row(s) on already-seeded screens.")

        # ARCH-2 §3.1 / MASTER-BUILD-PROMPT.md §3: the hand-curated
        # `sensitive_fields` tuples above only ever covered a handful of
        # fields (deliberate carve-outs like Vendor's banking columns) —
        # nowhere near "every field on every screen governable". This
        # additively fills in the rest from the frontend's own screen
        # configs (see app/rbac/field_sync.py's docstring for the full
        # pipeline). Runs AFTER the loop above so a hand-curated row's label
        # is never overwritten by the auto-derived one for the same field.
        #
        # The manifest it reads (field_manifest.json, next to field_sync.py)
        # is generated by `node scripts/generate-field-manifest.js` in
        # frontend/ — a BUILD-TIME step, not run automatically here. Re-run
        # that script (and re-run this seed) whenever a *.config.ts file's
        # fields/columns change; this call alone won't pick up frontend edits.
        field_sync_result = await sync_fields_from_manifest(db, screen_ids)
        if field_sync_result.manifest_missing:
            print(f"Field manifest not found at {MANIFEST_PATH} — "
                  "run `node scripts/generate-field-manifest.js` in frontend/ to generate it. Skipping auto field sync.")
        else:
            print(
                "Field sync: added %d sensitive-field row(s) across %d screen(s) from field_manifest.json."
                % (field_sync_result.added, field_sync_result.screens_touched)
            )
            if field_sync_result.skipped_screens:
                print(
                    "Field sync: %d manifest screen(s) have no matching ScreenDef yet, skipped: %s"
                    % (len(field_sync_result.skipped_screens), ", ".join(sorted(field_sync_result.skipped_screens)))
                )

        for screen_key, per_role in SCREEN_PERMISSIONS.items():
            screen_id = screen_ids[screen_key]
            for role_code, mode in per_role.items():
                existing = (
                    await db.execute(
                        select(RolePermission).where(
                            RolePermission.role_id == role_ids[role_code],
                            RolePermission.screen_id == screen_id,
                        )
                    )
                ).scalar_one_or_none()
                if existing:
                    existing.mode = mode
                else:
                    db.add(RolePermission(id=str(uuid.uuid4()), role_id=role_ids[role_code], screen_id=screen_id, mode=mode))

        for screen_key, per_action in SCREEN_ACTION_PERMISSIONS.items():
            screen_id = screen_ids[screen_key]
            for action_key, allowed_roles in per_action.items():
                for role_code in allowed_roles:
                    existing = (
                        await db.execute(
                            select(RolePermissionAction).where(
                                RolePermissionAction.role_id == role_ids[role_code],
                                RolePermissionAction.screen_id == screen_id,
                                RolePermissionAction.action_key == action_key,
                            )
                        )
                    ).scalar_one_or_none()
                    if existing:
                        # Same insert-only flaw Stage 15 fixed for FeatureToggle
                        # above: this branch used to `pass` entirely, so a row
                        # whose `allowed` had drifted away from the canonical
                        # grant could never be repaired by re-seeding. That is
                        # not hypothetical — a PUT /rbac/matrix save (or any
                        # hand-edit) flipping one of these to allowed=0 left the
                        # role permanently denied an action SCREEN_ACTION_PERMISSIONS
                        # says it holds, because resolve_permission only ever
                        # reads `allowed.is_(True)` rows (app/rbac/resolver.py) —
                        # a false row is indistinguishable from no row at all.
                        #
                        # `allowed` IS the code-declared field here, exactly like
                        # RolePermission.mode / RolePermissionField.mode in the
                        # loops either side of this one, which have always been
                        # reset on re-seed: SCREEN_ACTION_PERMISSIONS listing a
                        # role under an action_key IS the statement "this role
                        # holds this action", so restoring True is restoring the
                        # canonical grant, not overwriting an operator's intent.
                        # Only rows the code itself declares are touched — a row
                        # for a role NOT in `allowed_roles` is never visited by
                        # this loop, so operator-added grants and denies outside
                        # the canonical set survive a reseed untouched.
                        existing.allowed = True
                    else:
                        db.add(
                            RolePermissionAction(
                                id=str(uuid.uuid4()),
                                role_id=role_ids[role_code],
                                screen_id=screen_id,
                                action_key=action_key,
                                allowed=True,
                            )
                        )

        for screen_key, per_field in SCREEN_FIELD_PERMISSIONS.items():
            screen_id = screen_ids[screen_key]
            for field_key, per_role in per_field.items():
                for role_code, mode in per_role.items():
                    existing = (
                        await db.execute(
                            select(RolePermissionField).where(
                                RolePermissionField.role_id == role_ids[role_code],
                                RolePermissionField.screen_id == screen_id,
                                RolePermissionField.field_key == field_key,
                            )
                        )
                    ).scalar_one_or_none()
                    if existing:
                        # `mode` is the code-declared field (SCREEN_FIELD_PERMISSIONS
                        # states show/mask/hide per role) and has always been
                        # reset here, so a drifted L3 row already self-repairs.
                        #
                        # `mask_reason` is deliberately NOT force-reset — and
                        # deliberately not set to None either. Unlike `mode` it
                        # has no code-declared counterpart at all:
                        # SCREEN_FIELD_PERMISSIONS carries only the mode string,
                        # so there is no canonical value for a reseed to restore.
                        # Blanking it would be a pure data loss on the same
                        # reasoning Stage 15 used to leave FeatureToggle.enabled
                        # alone — a reseed must only correct fields the code
                        # actually owns, never erase state it never declared.
                        existing.mode = mode
                    else:
                        db.add(
                            RolePermissionField(
                                id=str(uuid.uuid4()),
                                role_id=role_ids[role_code],
                                screen_id=screen_id,
                                field_key=field_key,
                                mode=mode,
                            )
                        )

        # Names match the prototype's own demo users exactly (data.js /
        # MASTER-BUILD-PROMPT.md §8.1's per-role acceptance table), so a
        # walkthrough as "Manager" in the build is recognizably the same
        # person the prototype's one-click role chip signed in as. All 5 now
        # seeded — previously only Super Admin and Employee existed, which
        # made "verified by walking as all 5 roles" (this project's own
        # definition-of-done requirement, §9) impossible to actually do.
        for email, name, role_code in [
            ("superadmin@meshrd.in", "Ravi Shankar", "SUPER_ADMIN"),
            ("manager@meshrd.in", "Vikram Iyer", "MANAGER"),
            ("accountant@meshrd.in", "Nisha Kulkarni", "ACCOUNTANT"),
            ("hr@meshrd.in", "Fatima Sheikh", "HR"),
            ("employee@meshrd.in", "Arun Menon", "EMPLOYEE"),
        ]:
            existing_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if existing_user:
                continue
            db.add(
                User(
                    id=str(uuid.uuid4()),
                    email=email,
                    password_hash=hash_password("Passw0rd!"),
                    full_name=name,
                    role_id=role_ids[role_code],
                    # Phase 7 hardening round 2: this security audit flagged
                    # a well-known seeded password with no forced rotation —
                    # closed now that must_change_password is actually
                    # enforced server-side (app/auth/deps.py). This only
                    # affects a FRESH `python -m app.seed` run against an
                    # empty database; it does not touch any already-seeded
                    # row, so this dev database's existing superadmin login
                    # is unaffected.
                    must_change_password=True,
                )
            )

        prefix_rules_added = 0
        for code_type, label, prefix, include_fy, digits, start in SEED_NUMBER_PREFIX_RULES:
            existing = (await db.execute(select(NumberPrefixRule).where(NumberPrefixRule.code_type == code_type))).scalar_one_or_none()
            if existing:
                continue
            db.add(
                NumberPrefixRule(
                    id=str(uuid.uuid4()),
                    code_type=code_type,
                    label=label,
                    prefix=prefix,
                    include_fy_in_code=include_fy,
                    running_number_digits=digits,
                    starting_number=start,
                    resets_every_fy=True,
                )
            )
            prefix_rules_added += 1

        templates_added = 0
        for template_key, template_name, module, subject, body in SEED_EMAIL_TEMPLATES:
            existing = (await db.execute(select(EmailTemplate).where(EmailTemplate.template_key == template_key))).scalar_one_or_none()
            if existing:
                continue
            db.add(
                EmailTemplate(
                    id=str(uuid.uuid4()),
                    template_key=template_key,
                    template_name=template_name,
                    triggered_from_module=module,
                    is_enabled=True,
                    subject=subject,
                    body=body,
                    available_placeholders=[],
                )
            )
            templates_added += 1

        states_added = 0
        for name, code, gst_code in SEED_INDIAN_STATES:
            existing = (await db.execute(select(IndianState).where(IndianState.name == name))).scalar_one_or_none()
            if existing:
                continue
            db.add(IndianState(id=str(uuid.uuid4()), name=name, code=code, gst_state_code=gst_code))
            states_added += 1

        await db.commit()
        print(
            "Seed complete: 5 roles, %d screen(s), 2 users, %d number prefix rule(s), %d email template(s), %d Indian state(s)."
            % (len(screen_ids), prefix_rules_added, templates_added, states_added)
        )


if __name__ == "__main__":
    asyncio.run(seed())
