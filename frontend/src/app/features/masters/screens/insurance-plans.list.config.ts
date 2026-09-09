import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { InsurancePlanRow } from '../masters.api';
import { PLAN_TYPE_OPTIONS } from './insurance-plans.form.config';

// This endpoint comes from the generic lookup factory (masters_simple.py's
// build_lookup_router call for /masters/insurance-plans), whose list_rows takes
// search, include_inactive, is_referenced (the last only because this
// sub-master passes `referenced_by`), created_by, updated_by,
// created_from/created_to and format. So every filter below except Plan Type
// round-trips to the server — and the export is therefore exact for them —
// while Plan Type, which has no parameter, runs client-side.
//
// §3.0's all-roles rule ("every role that can open a given sub-master tab …
// gets that tab's full filter set and export, not a reduced version") matters
// more here than on most Masters screens: Insurance Plans is one of only two
// sub-masters another role can see at all (HR gets View, §3.19 Role Access), so
// nothing below is gated with superAdminOnly.

// §3.0's Created By / Last Modified By pair. The ids come back on the row
// (masters_simple.py's `_AUDIT_READ_ONLY`); `/users` turns one into a name,
// and HR can read that endpoint too — which matters on Insurance Plans, the
// one sub-master here a second role can open.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

// There is no "distinct creators" endpoint, so the option list is derived from
// the rows on screen — the same technique customer.directory.config.ts uses.
function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly InsurancePlanRow[], refData: RefDataService): FilterOption[] => {
    const seen = new Map<string, FilterOption>();
    for (const row of rows) {
      const id = row[key];
      if (id && !seen.has(id)) seen.set(id, { value: id, label: refData.label(USER_REF, id) });
    }
    return [...seen.values()];
  };
}

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
    {
      // §3.0's Used/Unused filter — "specific to this module and genuinely
      // useful here: whether an entry has ever been referenced by a real
      // record. This is what makes 'which of these can I safely deactivate?'
      // answerable without opening each one." That question is the whole
      // point of this screen's lifecycle (§3.19: never hard-deleted once any
      // employee is enrolled), and this was the ONE sub-master on the lookup
      // factory whose backend already computes the signal
      // (masters_simple.py's `referenced_by=[(EmployeeInsuranceEnrollment,
      // "insurance_plan_id")]`) while the screen never offered it. Server
      // transport: the factory declares `?is_referenced=` as a real query
      // param wherever `referenced_by` is passed, so the export stays exact.
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'server',
      param: 'is_referenced',
      allLabel: 'Used — Any',
    },
    // §3.0 / A048's third cross-cutting rule, on every sub-master list:
    // "Created By, Last Modified By, and Created On range — Masters is
    // confidential shared configuration, and knowing who changed a shared list
    // and when is worth more here than almost anywhere else in the CMS."
    // Server transport for all three (masters_lookup.py's list_rows takes
    // created_by / updated_by / created_from / created_to), so the export
    // header names them and exports exactly what is on screen.
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsFromRows: peopleOptions('created_by') },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsFromRows: peopleOptions('updated_by') },
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
    // No 'Used' COLUMN here, unlike Department / Designation / Employment
    // Type — and that asymmetry is the sources of truth's, not an oversight.
    // Those three carry one because the prototype's own columns[] for each of
    // them does (data.js:1537/1543/1594, `{ k: 'used', t: 'Used' }`); this
    // screen's columns[] (data.js:1601) and §3.19's own "A simple list —
    // Plan Name, Type, Coverage Amount, Company Contribution, Employee
    // Contribution, Status" both stop at Status. §3.0 asks for the Used
    // FILTER on every sub-master, which is above; it never asks for the
    // column. `is_referenced` is still on every row and still gates Delete
    // below — it just isn't a ninth column on a table that already runs to
    // the edge at 1280.
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
      // ON DELETE RESTRICT and surfaces as a 409. `visible` now gates on the
      // same `is_referenced` the Used filter above reads: the comment this
      // replaces said "there is no enrolment count on this response to hide
      // the button by", which stopped being true once masters_simple.py gained
      // `referenced_by` for this sub-master — so the button was still offered
      // on an enrolled plan where it can only ever 409. Every sibling lookup
      // hides it the same way (§3.19: never hard-deleted once any employee is
      // enrolled; Deactivate is the action that remains).
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/insurance-plans/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm:
        'Permanently delete this plan? This only succeeds while no employee has ever been enrolled in it — otherwise the server refuses and Deactivate is the correct action.',
    },
  ],
  defaultPageSize: 50,
  // The prototype's own empty string for this screen.
  emptyText: 'No insurance plans configured.',
};

export default config;
