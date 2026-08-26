import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { TICKET_SATISFACTION_OPTIONS, TicketRow } from '../ticket.api';

const SCREEN = 'ticket.list';

/** §2.3 Close Ticket (form key 't.close', app-forms.js:698-704) — navHidden
 * in the prototype: it has no nav entry of its own and is reached only from
 * Ticket Detail's own "Close ticket" button or by picking Closed in the
 * status select (ticket.detail.component.ts's openClose()/onStatusSelect()).
 * Bespoke standalone route (tickets/:id/close), same reasoning as
 * ticket.reassign.component.ts's own header comment: a live "pick the
 * rating, then commit" flow that a fixed RowActionDef body can't express.
 *
 * Previously this was a bare `window.prompt()` inside ticket.detail.
 * component.ts's own changeStatus() — a native, unstyled browser dialog with
 * no Cancel-and-review step, nothing like the prototype's own form screen.
 * Replaced with this real page so Satisfaction Rating gets the same Save/
 * Cancel treatment every other write in this module gets.
 *
 * 'close' collides with PolicyStore's own ALWAYS_ALLOWED read-only-verb
 * regex (policy.store.ts) — same reasoning as ticket.detail.component.ts's
 * own canClose(), reading the resolved action set directly rather than
 * calling policy.can(SCREEN, 'close') (which would wrongly return true for
 * anyone who can merely open ticket.list, e.g. an Employee — seed.py
 * restricts 'close' to SUPER_ADMIN/MANAGER). The backend re-checks this too
 * (update_status's own `perms.can("close")`, api/v1/tickets.py) regardless.
 */
@Component({
  selector: 'app-ticket-close',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Close Ticket <span class="spec-ref">§2.3</span></h1>
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
    } @else if (!canClose()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>You don't have permission to close tickets.</b></p>
        <p class="hint"><span class="clear" role="button" (click)="cancel()">Go back</span></p>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Close Ticket</h3>
        </div>
        <div class="card-body">
          <div class="grid g-2">
            <div class="field span-2">
              <label>Satisfaction Rating</label>
              <select class="input" [(ngModel)]="satisfactionRating">
                <option [ngValue]="null">— Not recorded —</option>
                @for (opt of SATISFACTION_OPTIONS; track opt.value) {
                  <option [ngValue]="opt.value">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">
                Optional. Recorded by whoever closes the ticket, based on what the customer said — not an automated customer survey.
              </div>
            </div>
            <div class="field">
              <div class="cell-sub">Status</div>
              <div>Closed</div>
              <div class="hint">Set by this action.</div>
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
  `,
})
export class TicketCloseComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);

  protected readonly SATISFACTION_OPTIONS = TICKET_SATISFACTION_OPTIONS;

  private readonly ticketId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly ticket = signal<TicketRow | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected satisfactionRating: string | null = null;

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

  protected canClose(): boolean {
    return this.policy.screen(SCREEN)?.actions?.includes('close') ?? false;
  }

  protected save(): void {
    this.saving.set(true);
    this.saveError.set(null);
    const satisfaction_rating = this.satisfactionRating ? Number(this.satisfactionRating) : undefined;
    this.http
      .put<TicketRow>(`${environment.apiBaseUrl}/tickets/${this.ticketId}/status`, { status: 'CLOSED', satisfaction_rating })
      .subscribe({
        next: (row) => this.router.navigate(['/tickets', row.id]),
        error: (err) => {
          this.saving.set(false);
          this.saveError.set(err?.error?.detail ?? 'Could not close this ticket.');
        },
      });
  }

  protected cancel(): void {
    this.router.navigate(['/tickets', this.ticketId]);
  }
}
