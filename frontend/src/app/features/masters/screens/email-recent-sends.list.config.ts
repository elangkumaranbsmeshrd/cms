import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { EmailSendLogRow } from '../masters.api';

// Resolves email_template_id to the trigger's own name, which is what the
// prototype's "Template" column shows (app-screens2.js:793). The log stores
// only the id plus a subject snapshot; nothing denormalises the name
// server-side, so this is the lookup that makes the column readable.
const TEMPLATE_REF = { endpoint: '/masters/email-configuration/templates', labelKey: 'template_name' };

// The real values email_transport._dispatch returns. Masters §3.21 records the
// divergence itself: "Delivery status as built is Sent / Failed (with error
// text) rather than the Delivered/Bounced webhook states — bounce tracking
// would need provider webhooks and is deferred."
const DELIVERY_STATUS_OPTIONS = [
  { value: 'SENT', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
];

/** sent_at is a timestamp, not a date, and on a troubleshooting log the time
 * is the point — several sends of the same template land on the same day. The
 * shared 'date' column type keeps only the yyyy-mm-dd prefix, so the value is
 * composed here instead, in the prototype's own "01-07-2026 09:00" shape.
 * Rendered exactly as the API sends it (UTC, per email_transport.send_raw) —
 * no local-timezone shifting, so the log agrees with the server's own record. */
function sentAtLabel(row: EmailSendLogRow): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(row.sent_at ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : String(row.sent_at ?? '');
}

// Read-only, append-only log — no rowRoute/createRoute/rowActions at all.
const config: ListScreenConfig<EmailSendLogRow> = {
  shape: 'list',
  id: 'masters.email_configuration',
  title: 'Recent Sends',
  specRef: '§3.21',
  recordNoun: 'sent email',
  // The prototype's own note on this tab (app-screens2.js:792).
  description:
    'Read-only, for troubleshooting a specific delivery — spend and volume reporting belongs elsewhere; this is just "did that one email actually go out."',
  endpoint: '/masters/email-configuration/recent-sends',
  exportable: true,
  rowId: (row) => row.id,
  // recent_sends takes exactly one query param — `format`. No ?search=, and no
  // ?include_inactive= because a log row has no active flag at all. Everything
  // below is client transport.
  searchParam: false,
  // The three fields someone actually troubleshoots by: who it went to, what
  // it said, and whether it landed.
  searchFields: ['recipient_email', 'subject_snapshot', 'delivery_status'],
  includeInactiveParam: false,
  filters: [
    {
      // Client transport: no ?delivery_status= param exists. The first filter
      // anyone reaches for here is "show me only the failures".
      key: 'delivery_status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Statuses',
      options: DELIVERY_STATUS_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.delivery_status),
    },
    {
      // Client transport: no ?sent_from/_to on this endpoint. No predicate —
      // the store falls back to withinRange over the field named by the key,
      // which trims the timestamp to its date part. Presets include the real
      // financial years from Masters §3.1 (RBAC §2.2c).
      key: 'sent_at',
      label: 'Sent',
      kind: 'daterange',
      transport: 'client',
      allLabel: 'All Dates',
    },
    {
      // Client transport: no ?email_template_id= param exists. Options come
      // from the real Templates endpoint, so the choices are whatever triggers
      // actually exist. The cast is because EmailSendLogOut sends
      // email_template_id but masters.api.ts's EmailSendLogRow has not
      // declared it yet — the field is real, the interface is behind.
      key: 'email_template_id',
      label: 'Template',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Templates',
      optionsRef: TEMPLATE_REF,
      predicate: (row, v) => (row as unknown as Record<string, unknown>)['email_template_id'] === String(v),
    },
  ],
  // The prototype's own columns and headers (app-screens2.js:793), plus the
  // Error column the backend's export carries (_RECENT_SENDS_COLUMNS) — a
  // FAILED row that gave no reason was the exact gap §3.21 records fixing.
  columns: [
    { key: 'recipient_email', header: 'To' },
    { key: 'email_template_id', header: 'Template', cellClass: 'cell-strong', ref: TEMPLATE_REF },
    { key: 'subject_snapshot', header: 'Subject' },
    { key: 'sent_at', header: 'Sent On', cellClass: 'mono', compute: sentAtLabel },
    { key: 'delivery_status', header: 'Status', type: 'status', staticOptions: DELIVERY_STATUS_OPTIONS },
    { key: 'error_detail', header: 'Error' },
  ],
  defaultPageSize: 50,
  emptyText: 'No emails sent yet.',
};

export default config;
