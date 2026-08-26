// Maps the real RBAC module keys (app/rbac/registry/screens.py's
// ScreenDef.module, 15 values) to a nav-group label and display order, and
// maps a screen_key to the ROUTE it actually has, where one has been built.
// A screen the policy makes visible but that has no route AND isn't in
// SUB_SCREEN_KEYS below renders as a "coming soon" placeholder rather than a
// broken link — that combination should not currently occur (every RBAC
// screen key is either routed here or listed as a sub-screen), but stays as
// a safety net rather than an assumed invariant, since a new screen key
// added to the backend registry without a matching frontend update should
// degrade to a placeholder, not a broken link.

import { IconName } from '../shared/ui/icon.component';

export interface NavModule {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly icon: IconName;
  // A screen belongs to this module if its key starts with any of these
  // prefixes (each already includes the trailing '.'). Plain
  // startsWith(`${module}.`) — the previous, flat-group implementation —
  // breaks for credit_note.list: its ScreenDef.module is 'invoice' (app/
  // rbac/registry/screens.py) but the KEY doesn't start with 'invoice.', so
  // it never matched any group and was silently absent from the sidebar
  // entirely (not even a "coming soon" placeholder — just missing). It also
  // can't express Leave + Payroll sharing ONE nav module, which the
  // prototype's own MODULES array (data.js) does deliberately.
  readonly screenPrefixes: readonly string[];
}

// Matches the prototype's own MODULES array (data.js) one-for-one — group,
// order, icon and all (module icons ported verbatim into icon.component.ts's
// ICONS map already; this is the first place that actually uses most of
// them). 'home'/Dashboard and 'settings' are handled outside this list (see
// sidebar.component.ts): Dashboard has no RBAC screen key of its own — it's
// always shown, the same as the prototype's own `single: true` home module —
// and Settings already has its own fixed nav-foot link (app-core.js's own
// reasoning: a second copy inside a module group would just be the same
// screen listed twice at once).
export const NAV_MODULES: NavModule[] = [
  { id: 'employee', group: 'People', label: 'Employee', icon: 'employee', screenPrefixes: ['employee.'] },
  { id: 'leavepay', group: 'People', label: 'Leave & Payroll', icon: 'payroll', screenPrefixes: ['leave.', 'payroll.'] },
  { id: 'asset', group: 'People', label: 'Asset Management', icon: 'asset', screenPrefixes: ['asset.'] },
  { id: 'ticket', group: 'Operations', label: 'Ticket', icon: 'ticket', screenPrefixes: ['ticket.'] },
  { id: 'project', group: 'Operations', label: 'Project', icon: 'project', screenPrefixes: ['project.'] },
  { id: 'opportunity', group: 'Operations', label: 'Opportunity', icon: 'opp', screenPrefixes: ['opportunity.'] },
  { id: 'customer', group: 'Operations', label: 'Customer', icon: 'customer', screenPrefixes: ['customer.'] },
  { id: 'invoice', group: 'Finance', label: 'Invoice', icon: 'invoice', screenPrefixes: ['invoice.', 'credit_note.'] },
  { id: 'expense', group: 'Finance', label: 'Expense', icon: 'expense', screenPrefixes: ['expense.'] },
  { id: 'purchasebill', group: 'Finance', label: 'Purchase Bill', icon: 'purchase', screenPrefixes: ['purchase_bill.'] },
  { id: 'taxcompliance', group: 'Finance', label: 'Tax & Compliance', icon: 'rupee', screenPrefixes: ['compliance.'] },
  { id: 'vendor', group: 'Finance', label: 'Vendor', icon: 'vendor', screenPrefixes: ['vendor.'] },
  { id: 'masters', group: 'Administration', label: 'Masters', icon: 'masters', screenPrefixes: ['masters.'] },
  { id: 'rbac', group: 'Administration', label: 'Roles & Access', icon: 'rbac', screenPrefixes: ['rbac.'] },
];

/** screen_key -> route path, only for screens with a real built component. */
export const SCREEN_ROUTES: Record<string, string> = {
  'employee.directory': '/employees',
  'employee.my_profile': '/my-profile',
  'leave.my_leave': '/my-leave',
  'leave.approvals': '/leave/approvals',
  'leave.balance_management': '/leave/balances',
  'leave.reports': '/leave/reports',
  // Also covers the separate Approvals queue at
  // /leave/compensatory-hours-approvals, reached in-page from this screen's
  // own secondary action — same one-path-per-screen-key limitation as
  // employee.documents above (see leave.comp-hours.list.config.ts's comment).
  'leave.compensatory_hours': '/leave/compensatory-hours',
  'payroll.my_payslips': '/my-payslips',
  // Same screen key covers both the self-service view (own scope, most
  // roles) and HR/Super Admin's cross-employee queue ('full' scope) — the
  // sidebar can only carry one path per key, so this defaults to
  // self-service; my-documents.component.ts links to the queue in-page for
  // whoever holds the 'verify' action.
  'employee.documents': '/my-documents',
  'employee.my_tickets': '/my-tickets',
  'employee.my_projects_tasks': '/my-projects-tasks',
  'employee.my_assets': '/my-assets',
  'employee.offboarding': '/resignations',
  'employee.tax_declarations': '/my-tax-declarations',
  'employee.onboarding': '/employees/onboarding-queue',
  'vendor.directory': '/vendors',
  'customer.directory': '/customers',
  'masters.financial_year': '/masters/financial-years',
  'masters.holidays': '/masters/holidays',
  'masters.bank_accounts': '/masters/bank-accounts',
  'masters.company_profile': '/masters/company-profile',
  // The tabbed record, not the Policies sub-list — Policies is now a tab on it.
  'masters.work_week_hours': '/masters/work-week-hours',
  'masters.email_configuration': '/masters/email-configuration',
  'masters.taxes': '/masters/taxes',
  'masters.departments': '/masters/departments',
  'masters.designations': '/masters/designations',
  'masters.expense_types': '/masters/expense-types',
  'masters.leave_types': '/masters/leave-types',
  'masters.payment_modes': '/masters/payment-modes',
  'masters.hsn_sac_codes': '/masters/hsn-sac-codes',
  'masters.service_categories': '/masters/service-categories',
  'masters.units_of_measure': '/masters/units-of-measure',
  'masters.ticket_categories': '/masters/ticket-categories',
  'masters.customer_statuses': '/masters/customer-statuses',
  'masters.customer_sources': '/masters/customer-sources',
  'masters.asset_categories': '/masters/asset-categories',
  'masters.employment_types': '/masters/employment-types',
  'masters.insurance_plans': '/masters/insurance-plans',
  'rbac.role_directory': '/rbac/roles',
  'rbac.permission_matrix': '/rbac/matrix',
  'rbac.overrides': '/rbac/overrides',
  'rbac.change_log': '/rbac/change-log',
  'ticket.list': '/tickets',
  'ticket.reports': '/tickets/reports',
  'asset.directory': '/assets',
  'asset.maintenance': '/asset-maintenance',
  'asset.requests': '/asset-requests',
  'asset.reports': '/asset-reports',
  'expense.my_expenses': '/my-expenses',
  'expense.approvals': '/expenses/approvals',
  'expense.all_expenses': '/expenses/all',
  'expense.company': '/expenses/company',
  'opportunity.pipeline': '/opportunities',
  'invoice.dashboard': '/invoices/dashboard',
  'invoice.list': '/invoices',
  'credit_note.list': '/credit-notes',
  'compliance.overview': '/compliance/overview',
  'compliance.obligations': '/compliance/obligations',
  'compliance.obligations_by_document': '/compliance/obligations/by-document',
  'compliance.remittances': '/compliance/remittances',
  'compliance.credits': '/compliance/credits',
  'compliance.certificates': '/compliance/certificates',
  'payroll.run': '/payroll/run',
  'payroll.adhoc_adjustments': '/payroll/adhoc-adjustments',
  'payroll.payslips_admin': '/payroll/payslips',
  'payroll.attendance_time_basis': '/payroll/attendance',
  'project.directory': '/projects',
  'purchase_bill.list': '/purchase-bills',
  'employee.announcements': '/announcements',
};

export function routeForScreen(screenId: string): string[] {
  const path = SCREEN_ROUTES[screenId];
  return path ? [path] : ['/coming-soon', screenId];
}

// Screen keys that exist purely to RBAC-gate a TAB or an in-context action on
// another screen (never a standalone destination a person navigates to
// directly) — confirmed by reading every route file's own comment on this:
// project.routes.ts's header ("Only ONE of these is sidebar-reachable —
// project.directory... every route below it is reached only by in-app
// navigation") and the identical note on asset.routes.ts's own
// assets/reclaim/:employeeId. SidebarComponent lists every RBAC-visible
// screen key with no other curation, so without this exclusion these render
// as their own sidebar entry pointing at /coming-soon/<key> — a real screen
// that's fully built and reachable by clicking through from its parent,
// wrongly presented as unbuilt. employee.master_record is the same class of
// gap even though it happens to have its own route (/employees/:id): there
// is no single "the" employee for a bare sidebar click to open — Employee
// Directory (which DOES have its own entry) is the real, working entry
// point, exactly the same relationship Project Directory has to project.board/
// milestones/report/sprints below.
// Screen keys granted 'view' mode to some roles ONLY so another screen's
// picker/date-check can resolve real data (Leave Types -> Apply for Leave's
// dropdown; Holidays -> the Company Holiday Calendar and leave-day-count
// logic) — never intended as a standalone Masters destination for THOSE
// roles. Unlike SUB_SCREEN_KEYS below, this can't be an unconditional
// exclusion: Manager and HR hold real 'full' management rights on these same
// two screens and must keep their own standalone Masters entry. Excluded
// from the nav specifically when the viewing role's own mode is 'view' (the
// picker-only grant) — 'full' still renders normally. Same reasoning
// already applied to masters.bank_accounts below, generalized to a mode-
// conditional version since that one's exclusion could stay unconditional
// (no role holds 'full' on it outside Super Admin, who reaches it via
// Company Profile's own tab regardless).
export const VIEW_ONLY_SUB_SCREEN_KEYS = new Set<string>(['masters.leave_types', 'masters.holidays']);

export const SUB_SCREEN_KEYS = new Set<string>([
  // Reached only via Masters -> Company Profile's own "Bank Details" tab
  // (company-profile.tabbed.config.ts), matching the prototype, which never
  // gives Bank Accounts a standalone top-level nav slot either.
  'masters.bank_accounts',
  'employee.master_record',
  'employee.salary_structure',
  'employee.insurance',
  'employee.attendance',
  'employee.offer_letters',
  'project.board',
  'project.milestones',
  'project.sprints',
  'project.report',
  'project.timesheet.mine',
  'project.timesheet.team',
  'asset.reclaim',
]);
