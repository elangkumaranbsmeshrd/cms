import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { EMPLOYEE_USER_REF, EmployeeRow } from '../employee.api';

// Same optionsFromRows technique ticket.list.config.ts's own Created By /
// Last Modified By filters use — the query params themselves already
// worked server-side (list_employees's own created_by/last_modified_by
// clauses); only the dropdown option sources were missing.
function createdByOptions(rows: readonly EmployeeRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.created_by && !seen.has(row.created_by)) {
      seen.set(row.created_by, { value: row.created_by, label: refData.label(EMPLOYEE_USER_REF, row.created_by) });
    }
  }
  return [...seen.values()];
}

function lastModifiedByOptions(rows: readonly EmployeeRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.updated_by && !seen.has(row.updated_by)) {
      seen.set(row.updated_by, { value: row.updated_by, label: refData.label(EMPLOYEE_USER_REF, row.updated_by) });
    }
  }
  return [...seen.values()];
}

const DEPARTMENT_REF = { endpoint: '/masters/departments' };
const DESIGNATION_REF = { endpoint: '/masters/designations' };
const EMPLOYMENT_TYPE_REF = { endpoint: '/masters/employment-types' };
// §0.3: GET /employees returns first_name/last_name as separate fields, no
// {id,name} shape — labelKey: 'first_name' is the established workaround
// used repeatedly across every other already-built module (see
// asset.directory.list.config.ts's own EMPLOYEE_REF for the precedent).
const EMPLOYEE_REF = { endpoint: '/employees', labelKey: 'first_name' };
// Same reasoning as emp.record.config.ts's own WORK_LOCATION_REF: the
// prototype's Chennai/Coimbatore static list is really the real
// work_location_address_id FK to company_addresses, resolved via 'city'.
const WORK_LOCATION_REF = { endpoint: '/masters/company-profile/addresses', labelKey: 'city' };

// employees.models.py: employment_status is a plain String(12), no CHECK
// constraint (default 'ACTIVE'); employee_lifecycle.py's own transitions
// confirm ACTIVE/ON_NOTICE/EXITED are real values it sets server-side.
// INACTIVE is §2.1's own fourth status — not currently set by any endpoint,
// but listed as a legitimate filter/display value per the spec.
const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_NOTICE', label: 'On Notice' },
  { value: 'EXITED', label: 'Exited' },
  { value: 'INACTIVE', label: 'Inactive' },
];

// §2.1 Employee Directory. GET /employees — every filter param below
// confirmed against list_employees() (backend/app/api/v1/employees.py),
// which accepts department_id/designation_id/employment_status/
// employment_type_id/reporting_manager_id/work_location_address_id as real
// server-side query params (all applied before scoping/export).
const config: ListScreenConfig<EmployeeRow> = {
  shape: 'list',
  id: 'employee.directory',
  title: 'Employee Directory',
  specRef: '§2.1',
  recordNoun: 'employee',
  description: "The searchable master list of every staff member. Manager's rows are filtered to direct reports only.",
  endpoint: '/employees',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/employees', row.id],
  // §2.1's "+ Add Employee" (Super Admin/HR). create_employee (employees.py)
  // gates on require_screen(MASTER_RECORD, action="edit") — the same RBAC
  // screen/action the record's own Edit button uses — not employee.directory
  // itself, which registers no actions of its own (screens.py: actions=()).
  createRoute: ['/employees', 'new'],
  createLabel: 'Add Employee',
  createScreenAction: 'edit',
  searchParam: 'search',
  searchFields: ['first_name', 'last_name', 'employee_code', 'email', 'phone'],
  includeInactiveParam: false,
  filters: [
    { key: 'department_id', label: 'Department', kind: 'select', transport: 'server', allLabel: 'All Departments', optionsRef: DEPARTMENT_REF },
    { key: 'designation_id', label: 'Designation', kind: 'select', transport: 'server', allLabel: 'All Designations', optionsRef: DESIGNATION_REF },
    { key: 'employment_status', label: 'Status', kind: 'select', transport: 'server', allLabel: 'All Statuses', options: STATUS_OPTIONS },
    { key: 'employment_type_id', label: 'Employment Type', kind: 'select', transport: 'server', allLabel: 'All Employment Types', optionsRef: EMPLOYMENT_TYPE_REF },
    { key: 'work_location_address_id', label: 'Work Location', kind: 'select', transport: 'server', allLabel: 'All Locations', optionsRef: WORK_LOCATION_REF },
    // §2.1's own filter list also names Reporting Manager and Joining Date
    // range — both already accepted server-side (list_employees's own
    // reporting_manager_id/joining_date_from/joining_date_to params) but
    // never wired to a frontend control. 2026-08-11 production-readiness fix.
    { key: 'reporting_manager_id', label: 'Reporting Manager', kind: 'select', transport: 'server', allLabel: 'Anyone', optionsRef: EMPLOYEE_REF },
    { key: 'joining_date', label: 'Joining Date', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'joining_date' },
    // §2.2e Super Admin extras.
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: createdByOptions },
    { key: 'last_modified_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: lastModifiedByOptions },
  ],
  columns: [
    { key: 'employee_code', header: 'Employee ID', type: 'code', cellClass: 'mono cell-accent' },
    { key: 'name', header: 'Name', cellClass: 'cell-strong', compute: (row) => `${row.first_name} ${row.last_name ?? ''}`.trim() },
    { key: 'department_id', header: 'Department', ref: DEPARTMENT_REF },
    { key: 'designation_id', header: 'Designation', ref: DESIGNATION_REF },
    { key: 'employment_type_id', header: 'Employment Type', ref: EMPLOYMENT_TYPE_REF },
    { key: 'employment_status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
    { key: 'reporting_manager_id', header: 'Reporting Manager', ref: EMPLOYEE_REF },
    { key: 'phone', header: 'Phone', cellClass: 'mono' },
    { key: 'joining_date', header: 'Joining Date', type: 'date', cellClass: 'mono' },
  ],
  defaultPageSize: 25,
  emptyText: 'No employees added yet.',
};

export default config;
