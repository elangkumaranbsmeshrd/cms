import { FormScreenConfig } from '../../../shared/screens/screen.types';

interface AnnouncementFormRow {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly target_scope: string;
  readonly department_ids: readonly string[];
  readonly expiry_date: string | null;
}

const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };

/** §2.11 Announcements — "+ New Announcement" (HR/SA, action 'post').
 * POST-only: AnnouncementCreate has no matching PUT (a Draft is created,
 * then Published/Archived as separate row actions on the list) — no
 * updateEndpoint here, same shape Financial Year's own create-only form
 * uses.
 */
const config: FormScreenConfig<AnnouncementFormRow> = {
  shape: 'form',
  id: 'employee.announcements',
  title: 'New Announcement',
  listEndpoint: '/announcements',
  createEndpoint: '/announcements',
  rowId: (row) => row.id,
  emptyRow: () => ({ title: '', message: '', target_scope: 'ALL_EMPLOYEES', department_ids: [], expiry_date: null }),
  fields: [
    { key: 'title', label: 'Title', required: true, editable: true },
    { key: 'message', label: 'Message', type: 'textarea', required: true, editable: true, span: 2 },
    {
      key: 'target_scope',
      label: 'Audience',
      type: 'select',
      required: true,
      editable: true,
      staticOptions: [
        { value: 'ALL_EMPLOYEES', label: 'All Employees' },
        { value: 'DEPARTMENT', label: 'Specific Departments' },
      ],
    },
    {
      // checkgroup binds the real array field department_ids expects
      // (AnnouncementCreate) — a plain 'select' would try to write one
      // string into an array-typed key. selectOptions() (form-screen.
      // component.ts) resolves checkgroup's option list from `ref` the
      // same way a 'select' field does, despite screen.types.ts's own
      // doc comment describing only the staticOptions case.
      key: 'department_ids',
      label: 'Departments',
      type: 'checkgroup',
      editable: true,
      ref: DEPARTMENT_REF,
      visibleWhen: (m) => m['target_scope'] === 'DEPARTMENT',
      hint: 'Required when Audience is Specific Departments.',
    },
    { key: 'expiry_date', label: 'Expiry Date', type: 'date', editable: true, hint: 'Optional — the announcement stops showing after this date.' },
  ],
  listRoute: ['/announcements'],
};

export default config;
