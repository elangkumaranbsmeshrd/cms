import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';

const SCREEN = 'customer.directory';

// logged_by is a raw platform User id (whoever was logged in when they
// logged this activity), resolved via the cross-cutting GET /users.
const ACTIVITY_USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

interface ActivityRow {
  readonly id: string;
  readonly activity_type: string;
  readonly activity_date: string;
  readonly description: string;
  readonly related_contact_id: string | null;
  readonly logged_by: string;
}

interface ContactOption {
  readonly id: string;
  readonly name: string;
}

const TYPE_OPTIONS = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'NOTE', label: 'Note' },
];

const TYPE_ICON: Record<string, string> = { CALL: '📞', EMAIL: '✉️', MEETING: '🤝', NOTE: '📝' };

/** §2.3 Customer 360, Tab: Activities — GET/POST /customers/{id}/activities,
 * append-only (no edit/delete endpoints, "suits an audit-style interaction
 * log" per the spec's own build note). Rendered as a timeline, not a table,
 * per §2.3's own instruction — bespoke rather than the 'list' shape, which
 * has no timeline rendering mode.
 */
@Component({
  selector: 'app-customer-activities',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      <div class="card">
        <div class="card-head">
          <h3>Activities</h3>
          <div style="display: flex; gap: 8px;">
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportActivities('pdf')">
              {{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
            </button>
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportActivities('excel')">
              {{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
            </button>
            @if (canEdit() && !showForm()) {
              <button class="btn sm ghost" type="button" (click)="startAdd()">+ Add Activity</button>
            }
          </div>
        </div>
        <div class="card-body">
          @if (exportError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ exportError() }}</div>
          }
          <div class="filter-row" style="margin-bottom: 14px;">
            <select class="fselect" title="Type" [(ngModel)]="typeFilter" (ngModelChange)="load()">
              <option value="">All Types</option>
              @for (t of TYPE_OPTIONS; track t.value) {
                <option [value]="t.value">{{ t.label }}</option>
              }
            </select>
            <select class="fselect" title="Logged By" [(ngModel)]="loggedByFilter" (ngModelChange)="load()">
              <option value="">Logged By — Anyone</option>
              @for (u of loggedByOptions(); track u.id) {
                <option [value]="u.id">{{ u.label }}</option>
              }
            </select>
            <input class="fsearch" type="date" title="Date From" [(ngModel)]="dateFromFilter" (ngModelChange)="load()" style="max-width: 150px;" />
            <input class="fsearch" type="date" title="Date To" [(ngModel)]="dateToFilter" (ngModelChange)="load()" style="max-width: 150px;" />
            @if (hasActiveFilters()) {
              <span class="clear" role="button" (click)="clearFilters()">Clear all</span>
            }
          </div>
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
                  <div>
                    <div class="cell-sub">Related Contact</div>
                    <select class="input" [(ngModel)]="form['related_contact_id']">
                      <option [ngValue]="null">—</option>
                      @for (c of contacts(); track c.id) {
                        <option [value]="c.id">{{ c.name }}</option>
                      }
                    </select>
                  </div>
                  <!-- §2.3: "Logged By is auto-filled and never editable." Not
                       submitted — the server sets it from the authenticated
                       user (add_activity, api/v1/customers.py) — shown here
                       purely so whoever is filling this in can see what it
                       will say, same as the prototype's own read-only field. -->
                  <div><div class="cell-sub">Logged By</div><div class="readonly-value">{{ loggedByName() }}</div></div>
                  <div style="grid-column: span 2;"><div class="cell-sub">Description</div><textarea class="input" rows="3" [(ngModel)]="form['description']"></textarea></div>
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
export class CustomerActivitiesComponent implements OnInit {
  readonly customerId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly session = inject(SessionStore);
  protected readonly refData = inject(RefDataService);

  protected readonly TYPE_OPTIONS = TYPE_OPTIONS;
  protected readonly TYPE_ICON = TYPE_ICON;
  protected readonly USER_REF = ACTIVITY_USER_REF;

  protected readonly isLoading = signal(true);
  protected readonly activities = signal<readonly ActivityRow[]>([]);
  protected readonly contacts = signal<readonly ContactOption[]>([]);

  // §5's deferred "Activities owner filter and Activities export" — now
  // real 'server' params on GET /customers/{id}/activities (list_activities).
  protected typeFilter = '';
  protected loggedByFilter = '';
  protected dateFromFilter = '';
  protected dateToFilter = '';
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
    this.http.get<ContactOption[]>(`${environment.apiBaseUrl}/customers/${this.customerId()}/contacts`).subscribe({
      next: (rows) => this.contacts.set(rows),
      error: () => this.contacts.set([]),
    });
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected typeLabel(v: string): string {
    return TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
  }

  protected contactName(id: string | null): string | null {
    if (!id) return null;
    return this.contacts().find((c) => c.id === id)?.name ?? null;
  }

  protected loggedByName(): string {
    return this.session.user()?.fullName ?? '—';
  }

  // Row-derived, same reasoning as ticket.list.config.ts's own
  // raisedByOptions — no dedicated "who has logged activities here"
  // endpoint, so the option list is whatever logged_by values are actually
  // present on the currently-loaded page.
  protected loggedByOptions(): { id: string; label: string }[] {
    const seen = new Map<string, string>();
    for (const a of this.activities()) {
      if (!seen.has(a.logged_by)) seen.set(a.logged_by, this.refData.label(ACTIVITY_USER_REF, a.logged_by));
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }

  protected hasActiveFilters(): boolean {
    return !!(this.typeFilter || this.loggedByFilter || this.dateFromFilter || this.dateToFilter);
  }

  protected clearFilters(): void {
    this.typeFilter = this.loggedByFilter = this.dateFromFilter = this.dateToFilter = '';
    this.load();
  }

  private buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.typeFilter) params.set('activity_type', this.typeFilter);
    if (this.loggedByFilter) params.set('logged_by', this.loggedByFilter);
    if (this.dateFromFilter) params.set('date_from', this.dateFromFilter);
    if (this.dateToFilter) params.set('date_to', this.dateToFilter);
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    const qs = this.buildParams().toString();
    this.http.get<ActivityRow[]>(`${environment.apiBaseUrl}/customers/${this.customerId()}/activities${qs ? '?' + qs : ''}`).subscribe({
      next: (rows) => {
        this.activities.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected exportActivities(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.buildParams();
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/customers/${this.customerId()}/activities?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Customer Activities.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: () => {
        this.exporting.set(null);
        this.exportError.set('Failed to export.');
      },
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
    this.http.post(`${environment.apiBaseUrl}/customers/${this.customerId()}/activities`, this.form).subscribe({
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
