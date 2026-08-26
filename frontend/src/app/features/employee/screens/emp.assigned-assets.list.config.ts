import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { ASSET_STATUS_OPTIONS } from '../../asset/asset.api';

// Minimal projection of AssetOut (backend/app/schemas/asset.py) — only the
// fields this read-only tab actually renders are typed here, matching
// employee.api.ts's own EmployeeRow convention.
interface AssignedAssetRow {
  id: string;
  asset_tag: string;
  name: string;
  category_id: string;
  // §2.2's mini-table header calls this "Condition" — no such column
  // exists anywhere on Asset (see the comment below), but Asset.status
  // (IN_STORE/IN_USE/UNDER_REPAIR/RETIRED_DISPOSED) is the real field the
  // prototype's own mock data actually populates that column with ("In
  // Use", etc.) — the genuine, already-on-the-row equivalent, not a fake.
  status: string;
}

// AssetCategory is a plain Masters sub-master ({id, name, is_active} —
// masters_lookup.py's generic factory), same RefLookup shape every other
// FK-backed column/filter in this app uses. Endpoint confirmed against
// masters_simple.py:270 ("/masters/asset-categories").
const CATEGORY_REF = { endpoint: '/masters/asset-categories/options', labelKey: 'label' };

/** §2.2 Employee Master Record — Tab: Assigned Assets (read-only): "Pulled
 * from Asset Management. Shows a simple table: Asset Tag (e.g.
 * AST-2026-0001), Asset Name/Type, Assigned Date, Condition. No add, edit,
 * or reassign actions live here — those happen inside Asset Management
 * itself."
 *
 * A FUNCTION, not a plain ListScreenConfig — this tab's whole reason to
 * exist is showing ONE employee's assets, and GET /assets only offers that
 * scope through a real query param (`assigned_to`, assets.py:141) that has
 * to be interpolated with the specific employee's id. emp.record.config.ts
 * (a single static module-level object shared by every employee) can't
 * supply that id at author time, so RecordEmbedTab.config is called with the
 * host record's real id once RecordScreenComponent has resolved it from the
 * route (screen.types.ts's own RecordEmbedTab doc explains why).
 *
 * RBAC: 'asset.directory', NOT a dedicated 'employee.assigned_assets' key.
 * There isn't one — this tab has no separate registration in
 * app/rbac/registry/screens.py at all. It is, exactly as the module doc
 * says, Asset Management's own Directory data with a query param applied;
 * GET /assets is gated by require_screen("asset.directory")
 * (assets.py:37/138), so reusing that id is what makes a role's real
 * permission on THIS data (not on the Employee record it happens to be
 * viewed from) the thing that governs whether the tab's fetch succeeds.
 * One consequence worth flagging: create-list-store.ts persists filters in
 * sessionStorage under `list-filters:${cfg.id}`, so the standalone Asset
 * Directory screen (features/asset/screens/asset.directory.list.config.ts,
 * built later than this file — same 'asset.directory' id) shares one
 * persisted filter/search state with this embedded tab within a session.
 * Harmless in practice (this tab's own endpoint always carries a fixed
 * assigned_to, so the shared filters just start from whatever was last set
 * on either screen), just worth knowing.
 */
export function buildAssignedAssetsListConfig(employeeId: string): ListScreenConfig<AssignedAssetRow> {
  return {
    shape: 'list',
    id: 'asset.directory',
    title: 'Assigned Assets',
    specRef: '§2.2',
    recordNoun: 'asset',
    description: 'Read-only. Add, edit, and reassign actions live in Asset Management itself, not here.',
    endpoint: `/assets?assigned_to=${employeeId}`,
    // Confirmed against assets.py's list_assets: `search` matches
    // name/asset_tag/serial_number server-side (line ~163), so this can be a
    // real server filter rather than a client-side JS scan.
    searchParam: 'search',
    searchFields: ['name', 'asset_tag'],
    // Asset's own lifecycle field is `status` (IN_STORE/IN_USE/RETIRED), not
    // an is_active boolean — Masters' active/inactive convention doesn't
    // apply to this table at all.
    includeInactiveParam: false,
    exportable: true,
    rowId: (row) => row.id,
    // No rowRoute: an Asset Master Record screen doesn't exist yet to link
    // to (no frontend feature module for Asset Management in this pass —
    // confirmed empty), and the module doc is explicit that reassign/edit
    // actions belong there, not here, once it does.
    filters: [
      {
        key: 'category_id',
        label: 'Category',
        kind: 'select',
        transport: 'server',
        allLabel: 'All Categories',
        optionsRef: CATEGORY_REF,
      },
    ],
    columns: [
      { key: 'asset_tag', header: 'Asset Tag', type: 'code' },
      // Doc's "Asset Name/Type" is one column in the prose table but two real
      // fields on the row (Asset.name and Asset.category_id — models/asset.py
      // has no separate "type" column at all); split here to match how the
      // real backend itself already presents the same pair — assets.py's own
      // export column set for this exact data (_ASSET_LIST_COLUMNS) uses
      // "Name" and "Category" as two columns, not one combined string.
      { key: 'name', header: 'Asset Name', cellClass: 'cell-strong' },
      { key: 'category_id', header: 'Category', ref: CATEGORY_REF },
      // §2.2's mini-table calls this "Condition" — Asset.status (the real,
      // already-on-the-row lifecycle field, see AssignedAssetRow's own
      // comment above) is shown under its real name instead of the
      // prototype's mock label, same choice my-assets.component.ts makes
      // for the identical field on §2.9's self-service view.
      { key: 'status', header: 'Status', type: 'status', staticOptions: ASSET_STATUS_OPTIONS },
      // Assigned Date is in the module doc's column list but is NOT real,
      // fetchable data here — left out rather than faking it
      // (asset-categories.list.config.ts's own "Default Useful Life" and
      // ticket-categories.list.config.ts's "Used" columns are the same
      // pattern: omit with the reasoning recorded, don't render an em-dash
      // forever for a field that isn't there). AssetOut (schemas/asset.py)
      // has no such field, and neither does the Asset table (models/
      // asset.py). The real date lives on AssetAssignmentHistory.from_date,
      // but only behind a PER-ASSET endpoint (GET /assets/{asset_id}/
      // assignment-history, assets.py:516) — ColumnDef.compute runs
      // synchronously over a row this list already fetched, it can't issue
      // one extra HTTP call per row to join that in. Even /employees/me/
      // assets (§2.9's own self-service view, assets.py:1029), which
      // already joins AssetAssignmentHistory server-side to support an
      // assigned-date RANGE FILTER, still doesn't put the date itself on
      // the response row — confirmed by reading it end to end. Building
      // this needs real backend work (a stored/joined column on GET
      // /assets) — not something this file can create by itself.
    ],
    defaultPageSize: 25,
    emptyText: 'No assets currently assigned to this employee.',
  };
}
