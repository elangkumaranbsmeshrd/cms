import { FilterDef, ListScreenConfig } from '../../../shared/screens/screen.types';
import { OPPORTUNITY_CUSTOMER_REF, OPPORTUNITY_FY_REF, OPPORTUNITY_OWNER_REF, OPPORTUNITY_STAGE_OPTIONS, OpportunityRow } from '../opportunity.api';

// Opportunity Pipeline — table view. GET /opportunities — every query param
// below confirmed against list_opportunities() (backend/app/api/v1/
// opportunities.py): customer_id, stage (repeatable), owner_id,
// financial_year_id, value_min/_max, probability_min/_max,
// expected_close_from/_to, overdue_only, created_from/_to, lost_reason,
// stale_days, created_by, last_modified_by, search (title / customer
// company_name / display_name), format.
//
// §2.1/§7.10: "filters now apply to the Stage summary view as well as the
// Table view... a summary reporting on a different set than the table
// beside it is a genuine way to mislead someone." Exported so
// opportunity.board.component.ts imports the SAME array rather than a
// second hand-copied one — same "cannot drift apart" reasoning the backend's
// shared _build_opportunity_filters() helper already gives for the two
// endpoints (opportunities.py's own docstring).
export const OPPORTUNITY_PIPELINE_FILTERS: readonly FilterDef<OpportunityRow>[] = [
  { key: 'customer_id', label: 'Customer', kind: 'select', transport: 'server', allLabel: 'All Customers', optionsRef: OPPORTUNITY_CUSTOMER_REF },
  { key: 'stage', label: 'Stage', kind: 'multiselect', transport: 'server', allLabel: 'All Stages', options: OPPORTUNITY_STAGE_OPTIONS },
  { key: 'owner_id', label: 'Owner', kind: 'select', transport: 'server', allLabel: 'All Owners', optionsRef: OPPORTUNITY_OWNER_REF },
  { key: 'financial_year_id', label: 'Financial Year', kind: 'select', transport: 'server', allLabel: 'All Financial Years', optionsRef: OPPORTUNITY_FY_REF },
  // key IS the param prefix (no `param` override needed) — mirrors
  // asset.maintenance.list.config.ts's own 'next_due' key, chosen to match
  // the backend's expected_close_from/_to param names directly rather than
  // the row's own expected_close_date field name.
  { key: 'expected_close', label: 'Expected Close Date', kind: 'daterange', transport: 'server' },
  // Same reasoning — created_from/_to. OpportunityOut exposes no
  // created_at field at all (§0), but this is transport:'server', so
  // nothing here ever reads row['created'] client-side.
  { key: 'created', label: 'Created On', kind: 'daterange', transport: 'server' },
  { key: 'overdue_only', label: 'Overdue Only', kind: 'tristate', transport: 'server', allLabel: 'Any' },
  // 'numberrange' (screen.types.ts) — landed since this brief was written.
  // key='value' -> value_min/value_max, matching the backend directly.
  { key: 'value', label: 'Value', kind: 'numberrange', transport: 'server' },
  // key is 'probability', not 'probability_pct' — the backend's params are
  // probability_min/probability_max, not probability_pct_min/_max.
  { key: 'probability', label: 'Probability %', kind: 'numberrange', transport: 'server' },
  // §2.1: "Lost Reason (case-insensitive text match within the reason,
  // effectively scoping to Lost deals since only they carry one)" —
  // list_opportunities' own lost_reason param is a plain ilike substring
  // match, the exact shape the 'text' FilterKind was added for.
  { key: 'lost_reason', label: 'Lost Reason Contains', kind: 'text', transport: 'server' },
  // §2.1: "stale — no activity in N days" — a single cutoff, the exact
  // shape the 'number' FilterKind was added for (not a min/max pair).
  { key: 'stale_days', label: 'Stale (Days, No Activity)', kind: 'number', transport: 'server' },
  // A bare 'All' on both told the reader nothing and told them the same thing
  // twice: the filter chrome renders only allLabel inside the <select> —
  // f.label reaches a title tooltip and nothing more — so these two adjacent
  // people pickers were indistinguishable here, on the Stage Summary board
  // and on the Customer record's Opportunities tab, all three of which reuse
  // this array.
  { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsRef: OPPORTUNITY_OWNER_REF, superAdminOnly: true },
  { key: 'last_modified_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsRef: OPPORTUNITY_OWNER_REF, superAdminOnly: true },
];

// This is one of TWO routes over the same 'opportunity.pipeline' screen key
// — see opportunity.routes.ts's own header comment. The Stage Summary board
// (opportunity.board.component.ts) is reached from the "Board View" button
// below rather than a plain <a routerLink>: ListScreenConfig has no slot for
// literal markup, only SecondaryActionDef (a button that navigates on
// click) — the closest native equivalent this shape offers.
const config: ListScreenConfig<OpportunityRow> = {
  shape: 'list',
  id: 'opportunity.pipeline',
  title: 'Opportunity Pipeline',
  recordNoun: 'opportunity',
  description: 'Every deal this role can see, across every stage.',
  endpoint: '/opportunities',
  exportable: true,
  defaultPageSize: 25,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/opportunities', row.id],
  createRoute: ['/opportunities', 'new'],
  createLabel: 'Add Opportunity',
  createScreenAction: 'edit',
  searchParam: 'search',
  includeInactiveParam: false,
  secondaryActions: [
    // 'view' matches PolicyStore's ALWAYS_ALLOWED regex — visible to anyone
    // who can open this screen at all, same reasoning ticket.detail.
    // component.ts documents for its own conversationConfig.screenAction.
    { label: 'Board View', icon: 'kanban', route: ['/opportunities', 'board'], screenAction: 'view' },
  ],
  filters: OPPORTUNITY_PIPELINE_FILTERS,
  columns: [
    // Prototype's own Pipeline table (app-screens2.js R.pipeline, Table view)
    // leads with Code — was missing here entirely.
    { key: 'opportunity_code', header: 'Code', type: 'code' },
    { key: 'title', header: 'Title', cellClass: 'cell-strong' },
    { key: 'customer_id', header: 'Customer', ref: OPPORTUNITY_CUSTOMER_REF },
    { key: 'value', header: 'Value', type: 'money' },
    { key: 'stage', header: 'Stage', type: 'status', staticOptions: OPPORTUNITY_STAGE_OPTIONS },
    {
      key: 'probability_pct',
      header: 'Probability',
      type: 'number',
      compute: (row) => (row.probability_pct === null || row.probability_pct === undefined ? null : `${Number(row.probability_pct)}%`),
    },
    { key: 'expected_close_date', header: 'Expected Close Date', type: 'date' },
    { key: 'owner_id', header: 'Owner', ref: OPPORTUNITY_OWNER_REF },
  ],
  emptyText: 'No opportunities found.',
};

export default config;
