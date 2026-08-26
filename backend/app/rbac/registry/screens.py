"""THE SCREEN REGISTRY — code, not data (ARCH-2 §3.1).

Every screen this system has, what actions it carries, and which fields on it
are sensitive, are declared here. This is deliberately code: it can be
typo-checked, imported by tests, and diffed in review. WHO may do what with
each of these is data — rows in role_permissions / role_permission_actions /
role_permission_fields (app/models/rbac.py) — seeded from this registry.

Phase 0 seeds one real screen end-to-end (Financial Year) as the vertical
slice proving the pattern. Every other module's screens get added the same
way when that module is built — see BUILD-PROMPT §13 phase plan.

Transcribed from the prototype's app-rbac.js POLICY/ACTIONS tables, which is
a working, validated authorization matrix — not invented fresh here.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ScreenDef:
    key: str
    module: str
    label: str
    has_scope: bool = True
    actions: tuple[str, ...] = field(default_factory=tuple)
    sensitive_fields: tuple[str, ...] = field(default_factory=tuple)


def _lookup(key: str, label: str, manage_can_delete: bool = False) -> ScreenDef:
    """The 15 simple lookup sub-masters (Masters §3.0) share one shape: list +
    add + edit, with delete/deactivate reserved for Super Admin. `edit` covers
    both create and update (one form, per the prototype and every module
    doc's "+ Add X" pattern); `delete` covers both hard-delete-if-unused and
    deactivate, since Masters §3.0 rule 1 governs them identically ("Delete
    and Deactivate are Super Admin only").
    """
    return ScreenDef(key=key, module="masters", label=label, has_scope=False, actions=("edit", "delete"))


SCREENS: dict[str, ScreenDef] = {
    "masters.financial_year": ScreenDef(
        key="masters.financial_year",
        module="masters",
        label="Financial Year",
        has_scope=False,  # company-wide and singular — Masters §3.1
        # 'set_current' added in Phase 2: every module that snapshots a
        # financial_year_id on create (Employee, Salary Structure, Leave,
        # Attendance, ...) resolves "today's FY" from the one row flagged
        # is_current — Phase 0/1 never needed to read it, so no endpoint to
        # set it existed until a real caller (Phase 2) needed it.
        # 'unlock' — explicit product decision reversing A002's original
        # "categorically one-way, not even Super Admin" rule: Super Admin now
        # has a genuine, RBAC-gated override. See migration 0009's docstring
        # for how the DB trigger still enforces that ONLY this action can do
        # it, not "any code that happens to run as this role."
        # 'delete' — MASTER-BUILD-PROMPT.md §4.1 + §4a: a real DELETE now
        # exists, gated on this named action per the codebase's own
        # convention (every mutation gets its own action, even on a screen
        # that is already Super-Admin-only end to end) — matches
        # masters_lookup.py's factory screens, which do the same.
        actions=("edit", "lock", "set_current", "unlock", "delete"),
    ),
    # Masters §3.2 — the largest sub-master. manage_schemes/manage_reliefs
    # ride on the same "edit" action as the head itself (all one form family);
    # duplicate is a read+create operation, not a distinct permission.
    "masters.taxes": ScreenDef(
        key="masters.taxes", module="masters", label="Taxes", has_scope=False, actions=("edit", "delete")
    ),
    "masters.expense_types": _lookup("masters.expense_types", "Expense Types"),
    "masters.leave_types": _lookup("masters.leave_types", "Leave Types"),
    "masters.holidays": ScreenDef(
        key="masters.holidays", module="masters", label="Holidays", has_scope=False,
        actions=("edit", "delete", "import"),  # §3.5: CSV bulk import, Super Admin + Manager
    ),
    # Masters §3.6 — singleton, five inner tabs, all governed by one 'edit'.
    "masters.company_profile": ScreenDef(
        key="masters.company_profile", module="masters", label="Company Profile", has_scope=False, actions=("edit",)
    ),
    "masters.bank_accounts": _lookup("masters.bank_accounts", "Bank Account"),
    "masters.payment_modes": _lookup("masters.payment_modes", "Payment Mode"),
    "masters.departments": _lookup("masters.departments", "Department"),
    "masters.designations": _lookup("masters.designations", "Designation / Job Title"),
    "masters.hsn_sac_codes": _lookup("masters.hsn_sac_codes", "HSN / SAC Code"),
    "masters.service_categories": _lookup("masters.service_categories", "Service Category"),
    "masters.units_of_measure": _lookup("masters.units_of_measure", "Unit of Measure"),
    "masters.ticket_categories": _lookup("masters.ticket_categories", "Ticket Categories"),
    "masters.customer_statuses": _lookup("masters.customer_statuses", "Customer Status"),
    "masters.customer_sources": _lookup("masters.customer_sources", "Customer Source"),
    "masters.asset_categories": _lookup("masters.asset_categories", "Asset Categories"),
    "masters.employment_types": _lookup("masters.employment_types", "Employment Type"),
    "masters.insurance_plans": _lookup("masters.insurance_plans", "Insurance Plans"),
    # Masters §3.20 — six inner tabs (Policies, Daily Hours, Saturday
    # Calendar, Compensation, Pay Cycle, Where Used); one 'edit' action covers
    # policy + pay-cycle writes, 'override_saturday' the dated exception rows.
    "masters.work_week_hours": ScreenDef(
        key="masters.work_week_hours", module="masters", label="Work Week & Hours", has_scope=False,
        actions=("edit", "delete", "override_saturday"),
    ),
    # Masters §3.21 — Server Settings (singleton) + Templates (never deleted,
    # only enabled/disabled by default — 'create' is the one exception: "Super
    # Admin can add a row here the moment a future module introduces a new
    # notification") + Recent Sends (read-only log).
    "masters.email_configuration": ScreenDef(
        key="masters.email_configuration", module="masters", label="Email Configuration", has_scope=False,
        actions=("edit", "create", "send_test"),
    ),

    # ==================================================== PHASE 2 — EMPLOYEE
    # Employee §2.1: has_scope=True — Manager's rows are scoped to direct
    # reports (L4 'team'), Accountant/HR/Super Admin get company-wide ('full').
    "employee.directory": ScreenDef(key="employee.directory", module="employee", label="Employee Directory", has_scope=True, actions=()),
    # §2.2: Personal/Employment/Bank/Emergency Contact/Account & Login tabs —
    # one 'edit' action for HR+Super Admin. Salary Structure and Insurance
    # are governed separately below since their RBAC genuinely differs.
    # Document verification lives on employee.documents' "verify" action even
    # when the button is shown from inside this record's Documents tab —
    # same underlying rows, one RBAC gate, not two.
    "employee.master_record": ScreenDef(
        key="employee.master_record", module="employee", label="Employee Master Record", has_scope=True,
        actions=("edit", "manage_login"),
    ),
    # §2.2 Salary Structure tab: Super Admin edits everything; Accountant may
    # edit ONLY the per-line Applicable toggles (edit_applicability) — the
    # one deliberate exception to "Salary Structure is Super Admin only".
    # sensitive_fields was EMPTY here, which meant Layer 3 did not exist on the
    # screen that carries the most sensitive numbers in the app. The field
    # wasn't merely un-restricted by default — it was ungovernable: with no
    # ScreenSensitiveField rows, the Permission Matrix had nothing to offer,
    # and a directly-written RolePermissionField was resolved and then
    # discarded because the read routes never masked. Declaring the money
    # fields makes them governable; seed.py decides the shipped defaults.
    "employee.salary_structure": ScreenDef(
        key="employee.salary_structure", module="employee", label="Salary Structure", has_scope=True,
        actions=("edit", "edit_applicability"),
        sensitive_fields=(
            "basic_salary_monthly",
            "dearness_allowance_monthly",
            "hra_monthly",
            "lta_amount",
            "special_allowance_monthly",
            "other_earnings_monthly",
            "variable_pay_amount",
            "gross_monthly",
            "variable_pay_annualised",
            "net_monthly",
            "annual_ctc",
        ),
    ),
    # §2.2 Insurance & Benefits tab: HR + Super Admin edit.
    "employee.insurance": ScreenDef(key="employee.insurance", module="employee", label="Insurance & Benefits", has_scope=True, actions=("edit",)),
    # §2.3 — always "own" scope in practice; every role gets it identically.
    "employee.my_profile": ScreenDef(key="employee.my_profile", module="employee", label="My Profile", has_scope=True, actions=("edit", "request_change", "approve_change")),
    # §2.6 — same screen, scope differs by role: Employee/Manager/Accountant
    # get 'own', HR/Super Admin get 'full' (the cross-employee queue).
    "employee.documents": ScreenDef(key="employee.documents", module="employee", label="My Documents", has_scope=True, actions=("upload", "delete", "verify")),
    # §2.2 Leave & Attendance Summary tab — "only Super Admin can manually
    # record an employee's check-in and check-out" today.
    "employee.attendance": ScreenDef(key="employee.attendance", module="employee", label="Attendance", has_scope=True, actions=("record",)),
    "employee.onboarding": ScreenDef(key="employee.onboarding", module="employee", label="Onboarding Checklist", has_scope=False, actions=("edit", "send_welcome_email")),
    # §2.13 — raising your own resignation is universal (own scope); running
    # the exit checklist is HR/Super Admin, acknowledging is Manager(team).
    "employee.offboarding": ScreenDef(key="employee.offboarding", module="employee", label="Offboarding / Exit", has_scope=True, actions=("raise_resignation", "acknowledge", "process_exit")),
    # 'manage' is Super Admin's own "Full, all employees" edit reach (§2.14's
    # access table) — distinct from 'verify' (Accountant/HR: "View-only, all
    # employees"), so holding 'verify' can never imply edit access to
    # someone else's declaration. Found as a real gap by the Phase 2 audit.
    "employee.tax_declarations": ScreenDef(key="employee.tax_declarations", module="employee", label="My Tax Declarations", has_scope=True, actions=("edit", "submit", "verify", "manage")),
    # §2.15 — per the module's own access table this is Accountant + Super
    # Admin, NOT HR (a deliberate, spec-stated exception worth flagging
    # inline since it looks like a typo but isn't).
    "employee.offer_letters": ScreenDef(key="employee.offer_letters", module="employee", label="Offer & Appointment Letter", has_scope=True, actions=("edit", "generate", "send")),
    "employee.announcements": ScreenDef(key="employee.announcements", module="employee", label="Announcements", has_scope=False, actions=("post",)),

    # ======================================================= PHASE 2 — LEAVE
    "leave.my_leave": ScreenDef(key="leave.my_leave", module="leave", label="My Leave", has_scope=True, actions=("apply", "cancel")),
    "leave.approvals": ScreenDef(key="leave.approvals", module="leave", label="Leave Approvals", has_scope=True, actions=("approve",)),
    # has_scope=True since the "Allow Manager to Adjust Team Leave Balance"
    # toggle (rbac/toggles.py) gives Manager a real 'team' mode here — HR/
    # Super Admin's own static grant stays 'full', unaffected.
    "leave.balance_management": ScreenDef(key="leave.balance_management", module="leave", label="Leave Balance Management", has_scope=True, actions=("adjust", "run_carry_forward")),
    "leave.compensatory_hours": ScreenDef(key="leave.compensatory_hours", module="leave", label="Compensatory Hours", has_scope=True, actions=("request", "approve")),
    # §2.5 Leave Reports — found entirely unimplemented by the Phase 2 audit,
    # which left Accountant's "read access to Leave Reports" (§6) as their
    # ONLY capability anywhere in this module unfulfilled.
    "leave.reports": ScreenDef(key="leave.reports", module="leave", label="Leave Reports", has_scope=False, actions=()),

    # ===================================================== PHASE 3 — PAYROLL
    # §2.1/§6: Accountant/HR/Super Admin by default; Manager only via the
    # "Allow Manager to Run Payroll" toggle (default OFF, A124). FeatureToggle
    # exists as a data model (Phase 0) but isn't wired into resolve_permission
    # yet — the OFF default is achieved here simply by never granting Manager
    # the role-level permission; Super Admin's existing UserPermissionOverride
    # mechanism (already fully wired) is the documented fallback for turning
    # it on for one specific person, matching the spec's own "per-person
    # overrides" escape hatch (§6.1).
    "payroll.run": ScreenDef(key="payroll.run", module="payroll", label="Run Payroll", has_scope=False, actions=("run", "confirm")),
    # §2.1a/A133: Accountant + Super Admin only; HR only via its own
    # toggle (default OFF), same reasoning as above.
    "payroll.adhoc_adjustments": ScreenDef(key="payroll.adhoc_adjustments", module="payroll", label="Ad-hoc Payslip Adjustments", has_scope=False, actions=("edit",)),
    # §2.2 — "own baseline" by construction for every role, same pattern as
    # employee.my_profile / leave.my_leave.
    "payroll.my_payslips": ScreenDef(key="payroll.my_payslips", module="payroll", label="My Payslips", has_scope=True, actions=()),
    # §2.3 — Accountant/HR/Super Admin, full company-wide, plus Reissue.
    # §6.1 "Require Super Admin Approval to Reissue a Payslip" restricts
    # who may call reissue at all while ON (api/v1/payslips.py's own
    # reissue_payslip) rather than adding a separate approval action — see
    # that function's own docstring for why the genuine async request/
    # approve queue isn't buildable without a migration touching two
    # existing CHECK constraints on this table.
    "payroll.payslips_admin": ScreenDef(key="payroll.payslips_admin", module="payroll", label="Payslip — Accountant/HR View", has_scope=False, actions=("reissue",)),
    # §2.4 — its own screen key, deliberately not reusing employee.attendance's
    # 'record' action: Accountant/Employee have NO access here at all, which
    # differs from employee.attendance's own access table.
    "payroll.attendance_time_basis": ScreenDef(key="payroll.attendance_time_basis", module="payroll", label="Attendance & Time Basis", has_scope=True, actions=()),

    # ===================================================== PHASE 4 — FINANCE
    # §6, cross-checked against the source sheet: Manager Full, Super Admin
    # Full, Accountant/HR/Employee NA — Customer/CRM data doesn't carry
    # payroll's personal-privacy weight, so (unlike Payroll) Manager's broad
    # grant is kept as-is, not defaulted down. 'edit' covers the master
    # record, Contacts, Activities and Files together — one screen governs
    # all of Customer 360, same as employee.master_record.
    "customer.directory": ScreenDef(
        # has_scope=True: §6.1 "Restrict Manager to Only Their Own
        # Customers" — documentation only, no resolver effect (unlike every
        # other has_scope=True screen, this toggle NARROWS Manager's
        # 'full' default rather than widening a narrower one, which
        # toggles.py's own ModeGate is explicitly built to never do — see
        # customers.py's _manager_restricted_to_own for the real check).
        key="customer.directory", module="customer", label="Customer Directory", has_scope=True, actions=("edit",),
        # §2.1: "Collected Into ... Withheld from Manager — it is a company
        # banking detail, not an account-relationship one." The customer's
        # OWN bank_account_name/bank_name/bank_account_number carry no such
        # carve-out (Manager has unqualified "full access... every
        # customer" per §6) — only this one rollup field is sensitive.
        sensitive_fields=("collected_into_bank_account_id",),
    ),
    # §6: Manager Full incl. banking/GST fields by default (source sheet);
    # Accountant Full; the split is 'edit' (name/contact/address/terms) vs
    # 'edit_banking' (bank details + GSTIN/PAN) — "Allow Manager to Edit
    # Vendor Bank & GST Details" toggle default OFF means Manager gets
    # 'edit' but NOT 'edit_banking' out of the box, unlike every other
    # module-level toggle this project has left as a documented gap: this
    # one is a single field-level split on one endpoint, cheap enough to
    # build for real rather than defer.
    "vendor.directory": ScreenDef(
        key="vendor.directory", module="vendor", label="Vendor Directory", has_scope=False,
        actions=("edit", "edit_banking", "deactivate", "activate", "approve_vendor"),
        sensitive_fields=(
            "gstin", "pan", "bank_account_name", "bank_name", "bank_account_number", "ifsc_code",
            # Found missing by the doc-sync verification session (2026-08-05):
            # VendorOut's own list/detail masked-summary field (the model
            # column is literally named bank_account_number_masked) was never
            # declared sensitive under ITS OWN key — only the differently-
            # named "account_number_masked" used by the separate §2.3 Vendor
            # Usage rows below was. A Manager could see "Bank •••4002" on
            # every vendor list row even with the raw fields correctly
            # hidden — §2.1's "withheld from Manager" means the whole
            # column, not just the unmasked value.
            "bank_account_number_masked",
            # §2.3 Vendor Usage — "the same line already drawn on the Vendor
            # Directory" — shares this screen key, so the same field-mode
            # rows gate its banking columns too.
            "paid_from", "paid_into", "account_number_masked",
        ),
    ),
    # §2.1 Purchase Bill List + §2.2 Add/Edit + §2.3 Record Payment.
    # Manager: NA by default ("Give Manager Read-Only Access" toggle OFF) —
    # money-movement module, same "Manager gets zero" rule as Payroll/Invoice.
    "purchase_bill.list": ScreenDef(key="purchase_bill.list", module="purchase_bill", label="Purchase Bill", has_scope=False, actions=("edit", "record_payment")),
    # §2.1 dashboard widgets — Accountant/Super Admin only by default
    # ("Show Non-Financial Widgets to HR" toggle OFF).
    "invoice.dashboard": ScreenDef(key="invoice.dashboard", module="invoice", label="Invoice Dashboard", has_scope=False, actions=()),
    # §2.2/2.3/2.4 — New/Edit Invoice, Send, Record Payment all live under
    # one screen (matches how the Paid-lock is a single, unconditional rule
    # across the whole record, not per-action).
    # 'view_financial_summary' is Customer §6.1's "Give Accountant Read
    # Access to Customer Financial Summary" toggle — registered on this
    # screen (not customer.directory) since Accountant never gets that
    # screen at all; see customers.py's customer_financial_summary.
    # has_scope=True (documentation-only, same as customer.directory/
    # opportunity.pipeline/project.directory) — §6.2's "Allow Manager
    # Read-Only Access to Their Projects' Invoices" toggle scopes a
    # Manager's view to invoices tied to projects they lead, resolved
    # bespoke in invoices.py rather than through the static mode dimension.
    # 'confirm_paid' backs the OTHER §6.2 toggle, "Require Second Approval
    # Before an Invoice Locks as Paid" — Super Admin only (seed.py).
    "invoice.list": ScreenDef(key="invoice.list", module="invoice", label="Invoice", has_scope=True, actions=("edit", "send", "record_payment", "view_financial_summary", "confirm_paid")),
    # §2.5 — 'raise' (Accountant/Super Admin) vs 'approve' (Super Admin only,
    # per the module's own stated approval rule).
    "credit_note.list": ScreenDef(key="credit_note.list", module="invoice", label="Credit Note", has_scope=False, actions=("raise", "approve")),
    # §2.1 My Expenses — "own baseline" by construction for every role, same
    # pattern as payroll.my_payslips/leave.my_leave: nobody's access to
    # their OWN expenses is narrower than a plain Employee's.
    "expense.my_expenses": ScreenDef(key="expense.my_expenses", module="expense", label="My Expenses", has_scope=True, actions=()),
    # §2.2 — Accountant/Super Admin only by default ("Allow Manager to
    # Approve Their Team's Expenses" toggle OFF, MANAGER mode='none' in
    # seed.py). ON, MANAGER gets mode='team' + 'manager_approve' — see the
    # paired ACTION_TOGGLE_GATES/MODE_TOGGLE_GATES entries in toggles.py.
    "expense.approvals": ScreenDef(key="expense.approvals", module="expense", label="Expense Approvals", has_scope=False, actions=("approve", "reject", "manager_approve")),
    # §2.3 — company-wide list + summary + Mark as Reimbursed.
    "expense.all_expenses": ScreenDef(key="expense.all_expenses", module="expense", label="All Expenses / Summary", has_scope=False, actions=("mark_reimbursed",)),
    # §2.4 — its own screen, deliberately not a filter on all_expenses (an
    # office bill must never sit in the reimbursement queue next to a taxi
    # fare — Appendix B, verbatim).
    "expense.company": ScreenDef(key="expense.company", module="expense", label="Company Expenses", has_scope=False, actions=("edit",)),

    # ===================================================== PHASE 5 — OPERATIONS
    # §6: Manager/Super Admin full (broad, company-wide grant — sales-pipeline
    # data doesn't carry Payroll's personal-privacy weight, same resolution
    # as Customer/Vendor/Ticket). Employee/Accountant/HR: none.
    # has_scope=True: §6.1 "Restrict Manager to Only Their Own Opportunities"
    # — documentation only, same narrowing-not-widening shape (and same
    # reason it's a direct check, not a resolver ModeGate) as customer
    # .directory's own has_scope=True comment explains.
    "opportunity.pipeline": ScreenDef(key="opportunity.pipeline", module="opportunity", label="Opportunity Pipeline", has_scope=True, actions=("edit",)),

    # §2.1: Super Admin/Manager see every project; Employee sees only
    # projects they're a team member (or Lead) of — has_scope=True, actual
    # membership filtering done in the router via app/services/project_scope.py
    # (role-mode alone can't express "team member of THIS row").
    # sensitive_fields=("budget",) is the infrastructure for the documented
    # "Hide Budget from Employee's Project View" toggle (§6.1/A173) — Budget
    # stays shown to everyone by default (no RolePermissionField row seeded),
    # this only makes the OFF->ON toggle possible without a further code change.
    "project.directory": ScreenDef(key="project.directory", module="project", label="Project Directory", has_scope=True, actions=("edit",), sensitive_fields=("budget",)),
    # §2.3/2.4/2.6 — Task Board + Task Detail + Bugs share identical access
    # (view/comment/move for any team member, delete Manager/Super-Admin-only).
    "project.board": ScreenDef(key="project.board", module="project", label="Task Board & Bugs", has_scope=True, actions=("delete",)),
    # §2.5 — any team member views; Start/Update/Complete is Manager/SA only.
    "project.sprints": ScreenDef(key="project.sprints", module="project", label="Sprints", has_scope=True, actions=("manage",)),
    # §2.8 Milestones — any team member views; add/edit/delete Manager/SA only.
    "project.milestones": ScreenDef(key="project.milestones", module="project", label="Milestones", has_scope=True, actions=("manage",)),
    # §2.7 — Manager/Super Admin by default ("Show Project Report to
    # Employee" toggle OFF).
    "project.report": ScreenDef(key="project.report", module="project", label="Project Report", has_scope=False, actions=()),
    # §2.8 Timesheets — "My Timesheet" is every team member's own baseline.
    "project.timesheet.mine": ScreenDef(key="project.timesheet.mine", module="project", label="My Timesheet", has_scope=True, actions=()),
    # "Team Timesheet" — Manager/Super Admin by role; a Project Lead of ANY
    # role also approves entries on their own project (a per-project
    # designation, not a role — checked explicitly in the router, same
    # "role mode alone isn't enough" reasoning as project.directory above).
    "project.timesheet.team": ScreenDef(key="project.timesheet.team", module="project", label="Team Timesheet", has_scope=True, actions=("approve",)),

    # §2.1: Super Admin/Manager see every ticket; Employee sees only tickets
    # assigned to them. 'create' — "Allow Staff to Create New Tickets"
    # toggle, OFF by default (Manager/SA only). 'reassign' — "Allow Staff to
    # Reassign Their Own Ticket," OFF by default (Manager/SA only). 'close'
    # — moving a ticket to CLOSED is reserved for whoever confirms
    # resolution (Appendix B/Employee module §2.7); an employee can move
    # Open/In Progress/Resolved freely but never Closed.
    "ticket.list": ScreenDef(key="ticket.list", module="ticket", label="Ticket List & Detail", has_scope=True, actions=("create", "reassign", "close")),
    # §2.5 — Manager/Super Admin by default ("Show Support Reports to Staff" OFF).
    "ticket.reports": ScreenDef(key="ticket.reports", module="ticket", label="Support Reports", has_scope=False, actions=()),

    # §6.1/6.2: field-level split on the SAME Asset Master Record —
    # 'edit' = Core Info + Purchase & Financial fields (Accountant/Super
    # Admin only); 'assign' = the Assign/Transfer/Unassign actions (§2.3,
    # HR/Super Admin only). Manager: view-only, own direct reports
    # (has_scope=True). Purchase/Current Value hidden from Manager by
    # default — same Layer-3 masking pattern as Vendor/Customer (Phase 4).
    "asset.directory": ScreenDef(
        key="asset.directory", module="asset", label="Asset Directory", has_scope=True, actions=("edit", "assign"),
        sensitive_fields=("purchase_value", "current_value"),
    ),
    # §2.4 — company-wide Maintenance list + per-asset tab. Accountant/Super
    # Admin add/edit; HR/Manager view (Manager scoped to direct reports).
    "asset.maintenance": ScreenDef(key="asset.maintenance", module="asset", label="Maintenance & Service Log", has_scope=True, actions=("edit",)),
    # §2.6 — Manager (own direct reports) + Super Admin approve/reject.
    "asset.requests": ScreenDef(key="asset.requests", module="asset", label="Asset Requests", has_scope=True, actions=("approve",)),
    # §2.7 — Accountant/HR/Super Admin full; Manager scoped + value hidden
    # by default (same sensitive_fields as the Directory).
    "asset.reports": ScreenDef(key="asset.reports", module="asset", label="Asset Reports", has_scope=True, actions=(), sensitive_fields=("purchase_value", "current_value")),
    # §2.8 — HR + Super Admin only, triggered from Offboarding.
    "asset.reclaim": ScreenDef(key="asset.reclaim", module="asset", label="Reclaim on Exit", has_scope=False, actions=("mark_returned",)),

    # Employee self-service views (Employee module §2.7/§2.8/§2.9) — moved
    # into their own modules' sidebars per the 2026-07-30 nav reorg, but
    # still the same "own baseline" screens every role gets, unscoped by
    # anything but "assigned/involved with me."
    "employee.my_tickets": ScreenDef(key="employee.my_tickets", module="employee", label="My Tickets", has_scope=True, actions=()),
    "employee.my_projects_tasks": ScreenDef(key="employee.my_projects_tasks", module="employee", label="My Projects & Tasks", has_scope=True, actions=()),
    # §2.9: this self-service view's own column set is Asset Tag, Name/Type,
    # Assigned Date, Condition — no value figures, for anyone, regardless of
    # their system role (unlike the Directory/Reports, where only Manager's
    # value visibility is toggle-gated).
    "employee.my_assets": ScreenDef(key="employee.my_assets", module="employee", label="My Assets", has_scope=True, actions=("raise_request",), sensitive_fields=("purchase_value", "current_value")),

    # Module 15 — Tax & Compliance (15-tax-compliance-module.md §6): Accountant
    # gets full access to every screen here, Super Admin everything plus the
    # two destructive actions (reverse/void), Manager/HR/Employee none —
    # "there is no personal stake to justify a self-service view." has_scope=
    # False on all six: this is company-wide money-held/money-owed data, the
    # same "full or none" shape as masters.taxes, not a reporting-hierarchy
    # scoped screen.
    "compliance.overview": ScreenDef(key="compliance.overview", module="compliance", label="Tax & Compliance Overview", has_scope=False, actions=()),
    "compliance.obligations": ScreenDef(key="compliance.obligations", module="compliance", label="Obligations — Withheld on Payments", has_scope=False, actions=()),
    "compliance.obligations_by_document": ScreenDef(key="compliance.obligations_by_document", module="compliance", label="Obligations — By Document", has_scope=False, actions=()),
    # 'record' = Record Remittance (§2.5); 'reverse' = §3.3's correction path,
    # Super Admin only per §6.1's "Allow Accountant to Reverse a Remittance"
    # toggle defaulting OFF — same "toggle default encoded directly in the
    # seeded role list" convention every other OFF-by-default toggle in this
    # codebase uses (feature_toggles itself stays unread by the resolver
    # until the RBAC admin screens make it live).
    "compliance.remittances": ScreenDef(key="compliance.remittances", module="compliance", label="Remittances", has_scope=False, actions=("record", "reverse")),
    "compliance.credits": ScreenDef(key="compliance.credits", module="compliance", label="Credits — Withheld from Receipts", has_scope=False, actions=()),
    # 'log' = Log Withholding Certificate (§2.8); 'void' = §2.7's Super-Admin-
    # only destructive action; 'claim' = Mark Credit Claimed (§2.9), which
    # operates on a certificate row so it rides on this screen rather than
    # getting a seventh screen key of its own.
    "compliance.certificates": ScreenDef(key="compliance.certificates", module="compliance", label="Certificates", has_scope=False, actions=("log", "void", "claim")),

    # RBAC's own admin screens (14-rbac-module.md §4) — Super Admin only, no
    # scope dimension (this IS the tool that configures scope for everything
    # else). Module key "rbac", distinct from the 13 spec modules the Matrix
    # screen itself lists — this screen configures those, it isn't one of them.
    "rbac.role_directory": ScreenDef(key="rbac.role_directory", module="rbac", label="Role Directory", has_scope=False, actions=()),
    "rbac.permission_matrix": ScreenDef(key="rbac.permission_matrix", module="rbac", label="Role Permission Matrix", has_scope=False, actions=("edit",)),
    "rbac.overrides": ScreenDef(key="rbac.overrides", module="rbac", label="Individual Permission Overrides", has_scope=False, actions=("add", "remove")),
    "rbac.change_log": ScreenDef(key="rbac.change_log", module="rbac", label="Permission Change Log", has_scope=False, actions=()),
}


def get_screen(key: str) -> ScreenDef:
    try:
        return SCREENS[key]
    except KeyError as exc:
        raise KeyError(f"Screen '{key}' is not in the registry — add it to SCREENS first") from exc
