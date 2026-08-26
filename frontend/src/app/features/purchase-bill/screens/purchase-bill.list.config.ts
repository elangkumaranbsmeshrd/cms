import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import {
  AGEING_BUCKET_OPTIONS,
  BANK_ACCOUNT_REF,
  PAYMENT_MODE_REF,
  PURCHASE_BILL_FY_REF,
  PURCHASE_BILL_STATUS_OPTIONS,
  PurchaseBillRow,
  USER_REF,
  VENDOR_REF,
} from '../purchase-bill.api';

// §2.2e Super Admin extras. No dedicated "distinct creators" endpoint, same
// technique invoice.list.config.ts's own createdByOptions/lastModifiedByOptions use.
function createdByOptions(rows: readonly PurchaseBillRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.created_by && !seen.has(row.created_by)) seen.set(row.created_by, { value: row.created_by, label: refData.label(USER_REF, row.created_by) });
  }
  return [...seen.values()];
}

function lastModifiedByOptions(rows: readonly PurchaseBillRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.updated_by && !seen.has(row.updated_by)) seen.set(row.updated_by, { value: row.updated_by, label: refData.label(USER_REF, row.updated_by) });
  }
  return [...seen.values()];
}

// §2.1 Purchase Bill List — GET /purchase-bills, exportable (list_export's
// own _LIST_COLUMNS in api/v1/purchase_bills.py). Every filter below is a
// real server-side query param (confirmed against list_purchase_bills' own
// Query(...) signature) — transport: 'server' throughout, so the export's
// own "Filters:" header states something true (RBAC 14 §2.2f).
//
// §2.1's own "Deferred" list — Due Date range, Amount/Outstanding range,
// Payment Mode, Bank Account, Created By, Financial Year, and a Last
// Modified By column — is fully reversed here, same as invoice.list.config.ts's
// own header comment already did for Invoice's identical deferred set: none
// of these were ever schema-blocked, only missing query params. Bank
// Account matches the List's own "effective" column (the bill's own account,
// or any account a payment was actually made from) — see
// list_purchase_bills' own comment on that filter.
const config: ListScreenConfig<PurchaseBillRow> = {
  shape: 'list',
  id: 'purchase_bill.list',
  title: 'Purchase Bills',
  specRef: '§2.1',
  description: 'Every purchase bill this role can see, live from the real backend.',
  endpoint: '/purchase-bills',
  exportable: true,
  searchParam: 'search', // matches vendor_bill_number / purchase_bill_code / vendor_name_snapshot server-side
  searchFields: ['vendor_bill_number', 'purchase_bill_code', 'vendor_name_snapshot'],
  includeInactiveParam: false,
  recordNoun: 'purchase bill',
  rowId: (row) => row.id,
  rowRoute: (row) => ['/purchase-bills', row.id],
  createRoute: ['/purchase-bills', 'new'],
  createLabel: 'Add Purchase Bill',
  createScreenAction: 'edit',
  columns: [
    { key: 'purchase_bill_code', header: 'Internal Bill ID', type: 'code', cellClass: 'cell-strong' },
    { key: 'vendor_name_snapshot', header: 'Vendor' }, // already denormalized onto the row — no ref lookup needed
    { key: 'vendor_bill_number', header: "Vendor's Bill Number" },
    { key: 'total_amount', header: 'Total', type: 'money', cellClass: 'cell-strong' },
    // §2.1's own columns — both real PurchaseBillOut fields (finance_engine-
    // computed), previously present on PurchaseBillRow but never surfaced as
    // list columns despite the prototype showing both between Total and Paid.
    { key: 'withholding_amount', header: 'Withholding', type: 'money' },
    { key: 'amount_payable_to_vendor', header: 'Payable to Vendor', type: 'money' },
    { key: 'amount_paid', header: 'Paid', type: 'money' },
    // §2.1's own 2026-07-31 addition: "the account named on the bill, or the
    // account a payment was actually made from once one is recorded" —
    // effective_bank_account_id, not the bill's own bank_account_id.
    { key: 'effective_bank_account_id', header: 'Bank Account', ref: BANK_ACCOUNT_REF },
    { key: 'status', header: 'Status', type: 'status', staticOptions: PURCHASE_BILL_STATUS_OPTIONS },
    { key: 'bill_date', header: 'Bill Date', type: 'date' },
    { key: 'due_date', header: 'Due Date', type: 'date' },
  ],
  filters: [
    {
      key: 'vendor_id',
      label: 'Vendor',
      kind: 'select',
      transport: 'server',
      optionsRef: VENDOR_REF,
      allLabel: 'All Vendors',
    },
    { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', options: PURCHASE_BILL_STATUS_OPTIONS },
    // param:'bill_date' -> auto-suffixed to bill_date_from/bill_date_to by
    // createListStore's own daterange handling, matching the real
    // list_purchase_bills() query params exactly. Prototype's own "Period"
    // filter (FIN_PRESETS).
    { key: 'bill_date', label: 'Bill Date', kind: 'daterange', transport: 'server', param: 'bill_date' },
    { key: 'ageing', label: 'Ageing', kind: 'select', transport: 'server', options: AGEING_BUCKET_OPTIONS, allLabel: 'All Ageing' },
    // Not in the prototype's own filter list — a real addition, see this
    // file's own header comment. Placed here, after the four filters that
    // do match the prototype 1:1.
    { key: 'overdue', label: 'Overdue', kind: 'tristate', transport: 'server' },
    { key: 'financial_year_id', label: 'Financial Year', kind: 'select', transport: 'server', allLabel: 'All Financial Years', optionsRef: PURCHASE_BILL_FY_REF },
    { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server', param: 'due_date' },
    { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server', param: 'amount' },
    { key: 'outstanding', label: 'Outstanding Amount', kind: 'numberrange', transport: 'server', param: 'outstanding' },
    { key: 'payment_mode_id', label: 'Payment Mode', kind: 'select', transport: 'server', allLabel: 'All Modes', optionsRef: PAYMENT_MODE_REF },
    { key: 'bank_account_id', label: 'Bank Account', kind: 'select', transport: 'server', allLabel: 'All Accounts', optionsRef: BANK_ACCOUNT_REF },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: createdByOptions },
    { key: 'last_modified_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: lastModifiedByOptions },
  ],
  defaultPageSize: 25,
  emptyText: 'No purchase bills yet.',
};

export default config;
