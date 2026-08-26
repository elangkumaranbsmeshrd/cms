import { ListScreenConfig } from '../../../shared/screens/screen.types';

// Mirrors vendors.py's vendor_usage() response dict exactly (that endpoint
// has response_model=None, so this is the real shape, not a Pydantic
// schema). paid_from/paid_into/account_number_masked are RBAC 'hide' for
// Manager (vendors.py's SCREEN = "vendor.directory", same field manifest
// the record's own Banking tab already relies on) — omitted from the
// response entirely for that role, not just blanked.
interface VendorUsageRow {
  readonly type: 'PURCHASE_BILL' | 'EXPENSE';
  readonly reference_number: string;
  readonly date: string;
  readonly amount: number;
  readonly mode: string | null;
  readonly paid_from?: string | null;
  readonly paid_into?: string | null;
  readonly account_number_masked?: string | null;
  readonly status: string;
}

// /options, not the gated masters.bank_accounts screen (2026-08-11 RBAC audit fix) —
// this tab is reachable by roles (e.g. Accountant) that no longer hold standalone
// `view` on that Masters screen; /options resolves the label without needing it.
const BANK_ACCOUNT_REF = { endpoint: '/masters/bank-accounts/options', labelKey: 'label' };
const PAYMENT_MODE_REF = { endpoint: '/masters/payment-modes/options', labelKey: 'label' };

const TYPE_OPTIONS = [
  { value: 'PURCHASE_BILL', label: 'Purchase Bill' },
  { value: 'EXPENSE', label: 'Expense' },
];

/** §2.3 Vendor Usage — "a read-only view of everywhere a vendor has
 * actually been used... Where it lives: a tab or section on the vendor's
 * own record (2.2), not a separate standalone screen." A FUNCTION for the
 * same reason emp.assigned-assets.list.config.ts's own is one — GET
 * /vendors/{vendor_id}/usage needs this ONE vendor's id, only known once
 * RecordScreenComponent resolves it from the route.
 *
 * Deliberately NO totals/charts here (Appendix B, quoted verbatim in the
 * backend's own docstring: "no totals, no charts, ever") — spend reporting
 * belongs to Purchase Bill and Expense, this stays a plain linked-records
 * list. RBAC: reuses 'vendor.directory' (vendors.py's own SCREEN constant
 * for this endpoint) — there is no separate 'vendor.usage' screen key.
 */
export function buildVendorUsageListConfig(vendorId: string): ListScreenConfig<VendorUsageRow> {
  return {
    shape: 'list',
    id: 'vendor.directory',
    title: 'Vendor Usage',
    specRef: '§2.3',
    recordNoun: 'linked record',
    description: 'Every Purchase Bill and Expense linked to this vendor, most recent first. No totals or charts — spend reporting lives in Purchase Bill and Expense.',
    endpoint: `/vendors/${vendorId}/usage`,
    exportable: true,
    rowId: (row) => `${row.type}-${row.reference_number}`,
    searchParam: 'search',
    searchFields: ['reference_number'],
    includeInactiveParam: false,
    filters: [
      {
        key: 'type',
        label: 'Type',
        kind: 'select',
        transport: 'server',
        allLabel: 'All Types',
        options: TYPE_OPTIONS,
      },
      {
        key: 'status',
        label: 'Status',
        kind: 'multiselect',
        transport: 'server',
        allLabel: 'All Statuses',
        // No fixed status enum spans both Purchase Bill and Expense — left
        // client-derivable from the rows actually present rather than a
        // hardcoded list that would drift from either module's real values.
        // NOT `options: []` alongside this — list-screen.component.ts's own
        // optionsFor() checks `if (f.options) return f.options` FIRST, and an
        // empty array is truthy in JS, so a stray `options: []` here would
        // return before optionsFromRows ever ran, leaving this dropdown
        // permanently empty.
        optionsFromRows: (rows) => [...new Set(rows.map((r) => r.status))].map((s) => ({ value: s, label: s })),
      },
      {
        // §2.3: "Date range with financial-year presets" — `daterange` gets
        // the FY presets for free from list-screen.component.ts's own global
        // buildDatePresets() wiring, same as every other daterange filter.
        key: 'date',
        label: 'Date',
        kind: 'daterange',
        transport: 'server',
        param: 'date',
      },
      {
        key: 'amount',
        label: 'Amount',
        kind: 'numberrange',
        transport: 'server',
        param: 'amount',
      },
      {
        // Same Layer-3 "the field's visibility decides; the filter follows"
        // rule as Directory's Has Bank Details filter — paid_from is one of
        // vendor.directory's own sensitive_fields, hidden from Manager.
        key: 'paid_from_account_id',
        label: 'Paid From',
        kind: 'select',
        transport: 'server',
        allLabel: 'Any Account',
        optionsRef: BANK_ACCOUNT_REF,
        hideWhenFieldHidden: 'paid_from',
      },
    ],
    columns: [
      { key: 'type', header: 'Type', type: 'status', staticOptions: TYPE_OPTIONS },
      { key: 'reference_number', header: 'Reference Number', type: 'code' },
      { key: 'date', header: 'Date', type: 'date' },
      { key: 'amount', header: 'Amount', type: 'money' },
      { key: 'mode', header: 'Mode', ref: PAYMENT_MODE_REF },
      { key: 'paid_from', header: 'Paid From (Meshrd Account)', ref: BANK_ACCOUNT_REF },
      { key: 'paid_into', header: "Paid Into (Vendor's Account Name)" },
      { key: 'account_number_masked', header: 'Account Number' },
      { key: 'status', header: 'Status', type: 'status' },
    ],
    defaultPageSize: 50,
    emptyText: 'No Purchase Bills or Expenses are linked to this vendor yet.',
  };
}
