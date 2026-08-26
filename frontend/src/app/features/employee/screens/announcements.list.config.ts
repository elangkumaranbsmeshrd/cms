import { ListScreenConfig } from '../../../shared/screens/screen.types';

interface AnnouncementRow {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly target_scope: string;
  readonly posted_by_user_id: string;
  readonly published_at: string | null;
  readonly expiry_date: string | null;
  readonly status: string;
}

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const SCOPE_OPTIONS = [
  { value: 'ALL_EMPLOYEES', label: 'All Employees' },
  { value: 'DEPARTMENT', label: 'Specific Department(s)' },
];

const POSTED_BY_REF = { endpoint: '/users', labelKey: 'name' };

/** §2.11 Announcements (employee.announcements) — Employee/Manager/
 * Accountant see 'view' (auto-filtered to Published only, server-side);
 * HR/SA see 'full' + 'post' (Draft/Published/Archived, plus the write
 * actions below). Posted-By/scope/Active-Expired/date-range filters were
 * confirmed absent server-side and are now built (announcements.py) —
 * 2026-08-11 production-readiness audit fix.
 */
const config: ListScreenConfig<AnnouncementRow> = {
  shape: 'list',
  id: 'employee.announcements',
  title: 'Announcements',
  specRef: '§2.11',
  recordNoun: 'announcement',
  description: 'Company and department announcements.',
  endpoint: '/announcements',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: false,
  includeInactiveParam: false,
  createRoute: ['/announcements', 'new'],
  createLabel: 'New Announcement',
  createScreenAction: 'post',
  filters: [
    { key: 'posted_by', label: 'Posted By', kind: 'select', transport: 'server', allLabel: 'Anyone', optionsRef: POSTED_BY_REF },
    { key: 'target_scope', label: 'Post To', kind: 'select', transport: 'server', allLabel: 'Any Scope', options: SCOPE_OPTIONS },
    { key: 'is_active', label: 'Active / Expired', kind: 'tristate', transport: 'server', allLabel: 'Any' },
    { key: 'posted_on', label: 'Posted On', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'posted_on' },
  ],
  columns: [
    { key: 'title', header: 'Title', cellClass: 'cell-strong' },
    { key: 'message', header: 'Message' },
    { key: 'posted_by_user_id', header: 'Posted By', ref: POSTED_BY_REF },
    { key: 'target_scope', header: 'Post To', type: 'chip', staticOptions: SCOPE_OPTIONS },
    { key: 'published_at', header: 'Published On', type: 'date' },
    { key: 'expiry_date', header: 'Expires On', type: 'date' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
  ],
  rowActions: [
    {
      label: 'Publish',
      endpoint: (row) => `/announcements/${row.id}/publish`,
      screenAction: 'post',
      visible: (row) => row.status === 'DRAFT',
      confirm: 'Publish this announcement? It becomes visible to its target audience immediately.',
    },
    {
      label: 'Archive',
      endpoint: (row) => `/announcements/${row.id}/archive`,
      screenAction: 'post',
      visible: (row) => row.status === 'PUBLISHED',
      confirm: 'Archive this announcement?',
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No announcements yet.',
};

export default config;
