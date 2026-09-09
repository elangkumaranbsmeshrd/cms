import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { AssetCategoryRow } from '../masters.api';

// §3.0's Created By / Last Modified By pair — see
// service-categories.list.config.ts for why the options are derived from the
// rows on screen rather than from an endpoint of their own.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly AssetCategoryRow[], refData: RefDataService): FilterOption[] => {
    const seen = new Map<string, FilterOption>();
    for (const row of rows) {
      const id = row[key];
      if (id && !seen.has(id)) seen.set(id, { value: id, label: refData.label(USER_REF, id) });
    }
    return [...seen.values()];
  };
}

// §3a built both of this screen's former QUEUED gaps:
// - Default Useful Life (Years): a real `default_useful_life_years` column
//   now (migration 0011), same Integer type as Asset.useful_life_years so a
//   category default and an asset's own override are directly comparable.
// - Used: a LIVE query against Asset.category_id (masters_lookup.py's
//   `referenced_by` mechanism) rather than a stored/synced usage_count
//   column — no migration-driven counter to keep correct as assets.py's
//   create/re-categorize paths evolve.
//
// The prototype's Status filter is the shared "Show inactive" control that
// `includeInactiveParam` turns on (see service-categories.list.config.ts).
const config: ListScreenConfig<AssetCategoryRow> = {
  shape: 'list',
  id: 'masters.asset_categories',
  title: 'Asset Categories',
  specRef: '§3.17',
  recordNoun: 'asset category',
  description: 'Every company-owned physical asset, not just IT and electronics — furniture and fixtures, ID cards and vehicles all belong here. Feeds the Category field on every asset record.',
  endpoint: '/masters/asset-categories',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/asset-categories', row.id, 'edit'],
  createRoute: ['/masters/asset-categories', 'new'],
  createLabel: 'Add Category',
  searchParam: 'search',
  includeInactiveParam: 'include_inactive',
  // §3a — masters_simple.py now passes search_field=["name", "code"].
  searchFields: ['name', 'code'],
  filters: [
    {
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'server',
      param: 'is_referenced',
      allLabel: 'Used — Any',
    },
    // §3.0 / A048's third cross-cutting rule, on every sub-master list:
    // "Created By, Last Modified By, and Created On range". Server transport,
    // so the export header names them and exports exactly what is on screen.
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsFromRows: peopleOptions('created_by') },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsFromRows: peopleOptions('updated_by') },
  ],
  columns: [
    { key: 'name', header: 'Asset Category', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    // §3.17's Screen Design: "List view shows: Category Name, Description,
    // Status." The prototype omits Description; the field is really stored.
    { key: 'description', header: 'Description' },
    { key: 'default_useful_life_years', header: 'Default Useful Life (yrs)', type: 'number' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only.
  rowActions: [
    {
      // §3a — the factory's activate_row (added in an earlier pass) had no
      // row action wired here at all; every sibling lookup already has one.
      label: 'Activate',
      endpoint: (row) => `/masters/asset-categories/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/asset-categories/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: '§3.17 asks for a confirmation before deactivating a category already assigned to an asset. Existing assets keep it; it just stops being offered on new ones. Continue?',
    },
    {
      // ON DELETE RESTRICT enforces §3.17's "never hard-deleted once assigned to
      // any Asset" — the API answers 409 rather than orphaning the asset.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/asset-categories/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Delete this asset category permanently? This only succeeds while nothing references it.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No asset categories configured.',
};

export default config;
