import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { TICKET_CATEGORY_REF, TICKET_CUSTOMER_REF, TICKET_EMPLOYEE_REF, TICKET_PRIORITY_OPTIONS, TicketRow, TicketWriteBody } from '../ticket.api';

const SCREEN = 'ticket.list';

/** §2.2 New / Edit Ticket. Bespoke — neither generic shape fits:
 * FormScreenConfig assumes no GET-by-id endpoint exists (Ticket has a real
 * one, GET /tickets/{id} — reusing FormScreenComponent's list-scan edit mode
 * here would mean fetching the ENTIRE ticket list just to populate one edit
 * form, a real regression); RecordScreenConfig has no create mode at all
 * anywhere in this codebase. One component backs both `tickets/new` and
 * `tickets/:id/edit` (ticket.routes.ts), branching on whether an :id route
 * param is present — the same create/edit duality form-screen.component.ts
 * itself implements, just hand-rolled for Ticket's own fields instead of
 * a generic FieldConfig[] render loop.
 *
 * Both POST /tickets and PUT /tickets/{id} gate on action="create" — there is
 * no separate edit action registered for ticket.list at all (confirmed
 * against app/rbac/registry/screens.py and PUT's own
 * require_screen(SCREEN, action="create")) — so canWrite() below checks
 * 'create' in both modes, never 'edit'.
 *
 * Field grid mirrors the prototype's FORMS.ticket 3-column layout exactly
 * (app-screens.js:187-200): Customer/Category/Priority, then Subject and
 * Description each full-width, then Assigned To/Linked Project/Ticket
 * Number. Linked Project fetches its OWN customer-filtered option list
 * (GET /projects?customer_id=…) rather than reading through RefDataService's
 * shared, unfiltered cache — the prototype's own hint is explicit ("Filtered
 * to the selected customer's projects only") and the backend enforces the
 * same constraint server-side (_assert_linked_project_matches_customer,
 * api/v1/tickets.py), so a bare RefDataService.options(TICKET_PROJECT_REF)
 * would let someone pick a mismatched project and just bounce off a 422.
 * Due Date is the one field with no prototype equivalent at all — kept
 * because it is a real, already-wired TicketWriteBody field (due_date) shown
 * everywhere else in this module (List column/filter, Detail), appended
 * after the prototype's own fields rather than interleaved with them.
 */
@Component({
  selector: 'app-ticket-form',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ isEdit() ? 'Edit Ticket' : 'New Ticket' }} <span class="spec-ref">§2.2</span></h1>
        @if (isEdit() && loadedTicket(); as t) {
          <p class="page-sub">{{ t.ticket_number }}</p>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this ticket</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else if (!canWrite()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>You don't have permission to {{ isEdit() ? 'edit' : 'create' }} tickets.</b></p>
        <p class="hint"><span class="clear" role="button" (click)="cancel()">Go back</span></p>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Ticket Details</h3>
        </div>
        <div class="card-body">
          <div class="grid g-3">
            <div class="field">
              <label>Customer <span class="req">*</span></label>
              <select class="input" [ngModel]="form['customer_id']" (ngModelChange)="onCustomerChange($event)">
                <option [ngValue]="null">—</option>
                @for (opt of customerOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label>Category</label>
              <select class="input" [(ngModel)]="form['category_id']">
                <option [ngValue]="null">—</option>
                @for (opt of categoryOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">From Masters → Ticket Categories.</div>
            </div>
            <div class="field">
              <label>Priority <span class="req">*</span></label>
              <select class="input" [(ngModel)]="form['priority']">
                @for (opt of PRIORITY_OPTIONS; track opt.value) {
                  <option [ngValue]="opt.value">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">Defaults to Medium.</div>
            </div>
            <div class="field span-2">
              <label>Subject <span class="req">*</span></label>
              <input class="input" type="text" placeholder="Short summary of the issue" [(ngModel)]="form['subject']" />
              <div class="hint">5-150 characters.</div>
            </div>
            <div class="field span-2">
              <label>Description <span class="req">*</span></label>
              <textarea class="input" rows="5" [(ngModel)]="form['description']"></textarea>
            </div>
            <div class="field">
              <label>Assigned To</label>
              <select class="input" [(ngModel)]="form['assigned_to']">
                <option [ngValue]="null">Unassigned</option>
                @for (opt of employeeOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">Can be left blank and assigned later.</div>
            </div>
            <div class="field">
              <label>Linked Project</label>
              <select class="input" [(ngModel)]="form['linked_project_id']" [disabled]="!form['customer_id']">
                <option [ngValue]="null">—</option>
                @for (opt of projectOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">Filtered to the selected customer's projects only.</div>
            </div>
            <div class="field">
              <div class="cell-sub">Ticket Number</div>
              <div>{{ isEdit() ? (loadedTicket()?.ticket_number ?? EM_DASH) : 'Auto-generated on save' }}</div>
              <div class="hint">Uses the prefix from Company Profile.</div>
            </div>
            <div class="field">
              <label>Due Date</label>
              <input class="input" type="date" [(ngModel)]="form['due_date']" />
            </div>
          </div>
          <div class="rbac-note" style="margin: 14px 0 0;">
            <app-icon name="info" [size]="14" />
            <div>Ticket Number auto-generates as TKT-&lt;FY&gt;-0000 on save.</div>
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
  `,
})
export class TicketFormComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);
  private readonly refData = inject(RefDataService);

  protected readonly EM_DASH = EM_DASH;
  protected readonly PRIORITY_OPTIONS = TICKET_PRIORITY_OPTIONS;

  protected readonly isLoading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly loadedTicket = signal<TicketRow | null>(null);
  protected readonly projectOptions = signal<{ id: string; label: string }[]>([]);

  // Plain mutable object, not a signal — [(ngModel)] needs a real assignable
  // target, the same reason record-screen.component.ts's own formModel and
  // conversation-screen.component.ts's own `content` avoid a signal here.
  // Bracket notation (form['key']) throughout the template, never dot
  // notation — ng build's template checker rejects `form.key` on a
  // Record<string, unknown>.
  protected form: Record<string, unknown> = {
    customer_id: null,
    category_id: null,
    subject: '',
    priority: 'MEDIUM',
    description: '',
    assigned_to: null,
    linked_project_id: null,
    due_date: null,
  };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return; // create mode — form already seeded above
    this.isLoading.set(true);
    this.http.get<TicketRow>(`${environment.apiBaseUrl}/tickets/${id}`).subscribe({
      next: (row) => {
        this.loadedTicket.set(row);
        this.form = {
          customer_id: row.customer_id,
          category_id: row.category_id,
          subject: row.subject,
          priority: row.priority,
          description: row.description,
          assigned_to: row.assigned_to,
          linked_project_id: row.linked_project_id,
          due_date: row.due_date,
        };
        this.loadProjectOptions(row.customer_id);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this ticket.');
        this.isLoading.set(false);
      },
    });
  }

  protected isEdit(): boolean {
    return !!this.route.snapshot.paramMap.get('id');
  }

  protected canWrite(): boolean {
    return this.policy.can(SCREEN, 'create');
  }

  protected customerOptions() {
    return this.refData.options(TICKET_CUSTOMER_REF) ?? [];
  }
  protected categoryOptions() {
    return this.refData.options(TICKET_CATEGORY_REF) ?? [];
  }
  protected employeeOptions() {
    return this.refData.options(TICKET_EMPLOYEE_REF) ?? [];
  }

  /** Customer changed — Linked Project's own option list is scoped to that
   * customer's projects only (prototype hint, and server-enforced by
   * _assert_linked_project_matches_customer, api/v1/tickets.py), so any
   * previously-picked project that no longer matches must be cleared rather
   * than silently sent stale on save. */
  protected onCustomerChange(customerId: string | null): void {
    this.form['customer_id'] = customerId;
    this.form['linked_project_id'] = null;
    this.loadProjectOptions(customerId);
  }

  private loadProjectOptions(customerId: string | null): void {
    if (!customerId) {
      this.projectOptions.set([]);
      return;
    }
    const params = new HttpParams().set('customer_id', customerId);
    this.http.get<{ id: string; project_name: string }[]>(`${environment.apiBaseUrl}/projects`, { params }).subscribe({
      next: (rows) => this.projectOptions.set(rows.map((r) => ({ id: r.id, label: r.project_name }))),
      // A role that can't see Project Directory at all still sees an empty
      // picker rather than a broken form — same fallback RefDataService.
      // label() documents for the same class of gap.
      error: () => this.projectOptions.set([]),
    });
  }

  protected save(): void {
    const subject = String(this.form['subject'] ?? '').trim();
    const description = String(this.form['description'] ?? '').trim();
    const missing: string[] = [];
    if (!this.form['customer_id']) missing.push('Customer');
    if (subject.length < 5 || subject.length > 150) missing.push('Subject (5-150 characters)');
    if (!this.form['priority']) missing.push('Priority');
    if (!description) missing.push('Description');
    if (missing.length) {
      this.saveError.set(`Required: ${missing.join(', ')}.`);
      return;
    }

    const body: TicketWriteBody = {
      customer_id: this.form['customer_id'] as string,
      category_id: (this.form['category_id'] as string) || null,
      subject,
      priority: this.form['priority'] as string,
      description,
      assigned_to: (this.form['assigned_to'] as string) || null,
      due_date: (this.form['due_date'] as string) || null,
      linked_project_id: (this.form['linked_project_id'] as string) || null,
    };

    this.saving.set(true);
    this.saveError.set(null);
    const id = this.route.snapshot.paramMap.get('id');
    const req$ = id
      ? this.http.put<TicketRow>(`${environment.apiBaseUrl}/tickets/${id}`, body)
      : this.http.post<TicketRow>(`${environment.apiBaseUrl}/tickets`, body);
    req$.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.router.navigate(['/tickets', row.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(this.formatError(err));
      },
    });
  }

  protected cancel(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.router.navigate(id ? ['/tickets', id] : ['/tickets']);
  }

  private formatError(err: unknown): string {
    const detail = (err as any)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    return 'Failed to save this ticket.';
  }
}
