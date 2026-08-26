import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { formatMoney } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { BoardScreenComponent } from '../../../shared/screens/board-screen/board-screen.component';
import { BoardScreenConfig } from '../../../shared/screens/screen.types';
import { IconComponent } from '../../../shared/ui/icon.component';
import { OPPORTUNITY_CUSTOMER_REF, OPPORTUNITY_STAGE_OPTIONS, OpportunityRow, OpportunityWriteBody } from '../opportunity.api';
import { OPPORTUNITY_PIPELINE_FILTERS } from './opportunity.pipeline.list.config';

/** Opportunity Pipeline — Stage Summary board. One of TWO routes over the
 * same 'opportunity.pipeline' screen key (see opportunity.routes.ts); the
 * table view is canonical (screenRoute() straight onto
 * opportunity.pipeline.list.config.ts), this one is a bespoke wrapper for a
 * reason the table view doesn't need: BoardScreenConfig (screen.types.ts)
 * has no SecondaryActionDef-equivalent slot at all — no page-head-button or
 * link mechanism of any kind — so there is no native way to place a "Table
 * View" link next to it from config alone. This wrapper supplies that one
 * link itself, plus the page title, and hosts the real
 * <app-board-screen [embedded]="true" /> underneath, exactly the way
 * ticket.detail.component.ts hosts <app-conversation-screen [embedded]="true" />
 * inside its own bespoke page for the identical reason (a shape with no
 * slot for something this screen needs alongside it).
 *
 * board/list/tabbed-screen.component.ts are all shared, out of this
 * module's folder — nothing here edits any of them.
 */
@Component({
  selector: 'app-opportunity-board',
  standalone: true,
  imports: [IconComponent, RouterLink, BoardScreenComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Opportunity Pipeline — Stage Summary</h1>
        <p class="page-sub">Drag a card to a new column, or use the dropdown on each card. Both do the same thing.</p>
      </div>
      <div class="page-actions">
        <a class="btn ghost" routerLink="/opportunities">
          <app-icon name="list" [size]="14" />Table View
        </a>
      </div>
    </div>
    <app-board-screen [config]="config" [embedded]="true" />
  `,
})
export class OpportunityBoardComponent {
  private readonly refData = inject(RefDataService);

  // CRITICAL (§0 of the brief this was built against): PUT /opportunities/{id}
  // requires the COMPLETE OpportunityWrite body every time — the handler does
  // `for field, value in body.model_dump(): setattr(row, field, value)`. The
  // board's own default stage-change body is just `{stage: newValue}`, which
  // 422s (missing required title/customer_id) or would null out every other
  // field if it somehow validated. stageChangeBody below always builds the
  // full body from the dragged row's own already-loaded fields.
  protected readonly config: BoardScreenConfig<OpportunityRow> = {
    shape: 'board',
    id: 'opportunity.pipeline',
    title: 'Opportunity Pipeline',
    endpoint: '/opportunities',
    rowId: (row) => row.id,
    statusField: 'stage',
    recordNoun: 'opportunity',
    searchFields: ['title', 'opportunity_code'],
    // §2.1/§7.10: "filters now apply to the Stage summary view as well as
    // the Table view... the stage counts and totals reflect the filtered
    // set" — same array the table view uses (imported, not copied), so the
    // two views can't drift apart.
    filters: OPPORTUNITY_PIPELINE_FILTERS,
    rowRoute: (row) => ['/opportunities', row.id],
    columns: OPPORTUNITY_STAGE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label, metricField: 'value' })),
    card: {
      code: (row) => row.opportunity_code,
      title: (row) => row.title,
      // BoardCardFieldsDef.money is `(row: T) => string`, not nullable (unlike
      // meta/avatar/due) — '' rather than null for a blank value. The
      // template's `@if (cardMoney(row); as money)` treats '' exactly like
      // null (both falsy), so a blank Value still hides the money line.
      money: (row) => (row.value === null || row.value === undefined ? '' : formatMoney(Number(row.value))),
      meta: (row) => {
        const customer = this.refData.label(OPPORTUNITY_CUSTOMER_REF, row.customer_id);
        const prob = row.probability_pct === null || row.probability_pct === undefined ? null : Number(row.probability_pct);
        return prob === null ? customer : `${customer} · ${prob}%`;
      },
    },
    stageChangeEndpoint: (row) => `/opportunities/${row.id}`,
    stageChangeBody: (row, newValue) => this.buildStageChangeBody(row, newValue),
  };

  /** Builds the full OpportunityWrite body PUT /opportunities/{id} requires,
   * carrying every one of the dragged row's own fields forward unchanged
   * except stage (and lost_reason, per the Won/Lost mechanics below).
   *
   * Moving to LOST: OpportunityWrite's own server-side validation requires a
   * non-blank lost_reason or the PUT 422s — prompted synchronously here,
   * inside the same callback the drop/select handler already calls.
   *
   * Cancelling or leaving the prompt blank must "abort — don't fire the PUT
   * at all" (per this module's own brief), but stageChangeBody only SHAPES
   * the body; board-screen.component.ts's changeStage() always fires the
   * request once this returns (there is no hook to cancel it outright, and
   * that file is shared/out of this module's scope to edit). Throwing here
   * would leave the card's pendingId set forever with no subscribe/error
   * callback ever running to clear it — a stuck, permanently-disabled card,
   * worse than a network round-trip. So the closest real "abort" available
   * is to send the row back with its CURRENT stage and CURRENT lost_reason
   * (a full, already-valid body) instead of the attempted new stage: the PUT
   * still fires, but succeeds as a no-op, and the card visually stays where
   * it was — the same outcome a genuine cancel would produce.
   *
   * Moving to any stage other than LOST always clears lost_reason to null —
   * matching the backend's own unconditional behaviour on that transition,
   * restated explicitly here rather than relied upon implicitly.
   *
   * Moving to LOST also always sends probability_pct: 0 — "Lost auto-sets
   * Probability to 0%" (app-forms.js's 'o.lost' form). The backend does NOT
   * do this itself (opportunities.py's update_opportunity only special-cases
   * Won's probability), so the frontend is the only place this rule can be
   * enforced; opportunity.lost.component.ts's own dedicated Mark-Lost screen
   * applies the identical rule, so both paths to LOST behave the same way.
   */
  private buildStageChangeBody(row: OpportunityRow, newValue: string): OpportunityWriteBody {
    const base = {
      title: row.title,
      customer_id: row.customer_id,
      value: row.value === null || row.value === undefined ? null : Number(row.value),
      probability_pct: row.probability_pct === null || row.probability_pct === undefined ? null : Number(row.probability_pct),
      expected_close_date: row.expected_close_date,
      description: row.description,
      owner_id: row.owner_id,
    };
    if (newValue === 'LOST') {
      const reason = window.prompt('Reason for marking this opportunity Lost (required):', '')?.trim();
      // Cancelled/blank prompt: abort-as-no-op (see doc above) — sends the
      // row back with its CURRENT probability too, not 0, since nothing is
      // actually moving to LOST in this branch.
      if (!reason) return { ...base, stage: row.stage, lost_reason: row.lost_reason ?? null };
      return { ...base, stage: newValue, probability_pct: 0, lost_reason: reason };
    }
    return { ...base, stage: newValue, lost_reason: null };
  }
}
