import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CUSTOMER_BANK_ACCOUNT_REF, CUSTOMER_OWNER_REF, CUSTOMER_SOURCE_REF, CUSTOMER_STATUS_REF, CUSTOMER_USER_REF, CustomerRow } from '../customer.api';

// §2.2e Super Admin extras. No dedicated "distinct creators" endpoint, same
// technique ticket.list.config.ts's own createdByOptions/lastModifiedByOptions use.
function createdByOptions(rows: readonly CustomerRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.created_by && !seen.has(row.created_by)) seen.set(row.created_by, { value: row.created_by, label: refData.label(CUSTOMER_USER_REF, row.created_by) });
  }
  return [...seen.values()];
}

function lastModifiedByOptions(rows: readonly CustomerRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.updated_by && !seen.has(row.updated_by)) seen.set(row.updated_by, { value: row.updated_by, label: refData.label(CUSTOMER_USER_REF, row.updated_by) });
  }
  return [...seen.values()];
}

// §2.1 Customer Directory. GET /customers — every query param below
// confirmed against list_customers() (backend/app/api/v1/customers.py):
// status_id (list[str]), source_id, owner_id, outstanding_min/_max,
// has_open_opportunities, created_from/_to, last_activity_from/_to,
// created_by, updated_by, search (company_name/display_name/gstin/
// mobile_number/email). There is no `city` param and no `city` column
// anywhere on the Customer model/schema at all — the prototype's own "All
// Cities" filter (data.js §2.1) has zero backend support and is
// deliberately left off rather than faked from a text `address` field; same
// for Service Category — §2.2's own field table never added one to the
// Add/Edit form, so there's no real column a filter could query either.
const config: ListScreenConfig<CustomerRow> = {
  shape: 'list',
  id: 'customer.directory',
  title: 'Customer Directory',
  specRef: '§2.1',
  recordNoun: 'customer',
  description: 'Manager and Super Admin only. Accountant reaches customers solely through the Invoice-creation picker, never this page.',
  endpoint: '/customers',
  exportable: true,
  defaultPageSize: 25,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/customers', row.id],
  createRoute: ['/customers', 'new'],
  createLabel: 'Add Customer',
  createScreenAction: 'edit',
  searchParam: 'search',
  searchFields: ['company_name', 'display_name', 'gstin', 'mobile_number', 'email'],
  includeInactiveParam: false,
  filters: [
    // §2.2c: "Multi-select, not single-select" — Status is the reference case.
    { key: 'status_id', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', optionsRef: CUSTOMER_STATUS_REF },
    { key: 'owner_id', label: 'Owner', kind: 'select', transport: 'server', allLabel: 'All Owners', optionsRef: CUSTOMER_OWNER_REF },
    { key: 'source_id', label: 'Source', kind: 'select', transport: 'server', allLabel: 'All Sources', optionsRef: CUSTOMER_SOURCE_REF },
    { key: 'outstanding', label: 'Total Outstanding', kind: 'numberrange', transport: 'server' },
    { key: 'has_open_opportunities', label: 'Has Open Opportunities', kind: 'tristate', transport: 'server', allLabel: 'Any' },
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'last_activity_date', label: 'Last Activity', kind: 'daterange', transport: 'server', param: 'last_activity' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: createdByOptions },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: lastModifiedByOptions },
  ],
  columns: [
    { key: 'customer_code', header: 'Customer Code', type: 'code' },
    { key: 'company_name', header: 'Company Name', cellClass: 'cell-strong' },
    { key: 'status_id', header: 'Status', type: 'status', ref: CUSTOMER_STATUS_REF },
    { key: 'owner_id', header: 'Owner', ref: CUSTOMER_OWNER_REF },
    { key: 'source_id', header: 'Source', ref: CUSTOMER_SOURCE_REF },
    { key: 'bank_account_name', header: 'Customer Bank Account Name' },
    { key: 'bank_account_number', header: 'Account Number', cellClass: 'mono' },
    // Absent entirely (not just blank) from the payload for Manager — RBAC
    // 'hide' on this one field (app/rbac/registry/screens.py's
    // sensitive_fields). RefDataService.label() renders '—' for a
    // missing/null id, so no client-side role check is needed here.
    { key: 'collected_into_bank_account_id', header: 'Collected Into', ref: CUSTOMER_BANK_ACCOUNT_REF },
    { key: 'total_invoiced', header: 'Total Invoiced', type: 'money' },
    { key: 'outstanding', header: 'Outstanding', type: 'money' },
    { key: 'last_activity_date', header: 'Last Activity', type: 'date' },
  ],
  emptyText: 'No customers yet.',
};

export default config;
