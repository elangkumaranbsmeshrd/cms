import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';

interface OnboardingQueueRow {
  readonly employee_id: string;
  readonly employee_code: string;
  readonly employee_name: string;
  readonly department_id: string;
  readonly department_name: string;
  readonly joining_date: string;
  readonly steps_completed: number;
  readonly steps_total: number;
  readonly oldest_incomplete_step: string | null;
}

const DEPARTMENT_REF: RefLookup = { endpoint: '/masters/departments/options', labelKey: 'label' };

const COMPLETION_OPTIONS = [
  { value: 'NOT_STARTED', label: 'Not Started' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
];

function completionState(row: OnboardingQueueRow): string {
  return row.steps_completed === 0 ? 'NOT_STARTED' : 'IN_PROGRESS';
}

function titleCase(key: string): string {
  return key.replace(/_/g, ' ').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function daysSinceJoining(row: OnboardingQueueRow): number {
  const ms = Date.now() - new Date(row.joining_date).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** §2.13 Onboarding — All Employees (prototype's emp.onboardqueue, data.js
 * ~line 1034). GET /onboarding-queue (employee_lifecycle.py) — HR/Super
 * Admin's cross-employee view of everyone whose onboarding_checklist_items
 * aren't all COMPLETE/SKIPPED yet, built from the SAME checklist rows the
 * per-employee GET /employees/{id}/onboarding tab (emp.onboarding.checklist.
 * config.ts) reads — not a second source of truth. `employee.onboarding` has
 * has_scope=False (screens.py:140, HR/Super Admin only, no team/own mode),
 * so this queue needs no scope-aware filtering of its own either.
 *
 * No dedicated route deep-links into a specific employee's Onboarding TAB —
 * ListScreenComponent.openRow() calls router.navigate(cmds) with no
 * NavigationExtras, so a ?tab= query param (which the tabbed record screen
 * does support for deep-linking, tabbed-screen.component.ts:246) can't be
 * threaded through rowRoute's plain commands array without changing that
 * shared component. Routes to the employee's Master Record instead; HR
 * clicks into the Onboarding tab from there.
 */
const config: ListScreenConfig<OnboardingQueueRow> = {
  shape: 'list',
  id: 'employee.onboarding',
  title: 'Onboarding — All Employees',
  specRef: '§2.13',
  recordNoun: 'employee',
  description: 'Everyone currently mid-onboarding, across the whole company.',
  endpoint: '/onboarding-queue',
  exportable: true,
  rowId: (row) => row.employee_id,
  rowRoute: (row) => ['/employees', row.employee_id],
  searchParam: false,
  searchFields: ['employee_name', 'employee_code'],
  includeInactiveParam: false,
  filters: [
    {
      key: 'department_id',
      label: 'Department',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Departments',
      optionsRef: DEPARTMENT_REF,
      predicate: (row, v) => row.department_id === v,
    },
    {
      key: 'completion',
      label: 'Completion',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Completion States',
      options: COMPLETION_OPTIONS,
      predicate: (row, v) => completionState(row) === v,
    },
  ],
  columns: [
    {
      key: 'employee_name',
      header: 'Employee',
      cellClass: 'cell-strong',
      compute: (row) => `${row.employee_name} (${row.employee_code})`,
    },
    { key: 'joining_date', header: 'Joining Date', type: 'date', cellClass: 'mono' },
    { key: 'department_name', header: 'Department' },
    {
      key: 'steps_completed',
      header: 'Steps Completed',
      cellClass: 'mono',
      compute: (row) => `${row.steps_completed}/${row.steps_total}`,
    },
    {
      key: 'oldest_incomplete_step',
      header: 'Oldest Incomplete Step',
      compute: (row) => (row.oldest_incomplete_step ? titleCase(row.oldest_incomplete_step) : '—'),
    },
    {
      key: 'days_since_joining',
      header: 'Days Since Joining',
      type: 'number',
      cellClass: 'mono',
      compute: (row) => daysSinceJoining(row),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'Nobody is mid-onboarding right now.',
};

export default config;
