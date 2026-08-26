import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { FinancialYearRow } from '../masters.api';

// The stored `label` is just the opening year ("2030"); every screen in the
// prototype shows a financial year as "FY 2030–31" (data.js D.masters.fy), and
// a year that spans two calendar years is genuinely ambiguous written either
// other way. Derived here rather than server-side because the backend's label
// is the canonical key other modules join on — this is presentation only.
function fyLabel(row: FinancialYearRow): string {
  const start = String(row.start_date ?? '').slice(0, 4);
  const end = String(row.end_date ?? '').slice(2, 4);
  return start && end ? `FY ${start}–${end}` : (row.label ?? '—');
}

const config: ListScreenConfig<FinancialYearRow> = {
  shape: 'list',
  id: 'masters.financial_year',
  title: 'Financial Year',
  specRef: '§3.1',
  recordNoun: 'financial year',
  description: 'A locked financial year is frozen for everyone, including Super Admin — until a Super Admin explicitly reopens it via Unlock.',
  endpoint: '/masters/financial-years',
  exportable: true,
  rowId: (row) => row.id,
  createRoute: ['/masters/financial-years', 'new'],
  createLabel: 'Add Financial Year',
  // Reuses the create form's route for both EDITING an open year and
  // VIEWING a locked one — financial-years.form.config.ts's readOnlyWhen
  // (status === 'locked') switches FormScreenComponent into read-only "View"
  // automatically per-record, on top of its real updateEndpoint. This is
  // also this screen's "Edit" affordance — matching the house pattern every
  // other Masters screen uses (departments, units-of-measure, ...): a
  // clickable row into the same add/edit form, not a separate "Edit" text
  // button duplicating the same navigation.
  rowRoute: (row) => ['/masters/financial-years', row.id, 'edit'],
  // financial_years.py's list endpoint has no ?search= and no is_active concept
  // at all (a year is open or locked, never deactivated), so both are off.
  searchParam: false,
  searchFields: ['label', 'start_date', 'end_date'],
  includeInactiveParam: false,
  filters: [
    {
      // Server transport: list_financial_years takes a repeatable ?status=
      // (financial_years.py:45), so this one round-trips and the export is
      // exact rather than approximate.
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      param: 'status',
      allLabel: 'All Statuses',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'locked', label: 'Locked' },
      ],
    },
    {
      key: 'is_current',
      label: 'Current',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Current — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.is_current : !row.is_current),
    },
  ],
  columns: [
    { key: 'label', header: 'Financial Year', cellClass: 'cell-strong', compute: fyLabel },
    { key: 'start_date', header: 'From', type: 'date' },
    { key: 'end_date', header: 'To', type: 'date' },
    { key: 'status', header: 'Status', type: 'status' },
    { key: 'is_current', header: 'Current', type: 'status' },
  ],
  // §4.1: start_date/end_date are genuinely editable now (via rowRoute above)
  // while a year is open — Label re-derives to match. Status moves via the
  // three actions below, and Delete is its own fourth action (a real
  // DELETE now exists), all still gated by Invariant 4 where it applies.
  rowActions: [
    {
      label: 'Set Current',
      endpoint: (row) => `/masters/financial-years/${row.id}/set-current`,
      screenAction: 'set_current',
      visible: (row) => !row.is_current && row.status !== 'locked',
    },
    {
      label: 'Lock',
      endpoint: (row) => `/masters/financial-years/${row.id}/lock`,
      screenAction: 'lock',
      visible: (row) => row.status !== 'locked',
      confirm: 'Locking freezes everything dated inside this year for every role, including Super Admin, until a Super Admin explicitly reopens it via Unlock. Continue?',
    },
    {
      // A002 revisited (migration 0009): Super Admin now has a genuine,
      // RBAC-gated Unlock — screenAction 'unlock' is SUPER_ADMIN-only in
      // seed.py, and the DB trigger itself only allows this exact code path
      // to flip status back to 'open' (see unlock_financial_year's docstring).
      label: 'Unlock',
      endpoint: (row) => `/masters/financial-years/${row.id}/unlock`,
      screenAction: 'unlock',
      visible: (row) => row.status === 'locked',
      confirm:
        'Reopening this Financial Year makes every record dated inside it editable again, everywhere, for every role — exactly as if it had never been locked. This is a Super Admin override of a rule everyone else still cannot touch. Continue?',
    },
    {
      // Masters §3.0/§3.1's own Status & Deletion Rule: deletable outright
      // only while nothing elsewhere references it — the backend enforces
      // that via reference_count (409 if > 0), not this button, matching
      // every other Masters screen's Delete action (e.g. units-of-measure).
      // visible only gates on lock status (a real, known-in-advance fact);
      // the reference-count outcome surfaces through the confirm's own
      // wording and the shared row-action error banner if it's refused.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/financial-years/${row.id}`,
      screenAction: 'delete',
      visible: (row) => row.status !== 'locked',
      confirm:
        'Delete this Financial Year permanently? This only succeeds while nothing anywhere references it — if any record is already dated inside it the delete is refused, and you should lock it instead.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No financial years configured.',
};

export default config;
