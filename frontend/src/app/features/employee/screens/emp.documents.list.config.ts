import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { EmployeeDocumentRow } from '../employee.api';

// Verbatim from the DB CHECK constraint ck_ed_type
// (alembic/versions/0003_employee_leave.py:517) — the same fixed list
// 02-employee-module.md §2.6's own upload form offers, reused here because
// §2.2's Documents tab "shows the same uploaded documents... simply that
// same data, viewed from inside one employee's record" (§2.2, Tab: Documents).
const DOCUMENT_TYPE_OPTIONS = [
  { value: 'ID_PROOF', label: 'ID Proof' },
  { value: 'EDUCATIONAL_CERTIFICATE', label: 'Educational Certificate' },
  { value: 'RESUME', label: 'Resume' },
  { value: 'OFFER_LETTER_COPY', label: 'Offer Letter Copy' },
  { value: 'OTHER', label: 'Others' },
];

// ck_ed_status, same migration line 518.
const STATUS_OPTIONS = [
  { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
];

// DocumentOut (schemas/employee.py) carries file_id but no filename at all —
// StoredFile.original_filename (models/platform.py:39) is never denormalized
// onto the document row, and GET /files/{id} (files.py:111) serves raw file
// bytes with a Content-Disposition header, not JSON metadata a RefLookup
// could resolve through. There's also no generic "view/download this row's
// file" row action yet anywhere — ListScreenComponent.runAction only ever
// fires POST/DELETE (list-screen.component.ts), never a blob GET; the two
// places that DO download a file (payslip-screen/conversation-screen
// components) are bespoke, non-generic code, not something a plain
// RowActionDef can express. So until one of those exists, the file's own id
// (truncated, the same "nothing human-readable exists yet" treatment
// vendor.record.config.ts gives row.id.slice(0, 8) as a header code) is the
// honest stand-in rather than a dead link or a raw untruncated UUID.
function fileLabel(row: EmployeeDocumentRow): string {
  return row.file_id.slice(0, 8);
}

// GET /employees/{employee_id}/documents (employee_documents.py:49) is a bare
// `select(EmployeeDocument).where(employee_id == :id)` — no ?search=, no
// ?status=, no ?format= at all — so every filter below is client transport,
// search is client-side, and export is off (nothing server-side builds a
// PDF/Excel for THIS endpoint; that only exists on the cross-employee
// verification queue, a different screen).
//
// Built as a factory rather than a plain exported config, because the
// endpoint itself is scoped to ONE employee: RecordEmbedTab.config
// (screen.types.ts) accepts `(parentId) => ScreenConfig` precisely so this
// can close over the host record's real id instead of pointing at a URL
// with nothing to fill the {employee_id} segment.
export function buildEmployeeDocumentsListConfig(employeeId: string): ListScreenConfig<EmployeeDocumentRow> {
  return {
    shape: 'list',
    // NOT 'employee.master_record' — verification is gated on
    // employee.documents' own 'verify' action even when the button is shown
    // from inside this record's tab (app/rbac/registry/screens.py's own
    // comment on employee.master_record: "same underlying rows, one RBAC
    // gate, not two").
    id: 'employee.documents',
    title: 'Documents',
    specRef: '§2.2',
    recordNoun: 'document',
    endpoint: `/employees/${employeeId}/documents`,
    exportable: false,
    searchParam: false,
    // No filename field exists anywhere on this row (see fileLabel's own
    // note) — 'note' is the closest free-text field an uploader actually
    // wrote, standing in for §2.6's "Search covers File Name" until a real
    // filename is denormalized onto DocumentOut.
    searchFields: ['document_type', 'note'],
    includeInactiveParam: false,
    filters: [
      {
        key: 'document_type',
        label: 'Document Type',
        kind: 'select',
        transport: 'client',
        allLabel: 'All Document Types',
        options: DOCUMENT_TYPE_OPTIONS,
        predicate: (row, v) => row.document_type === v,
      },
      {
        // §2.6: "Status (Pending Verification / Verified / Rejected —
        // multi-select)".
        key: 'status',
        label: 'Status',
        kind: 'multiselect',
        transport: 'client',
        allLabel: 'All Statuses',
        options: STATUS_OPTIONS,
        predicate: (row, v) => (v as readonly string[]).includes(row.status),
      },
      {
        // No predicate — the store falls back to withinRange over the field
        // named by the key (uploaded_at), which is exactly what's wanted.
        key: 'uploaded_at',
        label: 'Uploaded On',
        kind: 'daterange',
        transport: 'client',
        allLabel: 'All Dates',
      },
    ],
    // Exactly §2.2's own column list: "Document Type, File, Uploaded On,
    // Status (...), and Rejection Reason if applicable."
    columns: [
      { key: 'document_type', header: 'Document Type', cellClass: 'cell-strong', staticOptions: DOCUMENT_TYPE_OPTIONS },
      { key: 'file_id', header: 'File', cellClass: 'mono', compute: fileLabel },
      { key: 'uploaded_at', header: 'Uploaded On', type: 'date' },
      { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
      { key: 'rejection_reason', header: 'Rejection Reason' },
    ],
    rowId: (row) => row.id,
    // No rowRoute, no createRoute: there's nowhere to navigate a click to
    // (this isn't a record of its own), and "+ Upload Document" is §2.6's
    // own screen — not built this pass, per the task's own scope. Deferring
    // upload here rather than half-wiring it: DocumentUpload
    // (schemas/employee.py) needs a real file_id from POST /files first,
    // which is its own multipart upload flow, not a trivial addition.
    rowActions: [
      {
        label: 'Verify',
        endpoint: (row) => `/documents/${row.id}/verify`,
        screenAction: 'verify',
        // verify_document (employee_documents.py:152) 409s "Already
        // reviewed" once status has left Pending — hide the buttons rather
        // than let a click surface that as a raw error.
        visible: (row) => row.status === 'PENDING_VERIFICATION',
        confirm: 'Mark this document as Verified? The employee will be notified.',
        body: () => ({ approve: true }),
      },
      {
        label: 'Reject',
        endpoint: (row) => `/documents/${row.id}/verify`,
        screenAction: 'verify',
        visible: (row) => row.status === 'PENDING_VERIFICATION',
        // DocumentVerifyDecision (schemas/employee.py:268) requires a
        // non-blank rejection_reason when approve=false — verify_document
        // 422s otherwise (employee_documents.py:154-155). RowActionDef has
        // no free-text prompt dialog of its own, only a window.confirm
        // yes/no gate, so this borrows the same window.prompt technique
        // payslip-screen.component.ts already uses for a one-off text value
        // (its own "Purpose for this Salary Certificate" prompt) — it runs
        // synchronously inside `body`, right when the button fires, so
        // there's no separate confirm step. Cancelling (or leaving it
        // blank) still submits; the 422's own detail message then surfaces
        // through the shared actionError banner, which is honest rather
        // than silently doing nothing on Cancel.
        body: () => ({ approve: false, rejection_reason: window.prompt('Reason for rejecting this document (required):', '') }),
      },
    ],
    defaultPageSize: 25,
    emptyText: 'No documents uploaded yet.',
  };
}
