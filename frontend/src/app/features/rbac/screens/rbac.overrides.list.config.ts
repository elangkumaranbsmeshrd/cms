import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { RBAC_LAYER_OPTIONS, RBAC_MODULE_OPTIONS, RBAC_ROLE_OPTIONS } from './rbac.module-options';

interface OverrideRow {
  readonly id: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly role_code: string;
  readonly screen_key: string;
  readonly screen_label: string;
  readonly module_key: string;
  readonly layer: string;
  readonly action_key: string | null;
  readonly field_key: string | null;
  readonly override_value: string; // 'GRANT' | 'REVOKE'
  readonly reason: string;
  readonly granted_by: string;
  readonly granted_by_name: string;
  readonly created_at: string;
}

// §4.3's own L1-L4 vocabulary — shared with the Change Log's identical
// filter (rbac.change-log.list.config.ts's CHANGE_TYPE_OPTIONS).
const LAYER_LABELS: Record<string, string> = { L1: 'Visibility', L2: 'Action', L3: 'Field', L4: 'Scope' };

// data.js:44 — 'Granted': 'b-ok', 'Revoked': 'b-danger', carried into this
// shared codebase's BADGE_CLASS dictionary (cell-format.ts) too, but the raw
// column value here is the backend's 'GRANT'/'REVOKE' (OverrideOut.override_value,
// rbac_admin.py), which normalizeKey() does not turn into 'granted'/'revoked'
// — so the badge colour is set explicitly per option rather than relying on
// the shared fallback silently landing on neutral grey.
const TYPE_OPTIONS = [
  { value: 'GRANT', label: 'Granted', badgeClass: 'b-ok' },
  { value: 'REVOKE', label: 'Revoked', badgeClass: 'b-danger' },
];

/** What a specific override actually grants or revokes — there is no single
 * friendly phrase for this on the real backend (unlike the prototype's mock
 * override rows, which hand-authored one, e.g. "Show Salary Amount to
 * Manager") — built from the same layer/action_key/field_key triple the
 * Add Override form itself submits.
 */
function permissionOf(row: OverrideRow): string {
  const base = LAYER_LABELS[row.layer] ?? row.layer;
  if (row.action_key) return `${base} — ${row.action_key}`;
  if (row.field_key) return `${base} — ${row.field_key}`;
  return base;
}

/** §4.3 Individual Permission Overrides (rbac.overrides) — "where a specific
 * person gets extra permission, or has one taken away, without touching
 * anyone else who shares their role" (data.js:1651). The prototype's own
 * shape is a plain filterable list (Employee/Role/Module/Screen/Permission/
 * Type/Granted By/Date, data.js:1656) with a "+ Add Override" button that
 * opens a separate form screen (rbac.addoverride, navHidden) — exactly the
 * generic list-shape + createRoute pattern every other module.directory
 * screen already uses, not the bespoke two-view (person/company-wide)
 * component this used to be.
 *
 * GET /rbac/overrides with no `user_id` IS the company-wide view (its own
 * docstring: "Omit for the company-wide cross-person view") — so this one
 * config covers the whole screen; the per-person "Role Default Summary"
 * reference the old bespoke component showed now lives on the Add Override
 * form instead (rbac.add-override.component.ts), which is where the
 * prototype's own r.override form places it too (app-forms.js:848).
 */
const config: ListScreenConfig<OverrideRow> = {
  shape: 'list',
  id: 'rbac.overrides',
  title: 'Individual Permission Overrides',
  specRef: '§4.3',
  recordNoun: 'override',
  description: 'Where a specific person gets extra permission, or has one taken away, without touching anyone else who shares their role.',
  endpoint: '/rbac/overrides',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      // Backend supports `?user_id=` directly (list_overrides, rbac_admin.py)
      // — real server-side filtering, not a client-side substring match.
      // Options are derived from the rows actually loaded (same reasoning as
      // the Change Log's "Changed By" filter): there is no dedicated
      // {id,name}-shaped Users endpoint to source a full employee list from
      // independent of who already has an override (confirmed while
      // building the bespoke version of this screen and Employee Master
      // Record's Account & Login tab).
      key: 'user_id',
      label: 'Employee',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Employees',
      optionsFromRows: (rows) => [...new Map(rows.map((r) => [r.user_id, r.user_name])).entries()].map(([value, label]) => ({ value, label })),
    },
    {
      key: 'role_code',
      label: 'Role',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Roles',
      options: RBAC_ROLE_OPTIONS,
    },
    {
      key: 'module_key',
      label: 'Module',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Modules',
      options: RBAC_MODULE_OPTIONS,
    },
    // §4.3's own filter list ("Module, Screen, Permission Layer, Grant vs.
    // Revoke, Changed By, and Date range") — Screen/Layer/Changed By/Date
    // range were previously missing even though list_overrides
    // (rbac_admin.py) already accepted all four server-side; 2026-08-11 RBAC
    // audit fix, wired to match.
    {
      key: 'screen_key',
      label: 'Screen',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Screens',
      optionsFromRows: (rows) => [...new Map(rows.map((r) => [r.screen_key, r.screen_label])).entries()].map(([value, label]) => ({ value, label })),
    },
    {
      key: 'layer',
      label: 'Permission Layer',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Layers',
      options: RBAC_LAYER_OPTIONS,
    },
    {
      key: 'changed_by',
      label: 'Changed By',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Users',
      optionsFromRows: (rows) => [...new Map(rows.map((r) => [r.granted_by, r.granted_by_name])).entries()].map(([value, label]) => ({ value, label })),
    },
    { key: 'date_range', label: 'Date', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'date' },
    {
      // No `?override_value=` param on the real endpoint — filtered
      // client-side over the fetched rows, same disclosed limit the
      // exportable comment on ListScreenConfig itself documents (export
      // honours the server-side filters above, not this one).
      key: 'override_value',
      label: 'Override Type',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Types',
      options: TYPE_OPTIONS,
      predicate: (row, value) => row.override_value === value,
    },
  ],
  columns: [
    { key: 'user_name', header: 'Employee', cellClass: 'cell-strong' },
    { key: 'role_code', header: 'Role', type: 'status', staticOptions: RBAC_ROLE_OPTIONS },
    { key: 'module_key', header: 'Module' },
    { key: 'screen_label', header: 'Screen' },
    { key: 'permission', header: 'Permission', compute: (row) => permissionOf(row) },
    { key: 'override_value', header: 'Type', type: 'status', staticOptions: TYPE_OPTIONS },
    { key: 'granted_by_name', header: 'Granted By' },
    { key: 'created_at', header: 'Date', type: 'date', cellClass: 'mono' },
  ],
  createRoute: ['/rbac/overrides/add'],
  createLabel: 'Add Override',
  createScreenAction: 'add', // matches rbac.overrides's registered "add" action, not the default "edit"
  rowActions: [
    {
      label: 'Revoke',
      method: 'DELETE',
      endpoint: (row) => `/rbac/overrides/${row.id}`,
      screenAction: 'remove', // matches rbac.overrides's registered "remove" action
      confirm: 'Revoke this override? The person goes back to their role default for this one permission.',
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No individual overrides in place.',
};

export default config;
