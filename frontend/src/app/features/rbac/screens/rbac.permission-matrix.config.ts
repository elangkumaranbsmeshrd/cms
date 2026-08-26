import { MatrixGroup, MatrixItem, MatrixScreenConfig } from '../../../shared/screens/screen.types';

/** One row of GET /rbac/matrix/{role_code} (MatrixModuleState, app/schemas/
 * rbac_admin.py) — module_key is the raw registry key (app/rbac/registry/
 * screens.py's ScreenDef.module: 'masters', 'employee', 'leave', 'payroll', …),
 * not a display label.
 */
export interface MatrixModuleRow {
  readonly module_key: string;
  readonly screens: readonly {
    readonly screen_key: string;
    readonly label: string;
    readonly has_scope: boolean;
    readonly mode: string;
    readonly actions: readonly { readonly action_key: string; readonly label: string; readonly allowed: boolean }[];
    readonly fields: readonly { readonly field_key: string; readonly label: string; readonly mode: string }[];
  }[];
}

// §4.2's own module list, "the same 13, in the same order, as Section 3" —
// but grouped the way the prototype's interactive matrix actually renders
// them (app-screens2.js:1299's C.MODULES order), which merges Leave (Module
// 5) and Payroll (Module 6) into the one "Leave & Payroll" section the
// prototype shows — the registry keeps them as two separate ScreenDef
// `module` keys ("leave"/"payroll") since they're independently-built
// modules server-side, but the matrix UI's own grouping is a presentation
// concern, not a data-model one. "rbac" is deliberately absent: the
// registry also carries 4 ScreenDef rows with module="rbac" (RBAC's own
// admin screens, needed so require_screen has something to check), but
// §3's own comment on them — "distinct from the 13 spec modules the Matrix
// screen itself lists — this screen configures those, it isn't one of
// them" — is exactly the prototype's `C.MODULES.filter(m => m.id !== 'rbac')`
// (app-screens2.js:1299) and its selfBlock (:1344-1357). Handled below by
// simply never listing "rbac" in MODULE_META, plus RbacMatrixComponent's
// own trailing self-block for the one toggle §8 defines on this module.
const MODULE_META: readonly { key: string; label: string; specRef: string; sourceKeys: readonly string[] }[] = [
  { key: 'employee', label: 'Employee', specRef: 'Module 2', sourceKeys: ['employee'] },
  { key: 'leavepay', label: 'Leave & Payroll', specRef: 'Modules 5 & 6', sourceKeys: ['leave', 'payroll'] },
  { key: 'asset', label: 'Asset Management', specRef: 'Module 3', sourceKeys: ['asset'] },
  { key: 'ticket', label: 'Ticket', specRef: 'Module 4', sourceKeys: ['ticket'] },
  { key: 'project', label: 'Project', specRef: 'Module 10', sourceKeys: ['project'] },
  { key: 'opportunity', label: 'Opportunity', specRef: 'Module 9', sourceKeys: ['opportunity'] },
  { key: 'customer', label: 'Customer', specRef: 'Module 8', sourceKeys: ['customer'] },
  { key: 'invoice', label: 'Invoice', specRef: 'Module 11', sourceKeys: ['invoice'] },
  { key: 'expense', label: 'Expense', specRef: 'Module 12', sourceKeys: ['expense'] },
  { key: 'purchase_bill', label: 'Purchase Bill', specRef: 'Module 13', sourceKeys: ['purchase_bill'] },
  { key: 'compliance', label: 'Tax & Compliance', specRef: 'Module 15', sourceKeys: ['compliance'] },
  { key: 'vendor', label: 'Vendor', specRef: 'Module 7', sourceKeys: ['vendor'] },
  { key: 'masters', label: 'Masters', specRef: 'Module 1', sourceKeys: ['masters'] },
];

// Layer 1 + Layer 4, merged into the one `mode` field the real data model
// uses (session.model.ts's ScreenMode; see MatrixScreenConfig's own header
// comment for why this is one segmented control, not the prototype's two).
export const SCREEN_MODE_OPTIONS = [
  { value: 'none', label: 'Hidden' },
  { value: 'full', label: 'Full (All)' },
  { value: 'view', label: 'View' },
  { value: 'view_team', label: 'View — Team' },
  { value: 'own', label: 'Own' },
  { value: 'team', label: 'Team' },
];

// Layer 3 — role_permission_fields.mode, all FOUR real values (migration
// 0010 added 'read' on top of the original show/mask/hide; confirmed via
// the live ck_rpf_mode CHECK constraint, not just the schema comment).
// Index 0 ('show') is the DB column's own default, so it's what
// MatrixScreenConfig treats as "not overridden."
export const FIELD_MODE_OPTIONS = [
  { value: 'show', label: 'Show' },
  { value: 'read', label: 'Read-only' },
  { value: 'mask', label: 'Mask' },
  { value: 'hide', label: 'Hide' },
];

function toItem(s: MatrixModuleRow['screens'][number]): MatrixItem {
  return {
    key: s.screen_key,
    label: s.label,
    hasScope: s.has_scope,
    mode: s.mode,
    actions: s.actions.map((a) => ({ key: a.action_key, label: a.label, allowed: a.allowed })),
    fields: s.fields.map((f) => ({ key: f.field_key, label: f.label, mode: f.mode })),
  };
}

function mapGroups(raw: readonly MatrixModuleRow[]): readonly MatrixGroup[] {
  const byKey = new Map<string, MatrixModuleRow>(raw.map((m) => [m.module_key, m]));
  return MODULE_META.map((meta) => {
    const items: MatrixItem[] = [];
    for (const sourceKey of meta.sourceKeys) {
      const mod = byKey.get(sourceKey);
      if (mod) items.push(...mod.screens.map(toItem));
    }
    return { key: meta.key, label: meta.label, specRef: meta.specRef, items };
  }).filter((g) => g.items.length > 0);
}

/** Builds the §4.2 Role Permission Matrix config. `initialRole` is the
 * dropdown's starting value — RbacMatrixComponent reads it once from the
 * `:roleCode` route param (Role Directory's own row click, §4.1: "opens the
 * Role Permission Matrix, pre-selected to that role") and falls back to
 * 'EMPLOYEE', §4.2's own documented default ("the most restrictive role, a
 * sensible starting point for review").
 */
export function buildRbacMatrixConfig(initialRole: string): MatrixScreenConfig<MatrixModuleRow> {
  return {
    shape: 'matrix',
    id: 'rbac.permission_matrix',
    title: 'Role Permission Matrix',
    specRef: '§4.2',
    description: 'The core screen — where every toggle from every module actually gets set, for one role at a time.',
    helpNote:
      "Each screen's visibility and scope share one control (Hidden, or Full/View/Own/Team once visible), followed by that screen's own action permissions and field-level toggles — only the controls that actually mean something on a given screen appear on it.",
    columns: {
      label: 'Configure permissions for',
      optionsEndpoint: '/rbac/roles', // RoleDirectoryRow: role_code/role_name — matches mapOption's own default field names, no override needed
      defaultValue: initialRole,
    },
    rowsEndpoint: (role) => `/rbac/matrix/${role}`,
    mapGroups,
    searchParam: 'search',
    modeOptions: SCREEN_MODE_OPTIONS,
    fieldModeOptions: FIELD_MODE_OPTIONS,
    saveEndpoint: (role) => `/rbac/matrix/${role}`,
    // saveMethod defaults to 'PUT', buildSaveBody defaults to MatrixSaveRequest's
    // own shape — both already exactly what save_matrix (rbac_admin.py) expects.
    saveScreenAction: 'edit', // matches rbac.permission_matrix's registered "edit" action
    moduleFilterLabel: 'All Modules',
    // isDefaultItem/"show all including defaults" (RBAC 14 §3.2) deliberately
    // left unset — the prototype's own matrix (app-screens2.js:1295) always
    // renders every screen with no such toggle, and defaulting this shape's
    // own showAllDefaults(false) to ON would hide most of an Employee's
    // (mostly-default) matrix on first load, which the prototype never does.
  };
}
