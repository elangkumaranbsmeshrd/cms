import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { TICKET_EMPLOYEE_REF, TicketRow } from '../ticket.api';

const SCREEN = 'ticket.list';

/** §2.4 Assign / Reassign Ticket. Bespoke standalone route
 * (tickets/:id/reassign) rather than a List row action — RowActionDef only
 * ever fires a fixed, precomputed body (screen.types.ts's own
 * RowActionDef.body: (row) => unknown), which cannot express a live "pick the
 * new assignee" control. Reached from Ticket Detail's own Reassign button
 * (ticket.detail.component.ts's openReassign()); there is no way to reach it
 * directly from a List row given the same RowActionDef limitation — see this
 * module's build report for that confirmed, structural gap.
 */
@Component({
  selector: 'app-ticket-reassign',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Reassign Ticket <span class="spec-ref">§2.4</span></h1>
        @if (ticket(); as t) {
          <p class="page-sub">{{ t.ticket_number }} — {{ t.subject }}</p>
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
    } @else if (!canReassign()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>You don't have permission to reassign tickets.</b></p>
        <p class="hint"><span class="clear" role="button" (click)="cancel()">Go back</span></p>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Reassign {{ ticket()?.ticket_number }}</h3>
        </div>
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <div class="cell-sub">Current Assignee</div>
              <div>{{ currentAssigneeLabel() }}</div>
            </div>
            <div class="field">
              <label>New Assignee <span class="req">*</span></label>
              <select class="input" [(ngModel)]="newAssigneeId">
                <option [ngValue]="null">—</option>
                @for (opt of employeeOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div class="field span-2">
              <label>Note</label>
              <textarea class="input" rows="3" placeholder="e.g. Reassigning — I'm on leave next week" [(ngModel)]="note"></textarea>
            </div>
          </div>
          <div class="rbac-note" style="margin: 14px 0 0;">
            <app-icon name="info" [size]="14" />
            <div>On save an Assignment History entry is recorded — Previous Assignee, New Assignee, Changed By, Date, Note.</div>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
          <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Reassigning…' : 'Reassign' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class TicketReassignComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);
  private readonly refData = inject(RefDataService);

  private readonly ticketId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly ticket = signal<TicketRow | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected newAssigneeId: string | null = null;
  protected note = '';

  constructor() {
    if (!this.ticketId) {
      this.loadError.set('No ticket id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<TicketRow>(`${environment.apiBaseUrl}/tickets/${this.ticketId}`).subscribe({
      next: (row) => {
        this.ticket.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this ticket.');
        this.isLoading.set(false);
      },
    });
  }

  protected canReassign(): boolean {
    return this.policy.can(SCREEN, 'reassign');
  }

  protected employeeOptions() {
    return this.refData.options(TICKET_EMPLOYEE_REF) ?? [];
  }

  protected currentAssigneeLabel(): string {
    const id = this.ticket()?.assigned_to;
    return id ? this.refData.label(TICKET_EMPLOYEE_REF, id) : 'Unassigned';
  }

  protected save(): void {
    if (!this.newAssigneeId) {
      this.saveError.set('Required: New Assignee.');
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    this.http
      .post<TicketRow>(`${environment.apiBaseUrl}/tickets/${this.ticketId}/reassign`, {
        new_assignee_id: this.newAssigneeId,
        note: this.note.trim() || null,
      })
      .subscribe({
        next: (row) => this.router.navigate(['/tickets', row.id]),
        error: (err) => {
          this.saving.set(false);
          // 422 "Ticket is already assigned to this person" (api/v1/tickets.py's
          // reassign_ticket) surfaces here verbatim, same as every other
          // server-validated form in this codebase.
          this.saveError.set(err?.error?.detail ?? 'Could not reassign this ticket.');
        },
      });
  }

  protected cancel(): void {
    this.router.navigate(['/tickets', this.ticketId]);
  }
}
