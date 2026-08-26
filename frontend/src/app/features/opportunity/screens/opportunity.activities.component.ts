import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import {
  OPPORTUNITY_ACTIVITY_TYPE_ICON,
  OPPORTUNITY_ACTIVITY_TYPE_OPTIONS,
  OPPORTUNITY_USER_REF,
  OpportunityActivityRow,
  OpportunityContactOption,
} from '../opportunity.api';

const SCREEN = 'opportunity.pipeline';

/** Opportunity Record, Tab: Activities — GET/POST /opportunities/{id}/
 * activities, append-only (no edit/delete endpoints), rendered as a
 * timeline. Modeled directly on customer.activities.component.ts (the
 * established precedent for exactly this "audit-style interaction log off a
 * sub-resource" shape) — same structure, same window.prompt-free inline-form
 * pattern, same bracket-notation ngModel binding on the plain
 * Record<string, unknown> form object (`form['key']`, never `form.key` —
 * required for [(ngModel)] on this shape, per this module's own bespoke-
 * component rules).
 *
 * Related Contact is sourced from GET /customers/{customerId}/contacts using
 * the PARENT Opportunity's own customer_id, passed in as a second @Input
 * alongside the opportunity id (this endpoint has no dedicated RefLookup —
 * it varies per parent record, which RefLookup's fixed-endpoint-string shape
 * can't express).
 *
 * logged_by (OpportunityActivityRow) is a raw platform User id, resolved via
 * OPPORTUNITY_USER_REF (GET /users) and shown alongside the activity date —
 * same treatment customer.activities.component.ts now gives its own logged_by.
 *
 * Bespoke-component rule: this takes input.required<string>(), so both
 * fetches happen in ngOnInit(), never the constructor.
 */
@Component({
  selector: 'app-opportunity-activities',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      <div class="card">
        <div class="card-head">
          <h3>Activities</h3>
          @if (canEdit() && !showForm()) {
            <button class="btn sm ghost" type="button" (click)="startAdd()">+ Add Activity</button>
          }
        </div>
        <div class="card-body">
          @if (showForm()) {
            <div class="card" style="margin-bottom: 14px;">
              <div class="card-body">
                @if (formError()) {
                  <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
                }
                <div class="grid g-2" style="margin-bottom: 12px;">
                  <div>
                    <div class="cell-sub">Type</div>
                    <select class="input" [(ngModel)]="form['activity_type']">
                      @for (t of TYPE_OPTIONS; track t.value) {
                        <option [value]="t.value">{{ t.label }}</option>
                      }
                    </select>
                  </div>
                  <div><div class="cell-sub">Date</div><input class="input" type="date" [(ngModel)]="form['activity_date']" /></div>
                  <div style="grid-column: span 2;"><div class="cell-sub">Description</div><textarea class="input" rows="3" [(ngModel)]="form['description']"></textarea></div>
                  <div>
                    <div class="cell-sub">Related Contact</div>
                    <select class="input" [(ngModel)]="form['related_contact_id']">
                      <option [value]="null">—</option>
                      @for (c of contacts(); track c.id) {
                        <option [value]="c.id">{{ c.name }}</option>
                      }
                    </select>
                  </div>
                </div>
              </div>
              <div class="card-foot">
                <button class="btn ghost" type="button" [disabled]="saving()" (click)="showForm.set(false)">Cancel</button>
                <button class="btn primary" type="button" [disabled]="saving()" (click)="saveActivity()">
                  {{ saving() ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </div>
          }

          @if (!activities().length) {
            <p class="hint" style="margin: 0;">No activities logged yet.</p>
          } @else {
            <div class="timeline">
              @for (a of activities(); track a.id) {
                <div style="display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line);">
                  <div style="font-size: 18px;">{{ TYPE_ICON[a.activity_type] ?? '•' }}</div>
                  <div style="flex: 1;">
                    <div>
                      <span class="badge-s b-info">{{ typeLabel(a.activity_type) }}</span>
                      <span class="cell-sub mono" style="margin-left: 8px;">{{ a.activity_date }}</span>
                      @if (contactName(a.related_contact_id); as cn) {
                        <span class="cell-sub" style="margin-left: 8px;">· {{ cn }}</span>
                      }
                      <span class="cell-sub" style="margin-left: 8px;">· Logged by {{ refData.label(USER_REF, a.logged_by) }}</span>
                    </div>
                    <div style="margin-top: 4px;">{{ a.description }}</div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class OpportunityActivitiesComponent implements OnInit {
  readonly opportunityId = input.required<string>();
  readonly customerId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly TYPE_OPTIONS = OPPORTUNITY_ACTIVITY_TYPE_OPTIONS;
  protected readonly TYPE_ICON = OPPORTUNITY_ACTIVITY_TYPE_ICON;
  protected readonly USER_REF = OPPORTUNITY_USER_REF;

  protected readonly isLoading = signal(true);
  protected readonly activities = signal<readonly OpportunityActivityRow[]>([]);
  protected readonly contacts = signal<readonly OpportunityContactOption[]>([]);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
    this.http.get<OpportunityContactOption[]>(`${environment.apiBaseUrl}/customers/${this.customerId()}/contacts`).subscribe({
      next: (rows) => this.contacts.set(rows ?? []),
      error: () => this.contacts.set([]),
    });
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected typeLabel(v: string): string {
    return this.TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
  }

  protected contactName(id: string | null): string | null {
    if (!id) return null;
    return this.contacts().find((c) => c.id === id)?.name ?? null;
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<OpportunityActivityRow[]>(`${environment.apiBaseUrl}/opportunities/${this.opportunityId()}/activities`).subscribe({
      next: (rows) => {
        this.activities.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startAdd(): void {
    this.form = { activity_type: 'CALL', activity_date: new Date().toISOString().slice(0, 10), description: '', related_contact_id: null };
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected saveActivity(): void {
    if (!this.form['description']) {
      this.formError.set('Description is required.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    this.http.post(`${environment.apiBaseUrl}/opportunities/${this.opportunityId()}/activities`, this.form).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to save.');
      },
    });
  }
}
