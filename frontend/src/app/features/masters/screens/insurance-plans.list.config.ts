import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { InsurancePlanRow } from '../masters.api';
import { PLAN_TYPE_OPTIONS } from './insurance-plans.form.config';

// This endpoint comes from the generic lookup factory (masters_simple.py's
// build_lookup_router call for /masters/insurance-plans), whose list_rows takes
// exactly three query parameters: search, include_inactive, format. So Search
// and Status round-trip to the server — and the export is therefore exact for
// both — while Plan Type, which has no parameter, runs client-side.
//
// §3.0's all-roles rule ("every role that can open a given sub-master tab …
// gets that tab's full filter set and export, not a reduced version") matters
// more here than on most Masters screens: Insurance Plans is one of only two
// sub-masters another role can see at all (HR gets View, §3.19 Role Access), so
// nothing below is gated with superAdminOnly.

const config: ListScreenConfig<InsurancePlanRow> = {
  shape: 'list',
  id: 'masters.insurance_plans',
  title: 'Insurance Plans',
  specRef: '§3.19',
  recordNoun: 'insurance plan',
  // The prototype's own desc for this screen (data.js masters.insurance).
  description:
    'Company-provided benefit plans. HR gets View as the natural point of contact for benefits questions, without setting premium or coverage terms.',
  endpoint: '/masters/insurance-plans',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/insurance-plans', row.id, 'edit'],
  createRoute: ['/masters/insurance-plans', 'new'],
  createLabel: 'Add Plan',
  // The factory's ?search= matches ONE column, the one named by search_field —
  // 'plan_name' for this sub-master. Naming any other field here would put a
  // promise in the search box the server does not keep.
  searchParam: 'search',
  searchFields: ['plan_name'],
  // §3.0's Status half, which this endpoint implements as a real parameter — so
  // the "Show inactive" control the shared component renders IS the prototype's
  // Status filter, and a separate Status dropdown would just duplicate it
  // (worse: picking "Inactive" there with the checkbox off would match nothing,
  // since the server has already excluded those rows).
  includeInactiveParam: 'include_inactive',
  filters: [
    {
      // Prototype filterNames[1] for this screen: 'Plan Type', over
      // ['All Types', 'Health', 'Life', 'Personal Accident']. Client transport
      // because list_rows has no plan_type parameter — a 'server' guess would
      // be dropped by FastAPI and the chip would claim a filter that never
      // happened. Multi-select per RBAC §2.2c.
      key: 'plan_type',
      label: 'Plan Type',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Types',
      options: PLAN_TYPE_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.plan_type),
    },
  ],
  // Headers are the prototype's columns[].t verbatim (data.js masters.insurance)
  // — note 'Sum Insured' rather than the field's own name, and the contribution
  // pair in the prototype's order. Provider has no prototype column (its mock
  // rows carry no such key) but is a real, form-captured field on the API
  // response, so it is kept rather than thrown away.
  columns: [
    { key: 'plan_name', header: 'Plan Name', cellClass: 'cell-strong' },
    // The prototype renders Plan Type as a chip; 'status' is the ColumnType
    // that produces a badge, and staticOptions gives it the readable label
    // instead of the raw PERSONAL_ACCIDENT enum member.
    { key: 'plan_type', header: 'Plan Type', type: 'status', staticOptions: PLAN_TYPE_OPTIONS },
    { key: 'provider', header: 'Provider' },
    // type 'money' on all three so column-policy.ts applies the house rule
    // (Invariant 8: money aligns LEFT) and cell-format.ts renders the Indian
    // digit grouping — 'Sum Insured' would not match the money-label regex on
    // its header alone.
    { key: 'coverage_amount', header: 'Sum Insured', type: 'money' },
    { key: 'employee_contribution_monthly', header: 'Employee Contribution', type: 'money' },
    { key: 'company_contribution_monthly', header: 'Company Contribution', type: 'money' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
  ],
  rowActions: [
    {
      // §3b — masters_lookup.py's factory always wires POST /{id}/activate
      // alongside /deactivate; this screen never had the row action for it.
      label: 'Activate',
      endpoint: (row) => `/masters/insurance-plans/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      // §3.0 rule 1: "Delete and Deactivate are Super Admin only … A Manager or
      // HR user who can add and edit entries will simply not see a Delete or
      // Deactivate control." PolicyStore.can(id, 'delete') is the same action
      // the factory's endpoint requires (require_screen(..., action="delete")),
      // so HR's View access never renders these.
      label: 'Deactivate',
      endpoint: (row) => `/masters/insurance-plans/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm:
        'Deactivating stops this plan being offered to new enrolments. Employees already covered keep their enrolment record. Continue?',
    },
    {
      // The factory's DELETE /{id} is a real hard delete for a row nothing has
      // referenced; an enrolled plan is rejected by the database's own
      // ON DELETE RESTRICT and surfaces as a 409 with that message. There is no
      // enrolment count on this response to hide the button by, so the confirm
      // says plainly what will happen.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/insurance-plans/${row.id}`,
      screenAction: 'delete',
      confirm:
        'Permanently delete this plan? This only succeeds while no employee has ever been enrolled in it — otherwise the server refuses and Deactivate is the correct action.',
    },
  ],
  defaultPageSize: 50,
  // The prototype's own empty string for this screen.
  emptyText: 'No insurance plans configured.',
};

export default config;
