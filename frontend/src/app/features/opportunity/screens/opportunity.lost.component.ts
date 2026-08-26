import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { OPPORTUNITY_STAGE_OPTIONS, OpportunityRow, OpportunityWriteBody } from '../opportunity.api';

const SCREEN = 'opportunity.pipeline';

/** Opportunity §2.2 — "Mark Opportunity Lost" (app-forms.js's dedicated
 * 'o.lost' form), reached via the "Mark Lost" record action on the Add/Edit
 * Opportunity form (opportunity.form.config.ts). The prototype's own hint on
 * this form: "Required. The prompt appears the moment Stage is changed to
 * Lost — from the Add/Edit form or from a drag into the Lost column — and
 * the change cannot be saved without it." The drag-into-Lost-column case is
 * already handled by opportunity.board.component.ts's own window.prompt();
 * this bespoke route/component is the other half — reached from the Add/Edit
 * form instead of an inline field, because FieldConfig has no onChange hook
 * to redirect the instant Stage becomes Lost (see opportunity.form.config.ts's
 * own header comment) — a dedicated confirmation screen is the closest
 * faithful equivalent this codebase's shared form framework allows without
 * editing it.
 *
 * Fields mirror 'o.lost' exactly: Opportunity (read-only), Stage shown as a
 * "Current → Lost" transition (read-only), Reason (required), Probability
 * (read-only, always "0" — "Lost auto-sets Probability to 0%.", app-forms.js).
 * The backend does NOT auto-zero probability_pct on a Lost transition itself
 * (opportunities.py's update_opportunity only special-cases Won) — this
 * screen sends probability_pct: 0 explicitly in the PUT body so the read-only
 * "0" shown here is always what actually gets saved, never a label that
 * lies about the persisted value.
 *
 * PUT /opportunities/{id} requires the COMPLETE OpportunityWrite body (same
 * §0 constraint opportunity.board.component.ts's own stageChangeBody
 * documents) — every other field is carried forward unchanged from the
 * freshly-loaded row, exactly like that component's buildStageChangeBody.
 */
@Component({
  selector: 'app-opportunity-lost',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Mark Opportunity Lost</h1>
        @if (opportunity(); as o) {
          <p class="page-sub mono">{{ o.opportunity_code }}</p>
        }
      </div>
    </div>

    @if (opportunity(); as o) {
      <!-- "as" only binds on the very first @if of a chain — never on an
           @else if, no matter its position (confirmed by ng build: moving
           this "as" branch to 3rd position still NG5002'd) — so this has to
           be the primary branch, with isLoading()/loadError() pushed to
           @else if below it instead of above. Still the right fallback
           order: opportunity() is null throughout loading and after a load
           error alike, so those two states naturally fall through to the
           @else if chain below unchanged. -->
      @if (!canEdit()) {
        <div class="empty">
          <p><b>You don't have access to mark this opportunity Lost.</b></p>
        </div>
      } @else {
        @if (saveError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
        }
        <div class="card">
          <div class="card-body">
            <div class="grid g-2">
              <div class="field" style="grid-column: span 2;">
                <label>Opportunity</label>
                <div class="readonly-value">{{ o.opportunity_code }} · {{ o.title }}</div>
              </div>
              <div class="field">
                <label>Stage</label>
                <div class="readonly-value">{{ stageLabel(o.stage) }} → Lost</div>
              </div>
              <div class="field">
                <label>Probability (%)</label>
                <div class="readonly-value">0</div>
              </div>
              <div class="field" style="grid-column: span 2;">
                <label>
                  Reason
                  <span class="req" aria-hidden="true">*</span>
                </label>
                <textarea class="input" rows="3" placeholder="Why this deal was lost" [(ngModel)]="reason"></textarea>
                @if (reasonError()) {
                  <div class="hint" style="color: var(--danger);">{{ reasonError() }}</div>
                } @else {
                  <div class="hint">
                    Required. The prompt appears the moment Stage is changed to Lost — from this form or from a drag into the Lost column on the
                    Pipeline board — and the change cannot be saved without it.
                  </div>
                }
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      }
    } @else if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this opportunity</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    }
  `,
})
export class OpportunityLostComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);

  // Read once from the route snapshot — same convention as
  // opportunity.record.component.ts's own opportunityId (a fresh :id is a
  // fresh route/instance, never an in-place param change).
  private readonly opportunityId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly opportunity = signal<OpportunityRow | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly reasonError = signal<string | null>(null);
  protected reason = '';

  constructor() {
    if (!this.opportunityId) {
      this.loadError.set('No opportunity id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<OpportunityRow>(`${environment.apiBaseUrl}/opportunities/${this.opportunityId}`).subscribe({
      next: (row) => {
        this.opportunity.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this opportunity.');
        this.isLoading.set(false);
      },
    });
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected stageLabel(stage: string): string {
    return OPPORTUNITY_STAGE_OPTIONS.find((s) => s.value === stage)?.label ?? stage;
  }

  protected cancel(): void {
    this.router.navigate(['/opportunities', this.opportunityId]);
  }

  protected save(): void {
    const o = this.opportunity();
    if (!o) return;
    const trimmed = this.reason.trim();
    if (!trimmed) {
      this.reasonError.set('Reason is required.');
      return;
    }
    this.reasonError.set(null);
    this.saveError.set(null);
    this.saving.set(true);
    const body: OpportunityWriteBody = {
      title: o.title,
      customer_id: o.customer_id,
      value: o.value === null || o.value === undefined ? null : Number(o.value),
      stage: 'LOST',
      probability_pct: 0,
      expected_close_date: o.expected_close_date,
      description: o.description,
      owner_id: o.owner_id,
      lost_reason: trimmed,
    };
    this.http.put(`${environment.apiBaseUrl}/opportunities/${this.opportunityId}`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/opportunities', this.opportunityId]);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.detail ?? 'Failed to save.');
      },
    });
  }
}
