import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { VENDOR_STATE_OPTIONS, VendorRow } from '../vendor.api';

// §2.1 Vendor Directory (data.js:1470-1478). Every query param below
// confirmed against list_vendors() (backend/app/api/v1/vendors.py).
const APPROVAL_STATUS_OPTIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'pending_approval', label: 'Pending Approval' },
];

const config: ListScreenConfig<VendorRow> = {
  shape: 'list',
  id: 'vendor.directory',
  title: 'Vendor Directory',
  specRef: '§2.1',
  recordNoun: 'vendor',
  description:
    'Every vendor this role can see, live from the real backend. Employee and HR have no access — there is no personal reason a staff member needs to see supplier bank or tax details.',
  endpoint: '/vendors',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/vendors', row.id],
  // §2.2's own "+ Add Vendor" — record-screen.component.ts has no create
  // mode, so this points at the sibling create-only form (vendor.create.form
  // .config.ts) at vendors/new, same split asset.directory.list.config.ts
  // already uses for Asset.
  createRoute: ['/vendors', 'new'],
  createLabel: '+ Add Vendor',
  searchParam: 'search',
  searchFields: ['vendor_name', 'gstin', 'bank_account_name'],
  // Paired with the 'activeInactive' Status filter below, exactly like every
  // other screen using that filter kind — list_vendors has a real is_active
  // param, so the 3-way All/Active/Inactive dropdown IS the "show inactive"
  // control here; a second, separate checkbox would be redundant.
  includeInactiveParam: false,
  filters: [
    {
      key: 'is_active',
      label: 'Status',
      kind: 'activeInactive',
      transport: 'server',
      allLabel: 'All Statuses',
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
    },
    {
      // No Masters sub-master behind vendor cities (free text, like
      // vendor_category) — options are still derived from whatever this
      // role's own already-fetched rows contain, but list_vendors now takes
      // a real `city` param, so the actual filtering is server-side.
      key: 'address_city',
      label: 'City',
      kind: 'select',
      transport: 'server',
      param: 'city',
      allLabel: 'All Cities',
      optionsFromRows: (rows) =>
        [...new Set(rows.map((r) => r.address_city).filter((c): c is string => !!c))].map((c) => ({ value: c, label: c })),
    },
    {
      // Same fixed 3-state list vendor.create.form/vendor.record use — no
      // Masters sub-master backs Indian states in this codebase (vendor.api
      // .ts's own VENDOR_STATE_OPTIONS comment), so that's the real option
      // set rather than whatever happens to be in the currently-loaded rows.
      key: 'address_state',
      label: 'State',
      kind: 'select',
      transport: 'server',
      param: 'state',
      allLabel: 'All States',
      options: VENDOR_STATE_OPTIONS,
    },
    {
      key: 'payment_terms_days',
      label: 'Payment Terms (Days)',
      kind: 'numberrange',
      transport: 'server',
      param: 'payment_terms',
    },
    {
      key: 'created_at',
      label: 'Created On',
      kind: 'daterange',
      transport: 'server',
      param: 'created',
    },
    {
      key: 'has_bank_details',
      label: 'Has Bank Details',
      kind: 'tristate',
      transport: 'server',
      allLabel: 'Bank Details — Any',
      // §2.1, verbatim in list_vendors' own comment: "the 'has bank details on
      // file' filter is hidden from Manager too... the field's visibility
      // decides; the filter follows." Gated on a real sensitive field
      // (screens.py's vendor.directory sensitive_fields) rather than a
      // hardcoded role check, so it tracks Manager's actual fieldMode.
      hideWhenFieldHidden: 'bank_account_name',
    },
    {
      // §6.1 "Require Approval to Add a New Vendor" — surfaces the pending
      // queue Accountant/Super Admin need to work off of when the toggle's on.
      key: 'approval_status',
      label: 'Approval',
      kind: 'select',
      transport: 'server',
      allLabel: 'Approval — Any',
      options: APPROVAL_STATUS_OPTIONS,
    },
  ],
  columns: [
    { key: 'vendor_name', header: 'Vendor Name', cellClass: 'cell-strong' },
    // sensitiveField names match screens.py's vendor.directory sensitive_fields
    // tuple exactly — this is RBAC Layer 3, "the field's visibility decides"
    // (same rule the Bank Details filter above already follows): Manager's
    // real fieldMode() drives whether these columns hide entirely or render
    // masked, not a hardcoded role check here.
    { key: 'gstin', header: 'GSTIN', cellClass: 'mono', sensitiveField: 'gstin' },
    { key: 'contact_phone', header: 'Contact Phone', cellClass: 'mono' },
    { key: 'contact_email', header: 'Contact Email' },
    { key: 'payment_terms_days', header: 'Payment Terms', compute: (row) => `${row.payment_terms_days} days` },
    { key: 'bank_account_name', header: 'Bank Account Name', sensitiveField: 'bank_account_name' },
    { key: 'bank_name', header: 'Bank', sensitiveField: 'bank_name' },
    { key: 'bank_account_number_masked', header: 'Account Number', cellClass: 'mono', sensitiveField: 'bank_account_number' },
    { key: 'status', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    {
      key: 'approval_status',
      header: 'Approval',
      type: 'status',
      compute: (row) => (row.approval_status === 'pending_approval' ? 'Pending Approval' : 'Approved'),
    },
  ],
  defaultPageSize: 25,
  emptyText: "No vendors yet — they're often added directly from a Purchase Bill or Expense instead.",
};

export default config;
