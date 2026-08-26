"""RBAC §2.1's 47 named feature flags, transcribed verbatim from the
prototype's app-rbac.js TOGGLES table (key + default), plus the (screen,
action) pairs a toggle can additionally unlock beyond the static
role_permission_actions rows.

WHY A CODE REGISTRY, NOT A DATA TABLE, FOR THE GATES THEMSELVES: the
prototype's own ACTIONS table is JS closures over TOGGLES (app-rbac.js:
224-251) — code, not data — because WHICH toggle governs WHICH action is a
fixed business-logic association from the specs, not something Super Admin
picks arbitrarily at runtime. What IS runtime-editable is each toggle's own
enabled/disabled VALUE — that lives in the FeatureToggle table (seeded from
TOGGLE_DEFAULTS below) and is what the RBAC admin UI's Toggles panel edits.
This mirrors the existing code/data split in this codebase exactly: ScreenDef
(code) declares what CAN exist; RolePermission* (data) says who gets it.

Only the pairs relevant to screens ALREADY REGISTERED are wired in below —
add each module's real gates in the same phase that builds it, the same
"register as you build" pattern ScreenDef itself already follows. Do not
pre-wire a gate for a screen_key with no ScreenDef — resolve_permission
would just silently never match it.

Two gate shapes, not one: ACTION_TOGGLE_GATES adds an action on a screen the
role can already open (e.g. Accountant already sees Taxes, a toggle just
also lets them edit it); MODE_TOGGLE_GATES widens the mode itself — real
visibility into rows the role otherwise can't see or open at all (e.g.
Employee's ticket.list mode is 'own' by default; "Allow Staff to View the
Full Open Ticket Queue" needs to make it 'full', not merely add a button).
Kept as two separate dicts because a mode override has to apply BEFORE any
action-gate check runs — see resolver.py's `_apply_toggle_gates`/
`_apply_mode_gate`, called in that order in both resolve_permission and
resolve_all_permissions.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ToggleGate:
    toggle_key: str
    # Only these roles receive the extra grant — Super Admin already has
    # 'full' mode via role_permissions and never needs a toggle to unlock
    # anything, so gates only ever list the role(s) actually being escalated.
    roles: tuple[str, ...]
    # True: the grant is active while the toggle is OFF (a small number of
    # app-rbac.js's FIELDS rules use `invert: true`; no current ACTIONS entry
    # does, but the flag exists so a future one doesn't need a resolver change).
    invert: bool = False


@dataclass(frozen=True)
class ModeGate:
    """Widens Layer 1+4 (mode) itself, not just Layer 2 (an action) — for a
    toggle like "Allow Staff to View the Full Open Ticket Queue" where the
    grant is real visibility into rows the role otherwise can't see at all,
    not an extra button on rows already in scope. ACTION_TOGGLE_GATES can't
    express this: it only ever adds to `allowed_actions`, on a screen the
    role could already open. Only ever replaces `mode` with something
    STRICTLY MORE OPEN than the role's own seeded default (never used to
    narrow), and only for the named role(s) — Super Admin needs no gate,
    same reasoning as ToggleGate above.
    """
    toggle_key: str
    roles: tuple[str, ...]
    mode: str


# (screen_key, action_key) -> ToggleGate
ACTION_TOGGLE_GATES: dict[tuple[str, str], ToggleGate] = {
    # app-rbac.js:225 — 'Add Tax Head': r === 'superadmin' || (r === 'accountant'
    # && TOGGLES['Allow Accountant to Manage Taxes']). masters.taxes' action key
    # is 'edit' (this codebase's coarse per-screen action convention), and
    # seed.py's SCREEN_ACTION_PERMISSIONS already grants SUPER_ADMIN edit
    # statically — this gate is what makes the escalation to Accountant real,
    # closing the exact gap 01-masters-module.md §3.0 documents as "not wired
    # yet" (the flag existed as a name in the spec with no runtime effect).
    ("masters.taxes", "edit"): ToggleGate(toggle_key="Allow Accountant to Manage Taxes", roles=("ACCOUNTANT",)),
    # Asset §6.5/§2.3: OFF by default, Manager can only approve/reject
    # Repair/Damage/Return requests (asset.requests); ON, Manager gets the
    # same 'assign' action HR already holds (Assign/Transfer/Unassign,
    # §2.3) on their own direct reports' assets — asset.directory's
    # has_scope=True view_team mode already narrows that to direct reports,
    # the same as every other team-scoped grant in this codebase. This
    # closes 03-asset-management-module.md §6.5's own "deferred, not
    # modeled" note for this one toggle — the module now exists, so per
    # toggles.py's own module docstring ("add their pairs here in the same
    # phase that builds each module"), it should have been wired already.
    ("asset.directory", "assign"): ToggleGate(toggle_key="Allow Manager to Reassign Assets Directly", roles=("MANAGER",)),
    # Ticket §6.2: OFF by default, only Manager/Super Admin reassigns a
    # ticket; ON, an Employee gets 'reassign' too — but their `mode` stays
    # 'own' (see MODE_TOGGLE_GATES below, untouched by this gate), so the
    # existing scope check on ticket.list still narrows them to tickets
    # already assigned to them, exactly matching §2.4's "even then only for
    # tickets already assigned to them."
    ("ticket.list", "reassign"): ToggleGate(toggle_key="Allow Staff to Reassign Their Own Ticket", roles=("EMPLOYEE",)),
    # Ticket §6.2: OFF by default, only Manager/Super Admin logs a new
    # ticket; ON, an Employee gets 'create' too.
    ("ticket.list", "create"): ToggleGate(toggle_key="Allow Staff to Create New Tickets", roles=("EMPLOYEE",)),
    # Leave §6.2: OFF by default, leave.balance_management is fully invisible
    # to Manager (seed.py: mode "none") — only HR/Super Admin correct a
    # balance. ON, Manager gets 'adjust' too, but only for their own direct
    # reports (api/v1/leave_balance.py's adjust_leave_balance re-checks this
    # explicitly, the same "not one of your direct reports" 403
    # decide_leave_request already uses — mode alone isn't enough of a check
    # since it narrows the LIST, not this specific write). Same toggle key as
    # the ModeGate below — deliberately ONE switch, not two independently
    # toggleable gates: unlike Ticket's queue-view/reassign pair, there's no
    # combination-of-two-toggles risk here because mode and action always
    # move together.
    ("leave.balance_management", "adjust"): ToggleGate(toggle_key="Allow Manager to Adjust Team Leave Balance", roles=("MANAGER",)),
    # Payroll §6.1: OFF by default, Manager holds neither action statically
    # (seed.py). ON, Manager gets both — same ModeGate/toggle-key pairing
    # pattern as Leave's balance-adjust toggle above, except this one is
    # company-wide 'full' (§6's own words: "restores the full company-wide
    # run-and-view-all access"), not team-scoped, so no extra per-row check
    # is needed beyond the mode itself — 'full' already means every employee.
    ("payroll.run", "run"): ToggleGate(toggle_key="Allow Manager to Run Payroll", roles=("MANAGER",)),
    ("payroll.run", "confirm"): ToggleGate(toggle_key="Allow Manager to Run Payroll", roles=("MANAGER",)),
    # Payroll §6.1: OFF by default, payroll.adhoc_adjustments is fully
    # invisible to HR (seed.py: mode "none") — kept to Accountant/Super Admin
    # specifically. ON, HR gets full access too — company-wide, matching
    # Accountant's own unscoped grant, not team-scoped (§6.1's own words:
    # "HR could add one-off bonuses/recoveries too").
    ("payroll.adhoc_adjustments", "edit"): ToggleGate(toggle_key="Allow HR to Add Ad-hoc Payslip Adjustments", roles=("HR",)),
    # Customer §6.1: OFF by default, Accountant's only customer-facing
    # surface is the plain picker (GET /customers/picker, always on). ON,
    # Accountant additionally gets view_financial_summary on invoice.list
    # (not customer.directory — Accountant has zero access to that screen,
    # toggle or no toggle) — "without full Customer 360 access," per §6.1's
    # own words, so this is a narrow action grant, never a mode widening.
    ("invoice.list", "view_financial_summary"): ToggleGate(toggle_key="Give Accountant Read Access to Customer Financial Summary", roles=("ACCOUNTANT",)),
    # Project §6.1: OFF by default, project.sprints' action grants (seed.py)
    # hold 'manage' for SUPER_ADMIN/MANAGER only — Employee's mode is already
    # 'own' (Lead-or-Member scoped via project_scope), so this gate is purely
    # additive: it never widens WHICH projects an Employee can touch, only
    # what they can do on ones they're already scoped into, matching §6.1's
    # own words ("without needing Manager-level access").
    ("project.sprints", "manage"): ToggleGate(toggle_key="Allow Employee to Manage Sprints on Their Own Projects", roles=("EMPLOYEE",)),
    # Expense §6.1: OFF by default, MANAGER holds no action on
    # expense.approvals at all (seed.py: mode 'none'). ON, MANAGER gets
    # 'manager_approve' (api/v1/expenses.py's manager_approve_expense_claim,
    # the sign-off step BEFORE Accountant's own approve()) — same
    # ModeGate/toggle-key pairing pattern as Leave's balance-adjust toggle
    # above: mode and action always move together, one switch.
    ("expense.approvals", "manager_approve"): ToggleGate(toggle_key="Allow Manager to Approve Their Team's Expenses", roles=("MANAGER",)),
}

# screen_key -> ModeGate. Kept separate from ACTION_TOGGLE_GATES above (a
# different dict, not a union) because a mode override needs to apply BEFORE
# the action-gate logic runs (actions are only ever granted on top of an
# already-visible mode) — see resolver.py's own call order.
MODE_TOGGLE_GATES: dict[str, ModeGate] = {
    # Ticket §2.1/§6.2: OFF by default, Employee's ticket.list mode stays
    # 'own' (seed.py) — they see only tickets assigned to them. ON, mode
    # becomes 'full': every ticket, matching §2.1's own words ("they can see
    # every open ticket"). Deliberately NOT 'view' — Employee already holds
    # no create/reassign/close action by default (those need their own,
    # separate toggles above/§6.2), so 'full' here only ever widens WHICH
    # rows they can see, never what they can do to a row outside their own —
    # the ACTION_TOGGLE_GATES entries above are what (separately) grant
    # create/reassign, and 'close' has no Employee gate anywhere (§2.3:
    # closing is never the assignee's call alone, full stop, no toggle
    # overrides that one).
    "ticket.list": ModeGate(toggle_key="Allow Staff to View the Full Open Ticket Queue", roles=("EMPLOYEE",), mode="full"),
    # Ticket §2.5/§6.2: OFF by default, Employee has no access at all
    # (mode='none', seed.py) to Support Reports. ON, mode becomes 'full' —
    # this screen has zero actions registered (screens.py: actions=()), so
    # 'full' vs 'view' has no behavioral difference here; 'full' matches the
    # equivalent all-visibility grant Accountant/HR hold on Asset Reports.
    "ticket.reports": ModeGate(toggle_key="Show Support Reports to Staff", roles=("EMPLOYEE",), mode="full"),
    # Leave §6.2, paired with the ACTION_TOGGLE_GATES entry above under the
    # SAME toggle key: 'team', not 'full' — a Manager only ever gets their
    # own direct reports' balances, both to see (list_leave_balances' own
    # apply_scope call) and to adjust.
    "leave.balance_management": ModeGate(toggle_key="Allow Manager to Adjust Team Leave Balance", roles=("MANAGER",), mode="team"),
    # Payroll §6.1, paired with the two ACTION_TOGGLE_GATES entries above
    # under the SAME toggle key: 'full', not team-scoped — restores the
    # source sheet's original company-wide "run payroll + view all" access.
    "payroll.run": ModeGate(toggle_key="Allow Manager to Run Payroll", roles=("MANAGER",), mode="full"),
    # Payroll §6.1, paired with the ACTION_TOGGLE_GATES entry above under the
    # SAME toggle key: 'full', company-wide — same reasoning, HR gets exactly
    # what Accountant already has, not a narrower team-scoped version of it.
    "payroll.adhoc_adjustments": ModeGate(toggle_key="Allow HR to Add Ad-hoc Payslip Adjustments", roles=("HR",), mode="full"),
    # Project §6.1: OFF by default, project.report seeds Employee mode='none'
    # (seed.py) — a 404, matching 10-project-module.md §2.7's own words ("an
    # Employee calling it gets a 404"). ON, mode becomes 'own': the doc's own
    # §2.7 text confirms "the endpoint already runs the shared per-project
    # scope check so a future 'own'-scoped grant would work without code
    # changes" — 'own' here means Lead-or-Member of that specific project
    # (project_scope.is_project_team_member), same semantics as
    # project.directory/board/sprints/milestones' own 'own' mode, not
    # 'full' — §6.1: "for their own projects."
    "project.report": ModeGate(toggle_key="Show Project Report to Employee", roles=("EMPLOYEE",), mode="own"),
    # Invoice §6.2 "Show Non-Financial Dashboard Widgets to HR" — OFF by
    # default, HR seeds mode='none' on invoice.dashboard (a flat 404, per
    # 11-invoice-module.md §2.1: "HR sees a stripped-down version if a
    # specific toggle is on... Employee and Manager have no access" — this
    # is that toggle). ON, mode becomes 'view': the dashboard has no
    # registered actions at all (screens.py: actions=()), so 'view' vs
    # 'full' has no behavioral difference here — 'view' is chosen anyway
    # since HR's grant is read-only-with-restricted-content, same
    # semantics-over-mechanics reasoning as ticket.reports' own 'full'
    # comment just above, the other direction. Which widgets HR actually
    # sees (the 3 non-financial ones, never revenue) is decided inside
    # invoice_dashboard() itself by role_code, not by mode.
    "invoice.dashboard": ModeGate(toggle_key="Show Non-Financial Dashboard Widgets to HR", roles=("HR",), mode="view"),
    # Expense §6.1, paired with the ACTION_TOGGLE_GATES entry above under the
    # SAME toggle key: 'team', not 'full' — a Manager only ever sees (and can
    # sign off on) their own direct reports' claims, matching Leave's
    # balance-adjust ModeGate immediately above (identical reasoning, same
    # toggle shape).
    "expense.approvals": ModeGate(toggle_key="Allow Manager to Approve Their Team's Expenses", roles=("MANAGER",), mode="team"),
    # Purchase Bill §6.2 "Give Manager Read-Only Access to Purchase Bills" —
    # OFF by default, Manager seeds mode='none' (seed.py) — no access at
    # all, per §6's "Manager runs relationships and delivery, and has zero
    # access to money movement." ON, mode becomes 'view' — visibility only,
    # "without any edit rights" per the toggle's own words; no paired
    # ACTION_TOGGLE_GATES entry, unlike Leave/Payroll's own paired toggles
    # above, since this toggle grants no action at all, only the mode widen.
    "purchase_bill.list": ModeGate(toggle_key="Give Manager Read-Only Access to Purchase Bills", roles=("MANAGER",), mode="view"),
}

# Every toggle from app-rbac.js's TOGGLES table (lines 30-78), verbatim key
# and default, plus every toggle this sweep added building out modules the
# prototype never had gate logic for (Invoice/Expense/Purchase Bill/
# Compliance). module_key assigned by which module's spec section documents
# each flag — used only for grouping in the admin UI, never consulted by the
# resolver itself (ACTION_TOGGLE_GATES is what makes a toggle load-bearing).
# Stage 15 (RBAC re-verification) removed one dead entry the prototype
# transcription had carried forward: "Show Salary Amount to Manager" governed
# the Team Payslips screen, which 14-rbac-module.md §2.1 (line 81) confirms
# was removed entirely from both Employee and Payroll — the doc keeps that
# row struck through only so a future revision reintroducing a team-level pay
# view knows which name to reuse, not as an instruction to keep shipping a
# live toggle with nothing left for it to gate. Only 2 of the 50 default to
# True (Manager Acknowledgment, Payslip Reissue Notification) — everything
# else defaults off, matching the platform-wide default-deny posture
# (app/rbac/resolver.py's own docstring).
TOGGLE_DEFAULTS: list[tuple[str, str, bool]] = [
    ("Allow Employee to Edit Bank Details Directly", "employee", False),
    ("Show Financial Year Management to Manager", "masters", False),
    ("Allow Manager to Edit Team Member Employment Details", "employee", False),
    ("Require Manager Acknowledgment Before HR Processes Exit", "employee", True),
    ("Allow HR to Edit Salary Structure", "employee", False),
    ("Allow HR to Edit Statutory Applicability Toggles", "employee", False),
    ("Allow Employee to Change Insurance Plan Mid-Year", "employee", False),
    ("Allow Accountant to Manage Taxes", "masters", False),
    ("Allow Manager to Reassign Assets Directly", "asset", False),
    ("Show Purchase Value to Manager", "asset", False),
    ("Allow HR to Edit Depreciation Method", "asset", False),
    ("Allow HR to Edit Core Info", "asset", False),
    ("Allow Staff to View the Full Open Ticket Queue", "ticket", False),
    ("Allow Staff to Reassign Their Own Ticket", "ticket", False),
    ("Show Support Reports to Staff", "ticket", False),
    ("Allow Staff to Create New Tickets", "ticket", False),
    ("Require Satisfaction Rating on Close", "ticket", False),
    ("Allow Manager to Adjust Team Leave Balance", "leave", False),
    # Leave §6.2. Not a resolver-level gate — like Expense's own
    # threshold/receipt toggles it is business logic inside the router, read
    # live at decision time by api/v1/leave_requests.py's
    # _hr_co_approval_threshold(). It carries a companion number (the "X
    # Days") in FeatureToggle.numeric_value, the same column Expense's "Set
    # an Auto-Approval Threshold" introduced; with no number configured the
    # toggle has nothing to compare against and stays inert.
    ("Require HR Co-Approval for Leave Longer Than X Days", "leave", False),
    ("Allow Manager to Run Payroll", "payroll", False),
    ("Allow HR to Add Ad-hoc Payslip Adjustments", "payroll", False),
    ("Hide Ad-hoc Adjustment Labels from Employee", "payroll", False),
    ("Require Super Admin Approval to Reissue a Payslip", "payroll", False),
    ("Notify Employee When a Payslip Is Reissued", "payroll", True),
    ("Allow Manager to Edit Vendor Bank & GST Details", "vendor", False),
    ("Allow Hard Delete of a Vendor", "vendor", False),
    ("Require Approval to Add a New Vendor", "vendor", False),
    ("Restrict Manager to Only Their Own Customers", "customer", False),
    ("Give Accountant Read Access to Customer Financial Summary", "customer", False),
    ("Allow Employee to Log Activities on Customers They're Staffed On", "customer", False),
    ("Restrict Manager to Only Their Own Opportunities", "opportunity", False),
    ("Give Accountant Read Access to Pipeline Value", "opportunity", False),
    ("Allow Employee to View the Opportunity Behind Their Assigned Project", "opportunity", False),
    ("Restrict Manager to Only Projects They Manage", "project", False),
    ("Give Accountant Read Access to Project Budgets", "project", False),
    ("Allow Employee to Manage Sprints on Their Own Projects", "project", False),
    ("Show Project Report to Employee", "project", False),
    ("Hide Budget from Employee's Project View", "project", False),
    ("Allow Manager Read-Only Access to Their Projects' Invoices", "project", False),
    ("Require Second Approval Before an Invoice Locks as Paid", "invoice", False),
    # Governs invoice.dashboard (11-invoice-module.md §6.2) — mis-filed
    # under "employee" previously; module_key is admin-UI grouping only
    # (never consulted by the resolver, this file's own docstring), so the
    # fix is cosmetic, but it belongs with the other two Invoice toggles.
    ("Show Non-Financial Dashboard Widgets to HR", "invoice", False),
    ("Allow Manager to Approve Their Team's Expenses", "expense", False),
    ("Require a Receipt Before Approval", "expense", False),
    ("Set an Auto-Approval Threshold", "expense", False),
    ("Auto-Mark as Reimbursed When Paid via Payroll", "expense", False),
    # 13-purchase-bill-module.md §6.2. Named in data.js's own module-grouping
    # list but never actually given a default in the prototype's real
    # app-rbac.js TOGGLES table (a prototype-level inconsistency, not
    # something to carry forward) — OFF matches the doc's own stated default
    # for all three, same as every other toggle here.
    ("Require Attachment Before Marking a Bill Paid", "purchase_bill", False),
    ("Lock Purchase Bill Once Fully Paid", "purchase_bill", False),
    ("Give Manager Read-Only Access to Purchase Bills", "purchase_bill", False),
    # 15-tax-compliance-module.md §6.1 — the module's one explicitly-deferred
    # toggle; Reverse/Void's own "OFF by default" is a plain seeded role
    # grant, not a toggle at all (confirmed against the doc's own §6.1 text),
    # so this is the only real toggle this module needs.
    ("Require an Attachment Before Recording a Remittance", "compliance", False),
    ("Give HR Read-Only Access to the Permission Matrix", "rbac", False),
]
