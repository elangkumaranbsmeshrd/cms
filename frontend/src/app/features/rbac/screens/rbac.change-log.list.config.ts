import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { RBAC_ROLE_OPTIONS } from './rbac.module-options';

interface ChangeLogRow {
  readonly id: string;
  readonly changed_at: string;
  readonly changed_by: string;
  readonly changed_by_name: string;
  readonly target_role: string | null;
  readonly target_user: string | null;
  readonly target_user_name: string | null;
  readonly module_key: string | null;
  readonly screen_key: string | null;
  readonly screen_label: string | null;
  readonly layer: string;
  readonly before_value: Record<string, unknown> | null;
  readonly after_value: Record<string, unknown> | null;
}

// Prototype's own Change Type vocabulary (data.js's permLog rows /
// rbac.log's filter options), not the raw L1-L4 codes — "Change Type" is
// the prototype's column header (app-screens.js:1665), and its filter
// (data.js:1663) spells these out in full rather than "Visibility"/
// "Action"/"Field"/"Scope".
const CHANGE_TYPE_OPTIONS = [
  { value: 'L1', label: 'Screen visibility' },
  { value: 'L2', label: 'Action permission' },
  { value: 'L3', label: 'Field toggle' },
  { value: 'L4', label: 'Scope restriction' },
];

// Layer 1/4's real mode vocabulary (session.model.ts's ScreenMode) and
// Layer 3's real field-mode vocabulary (migration 0010's show/read/mask/
// hide) — used only to translate a change-log entry's raw before/after
// JSON into the prototype's own From/To wording ('Hidden', 'Read-only', …).
const MODE_LABELS: Record<string, string> = {
  none: 'Hidden', full: 'Full (All)', view: 'View', view_team: 'View — Team', own: 'Own', team: 'Team',
};
const FIELD_MODE_LABELS: Record<string, string> = { show: 'Show', read: 'Read-only', mask: 'Mask', hide: 'Hide' };

/** A change-log entry's before/after JSON has one of four real shapes,
 * depending on WHAT wrote it (rbac_admin.py): a matrix save writes
 * {mode} (L1) / {action_key, allowed} (L2) / {field_key, mode} (L3); a
 * toggle update writes {toggle_key, enabled} (also logged as L2, since a
 * toggle isn't a screen action but shares the boolean shape); an override
 * create/remove writes {action_key, field_key, value, reason} (value is
 * 'GRANT'/'REVOKE', any layer L1-L4). Detected by which key is actually
 * present rather than trusted to `layer` alone, since L1 and L3 both use a
 * `mode` key from two different vocabularies.
 */
function formatChangeValue(layer: string, v: Record<string, unknown> | null): string {
  if (!v) return '—';
  if ('value' in v) {
    const val = String(v['value'] ?? '');
    return val === 'GRANT' ? 'Granted' : val === 'REVOKE' ? 'Revoked' : val || '—';
  }
  if ('allowed' in v) return v['allowed'] ? 'Allowed' : 'Denied';
  if ('enabled' in v) return v['enabled'] ? 'ON' : 'OFF';
  if ('mode' in v) {
    const mode = String(v['mode'] ?? '');
    return (layer === 'L3' ? FIELD_MODE_LABELS[mode] : MODE_LABELS[mode]) ?? mode ?? '—';
  }
  return '—';
}

/** What actually changed. Most rows carry a real screen (matrix saves and
 * every override both always resolve a screen_id) — a bare toggle update
 * is the one case with none (rbac_admin.py's update_toggles: "a toggle
 * isn't owned by one screen"), so it falls back to the toggle's own name,
 * which IS the toggle_key verbatim (FeatureToggle.toggle_key stores the
 * full display phrase as its own key, e.g. "Allow Manager to Run Payroll"
 * — confirmed via app/rbac/toggles.py's TOGGLE_DEFAULTS — not a coded
 * shorthand needing a second lookup).
 */
function targetOf(row: ChangeLogRow): string {
  if (row.screen_label) return row.screen_label;
  const toggleKey = (row.after_value?.['toggle_key'] as string | undefined) ?? (row.before_value?.['toggle_key'] as string | undefined);
  return toggleKey ?? '—';
}

/** §4.4 Permission Change Log (rbac.change_log) — "an audit trail of
 * every permission change made in this module... immutable at the
 * database level" (permission_change_log carries real MySQL triggers
 * rejecting UPDATE/DELETE). Read-only list — plain 'list' shape, no
 * createRoute/rowActions.
 */
const config: ListScreenConfig<ChangeLogRow> = {
  shape: 'list',
  id: 'rbac.change_log',
  title: 'Permission Change Log',
  specRef: '§4.4',
  recordNoun: 'change',
  description: 'Every permission change ever made — role defaults and individual overrides alike. Append-only, enforced by the database itself.',
  endpoint: '/rbac/change-log',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['screen_label', 'target_role', 'target_user_name'],
  includeInactiveParam: false,
  filters: [
    {
      // create-list-store.ts's server-daterange handling sends
      // `${param}_from`/`${param}_to` — `param: 'date'` is what makes those
      // land as the real `date_from`/`date_to` query params (rbac_admin.py's
      // change_log()), not the filter's own key.
      key: 'date_range',
      label: 'Date',
      kind: 'daterange',
      transport: 'server',
      allLabel: 'All Dates',
      param: 'date',
    },
    {
      key: 'layer',
      label: 'Change Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Change Types',
      options: CHANGE_TYPE_OPTIONS,
    },
    {
      // Prototype's own "Changed By — All Users, Ravi Shankar" (data.js:
      // 1663) — a single hardcoded name because the prototype's mock data
      // only ever has one Super Admin acting. The real backend has no
      // dedicated "who has ever changed a permission" endpoint, so this is
      // the same optionsFromRows pattern the Module filter below already
      // uses: honestly derived from whichever changers appear in the rows
      // actually loaded, not a fabricated full user list.
      key: 'changed_by',
      label: 'Changed By',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Users',
      optionsFromRows: (rows) => [...new Map(rows.map((r) => [r.changed_by, r.changed_by_name])).entries()].map(([value, label]) => ({ value, label })),
    },
    {
      key: 'module_key',
      label: 'Module',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Modules',
      optionsFromRows: (rows) => [...new Set(rows.map((r) => r.module_key).filter((v): v is string => !!v))].map((v) => ({ value: v, label: v })),
    },
    // §4.4's own filter list also asks for Screen and "a specific-person-or-
    // role picker" — previously missing even though change_log()
    // (rbac_admin.py) already accepted target_user_id, and now also accepts
    // target_role_code (added alongside this fix, since the frontend only
    // ever has a role's code, not its UUID). 2026-08-11 RBAC audit fix.
    {
      key: 'screen_key',
      label: 'Screen',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Screens',
      optionsFromRows: (rows) =>
        [...new Map(rows.filter((r) => r.screen_key).map((r) => [r.screen_key as string, r.screen_label as string])).entries()].map(([value, label]) => ({ value, label })),
    },
    {
      key: 'target_role_code',
      label: 'Target Role',
      kind: 'select',
      transport: 'server',
      allLabel: 'Any Target',
      options: RBAC_ROLE_OPTIONS,
    },
    {
      key: 'target_user_id',
      label: 'Target Person',
      kind: 'select',
      transport: 'server',
      allLabel: 'Any Target',
      optionsFromRows: (rows) =>
        [...new Map(rows.filter((r) => r.target_user).map((r) => [r.target_user as string, r.target_user_name as string])).entries()].map(([value, label]) => ({ value, label })),
    },
  ],
  columns: [
    { key: 'changed_at', header: 'When', type: 'date', cellClass: 'mono' },
    { key: 'changed_by_name', header: 'Changed By', cellClass: 'cell-strong' },
    { key: 'layer', header: 'Change Type', type: 'status', staticOptions: CHANGE_TYPE_OPTIONS },
    { key: 'target', header: 'Target', compute: (row) => targetOf(row) },
    { key: 'before_value', header: 'From', type: 'status', compute: (row) => formatChangeValue(row.layer, row.before_value) },
    { key: 'after_value', header: 'To', type: 'status', compute: (row) => formatChangeValue(row.layer, row.after_value) },
    {
      key: 'applied_to',
      header: 'Applied To',
      compute: (row) => (row.target_role ? `Role: ${row.target_role}` : row.target_user_name ? `Person: ${row.target_user_name}` : 'Global'),
    },
    // Not one of the prototype's own 7 columns (its flattened mock "Target"
    // folds module context into the string, e.g. 'Ticket List → New
    // Ticket') — kept here as a real, schema-backed extra: module_key is a
    // genuine ChangeLogOut field and the Module filter above already
    // depends on it existing, so surfacing it beats requiring a click into
    // each row to learn which of the 13 modules a change belongs to.
    { key: 'module_key', header: 'Module' },
  ],
  defaultPageSize: 50,
  emptyText: 'No permission changes recorded yet.',
};

export default config;
