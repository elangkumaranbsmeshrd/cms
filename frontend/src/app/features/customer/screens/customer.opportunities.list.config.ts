import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { OPPORTUNITY_OWNER_REF, OPPORTUNITY_STAGE_OPTIONS, OpportunityRow } from '../../opportunity/opportunity.api';
import { OPPORTUNITY_PIPELINE_FILTERS } from '../../opportunity/screens/opportunity.pipeline.list.config';

/** §2.3 Customer 360, Tab: Opportunities — "As built, this tab is served
 * by the Opportunity module's own list endpoint filtered by customer_id...
 * clicking a row opens its full record there." Filters/export mirror
 * opportunity.pipeline.list.config.ts's own canonical set exactly (minus
 * customer_id itself — every row here is already this one customer, and
 * that filter would be redundant) — imports the SAME array the Pipeline
 * table/board views use rather than a hand-copy, so a filter added there
 * later (this array already grew once, picking up Lost Reason and Stale
 * days) can never silently stop showing up here too.
 */
export function buildCustomerOpportunitiesListConfig(customerId: string): ListScreenConfig<OpportunityRow> {
  return {
    shape: 'list',
    id: 'opportunity.pipeline',
    title: 'Opportunities',
    specRef: '§2.3',
    recordNoun: 'opportunity',
    description: 'Deals linked to this customer. Read-only here — open the Opportunity module to edit.',
    endpoint: `/opportunities?customer_id=${customerId}`,
    exportable: true,
    searchParam: 'search',
    includeInactiveParam: false,
    rowId: (row) => row.id,
    rowRoute: (row) => ['/opportunities', row.id],
    filters: OPPORTUNITY_PIPELINE_FILTERS.filter((f) => f.key !== 'customer_id'),
    columns: [
      // §2.3's own mini-table columns (app-screens2.js:327): Opportunity /
      // Stage / Value / Expected Close / Owner.
      { key: 'title', header: 'Opportunity', cellClass: 'cell-strong' },
      { key: 'stage', header: 'Stage', type: 'status', staticOptions: OPPORTUNITY_STAGE_OPTIONS },
      { key: 'value', header: 'Value', type: 'money' },
      { key: 'expected_close_date', header: 'Expected Close', type: 'date' },
      { key: 'owner_id', header: 'Owner', ref: OPPORTUNITY_OWNER_REF },
    ],
    defaultPageSize: 25,
    emptyText: 'No opportunities yet.',
  };
}
