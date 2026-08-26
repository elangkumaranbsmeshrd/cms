import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { AssetRequestRow } from '../asset.api';

const EMPLOYEE_REF = { endpoint: '/employees/options', labelKey: 'label' };
const ASSET_REF = { endpoint: '/assets' };
const CATEGORY_REF = { endpoint: '/masters/asset-categories/options', labelKey: 'label' };

// AssetRequestWrite.request_type validator — REPAIR|DAMAGE_REPORT|RETURN
// only. There is deliberately no "Transfer" request type: Transfer is only
// ever a direct HR/SA action via the Assignment History tab, never something
// an employee requests (§ what-not-to-build).
const REQUEST_TYPE_OPTIONS = [
  { value: 'REPAIR', label: 'Repair' },
  { value: 'DAMAGE_REPORT', label: 'Damage Report' },
  { value: 'RETURN', label: 'Return' },
];

// AssetRequest.status — PENDING|APPROVED|REJECTED only. There is no
// "Completed" status anywhere in this schema.
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

// §4 Asset Requests / Approval Queue (asset.requests). GET /asset-requests —
// every query param confirmed against list_asset_requests()
// (backend/app/api/v1/assets.py).
//
// No "Date Raised" column: AssetRequestOut (backend/app/schemas/asset.py)
// exposes no created_at/date_raised field at all, even though the real
// list_asset_requests() endpoint DOES filter by AssetRequest.created_at
// server-side via date_from/date_to — a confirmed, genuine gap between what
// the filter can narrow and what the row can show, the same class of gap
// the module's own brief already discloses for "Assigned Date" elsewhere
// (Reclaim / Assigned Assets). The Date Raised RANGE FILTER below is kept
// (it genuinely works), the COLUMN is not (there is nothing to read).
const config: ListScreenConfig<AssetRequestRow> = {
  shape: 'list',
  id: 'asset.requests',
  title: 'Asset Requests',
  specRef: '§2.6',
  recordNoun: 'request',
  endpoint: '/asset-requests',
  exportable: true,
  defaultPageSize: 25,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['description'],
  includeInactiveParam: false,
  filters: [
    { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: STATUS_OPTIONS },
    { key: 'request_type', label: 'Request Type', kind: 'select', transport: 'server', allLabel: 'All Types', options: REQUEST_TYPE_OPTIONS },
    { key: 'employee_id', label: 'Requester', kind: 'select', transport: 'server', allLabel: 'All Requesters', optionsRef: EMPLOYEE_REF },
    // §0.3: approved_by is a raw USER id, not an Employee id — reusing the
    // Employee ref here (rather than nothing at all, since no Users lookup
    // exists anywhere in this backend) is a deliberate, disclosed
    // imperfection: the picked option's id won't actually match what's
    // stored in approved_by. Kept anyway per the module brief's own explicit
    // call — "label resolution will be imperfect/id-based, that's expected".
    { key: 'approved_by', label: 'Approver', kind: 'select', transport: 'server', allLabel: 'All Approvers', optionsRef: EMPLOYEE_REF },
    { key: 'category_id', label: 'Asset Category', kind: 'select', transport: 'server', allLabel: 'All Categories', optionsRef: CATEGORY_REF },
    // §0.6 — param 'date', NOT 'date_raised' (list_asset_requests()'s own
    // date_from/date_to params).
    { key: 'date', label: 'Date Raised', kind: 'daterange', transport: 'server' },
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', ref: EMPLOYEE_REF },
    { key: 'asset_id', header: 'Asset', cellClass: 'cell-strong', ref: ASSET_REF },
    { key: 'request_type', header: 'Request Type', staticOptions: REQUEST_TYPE_OPTIONS },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
    { key: 'description', header: 'Description' },
  ],
  rowActions: [
    {
      label: 'Approve',
      endpoint: (row) => `/asset-requests/${row.id}/approve`,
      screenAction: 'approve',
      visible: (row) => row.status === 'PENDING',
      confirm: 'Approve this request?',
    },
    {
      label: 'Reject',
      endpoint: (row) => `/asset-requests/${row.id}/reject`,
      // §0.2: SAME action as Approve — there is no separate "reject" action
      // registered anywhere in the RBAC registry.
      screenAction: 'approve',
      visible: (row) => row.status === 'PENDING',
      // window.prompt runs synchronously at click time, matching
      // emp.documents.list.config.ts's own Reject action exactly — cancelling
      // or leaving it blank still submits, surfaced honestly through the
      // 422's own detail message via the shared actionError banner.
      body: () => ({ rejection_reason: window.prompt('Reason for rejecting this request (required):', '') }),
    },
  ],
  emptyText: 'No pending requests.',
};

export default config;
