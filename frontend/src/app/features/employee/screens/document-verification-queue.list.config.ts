import { ListScreenConfig } from '../../../shared/screens/screen.types';

interface QueueDocumentRow {
  readonly id: string;
  readonly employee_id: string;
  readonly document_type: string;
  readonly file_id: string;
  readonly status: string;
  readonly uploaded_at: string;
  readonly rejection_reason: string | null;
}

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'ID_PROOF', label: 'ID Proof' },
  { value: 'EDUCATIONAL_CERTIFICATE', label: 'Educational Certificate' },
  { value: 'RESUME', label: 'Resume' },
  { value: 'OFFER_LETTER_COPY', label: 'Offer Letter Copy' },
  { value: 'OTHER', label: 'Others' },
];

/** §2.6 My Documents — "HR (and Super Admin) additionally get a Document
 * Verification Queue covering everyone." GET /documents/verification-queue
 * (employee_documents.py), default status=PENDING_VERIFICATION, action
 * 'verify'. Verify/Reject actions mirror emp.documents.list.config.ts's
 * own rowActions exactly — same endpoint, same window.prompt() technique
 * for Reject's required reason.
 */
const config: ListScreenConfig<QueueDocumentRow> = {
  shape: 'list',
  id: 'employee.documents',
  title: 'Document Verification Queue',
  specRef: '§2.6',
  recordNoun: 'document',
  description: 'Every employee document waiting on HR review.',
  endpoint: '/documents/verification-queue',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: false,
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
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', ref: { endpoint: '/employees', labelKey: 'first_name' } },
    { key: 'document_type', header: 'Document Type', cellClass: 'cell-strong', staticOptions: DOCUMENT_TYPE_OPTIONS },
    { key: 'file_id', header: 'File', cellClass: 'mono', compute: (row) => row.file_id.slice(0, 8) },
    { key: 'uploaded_at', header: 'Uploaded On', type: 'date' },
    { key: 'status', header: 'Status', type: 'status' },
  ],
  rowActions: [
    {
      label: 'Verify',
      endpoint: (row) => `/documents/${row.id}/verify`,
      screenAction: 'verify',
      visible: (row) => row.status === 'PENDING_VERIFICATION',
      confirm: 'Mark this document as Verified? The employee will be notified.',
      body: () => ({ approve: true }),
    },
    {
      label: 'Reject',
      endpoint: (row) => `/documents/${row.id}/verify`,
      screenAction: 'verify',
      visible: (row) => row.status === 'PENDING_VERIFICATION',
      body: () => ({ approve: false, rejection_reason: window.prompt('Reason for rejecting this document (required):', '') }),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'Nothing waiting on review.',
};

export default config;
