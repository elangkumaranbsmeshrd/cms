import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatDate, humanizeEnum, isBlank } from '../../../shared/screens/cell-format';
import { ConversationScreenComponent } from '../../../shared/screens/conversation-screen/conversation-screen.component';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { ConversationScreenConfig } from '../../../shared/screens/screen.types';
import { IconComponent } from '../../../shared/ui/icon.component';
import {
  TICKET_CATEGORY_REF,
  TICKET_CUSTOMER_REF,
  TICKET_EMPLOYEE_REF,
  TICKET_PRIORITY_OPTIONS,
  TICKET_PROJECT_REF,
  TICKET_STATUS_OPTIONS,
  TICKET_USER_REF,
  TicketAssignmentHistoryRow,
  TicketEntryRow,
  TicketRow,
} from '../ticket.api';

const SCREEN = 'ticket.list';

/** §2.3 Ticket Detail / Conversation. Bespoke — no composite shape embeds the
 * 'conversation' shape anywhere today (confirmed by reading both
 * tabbed-screen.component.ts and record-screen.component.ts: neither's
 * `@switch (…shape)` has a 'conversation' case), so this hosts
 * ConversationScreenComponent directly in its own template — the same bypass
 * technique those two components use internally for shapes they DO support
 * natively (screen.types.ts's own ConversationScreenConfig doc says as much).
 *
 * The header reproduces the prototype's own two-tier layout (app-screens.js's
 * R.conversation, 504-515) verbatim rather than the generic page-head-only
 * pattern most other bespoke screens in this module use: a plain page-head
 * (screen-level title/actions, tabbed-screen.component.ts's own convention)
 * PLUS the record's own .rec-head identity card (avatar/id/name/meta) with
 * its OWN rec-actions row — the live status select, Reassign and Close
 * ticket — because that inline status control (not a separate card) and the
 * dual Reassign placement (top actions AND rec-actions) are exactly what the
 * prototype draws for this specific screen.
 *
 * Assignment History renders as a .timeline (prototype's own choice for THIS
 * screen, app-screens.js:542-548), not the plain table Asset's own equivalent
 * tab uses (asset.assignment-history.component.ts) — that module is out of
 * this task's scope and not touched here; Ticket Detail matches its OWN
 * prototype screen, which draws a timeline, not a table.
 */
@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [IconComponent, ConversationScreenComponent],
  template: `
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
    } @else {
      @if (ticket(); as t) {
        <div class="page-head">
          <div>
            <h1 class="page-title">Ticket Detail <span class="spec-ref">§2.3</span></h1>
            <p class="page-sub">The main working screen — Public Reply vs Internal Note is an obvious, hard-to-miss control below.</p>
          </div>
          <div class="page-actions">
            @if (canEdit()) {
              <button class="btn ghost" type="button" (click)="openEdit()">
                <app-icon name="edit" [size]="14" />Edit
              </button>
            }
            @if (canReassign()) {
              <button class="btn" type="button" (click)="openReassign()">
                <app-icon name="employee" [size]="14" />Reassign
              </button>
            }
          </div>
        </div>

        <div class="rec-head">
          <div class="rec-avatar" style="background: var(--danger-bg); color: var(--danger); border-color: var(--danger-line);">
            <app-icon name="ticket" [size]="20" />
          </div>
          <div style="min-width: 0;">
            <div class="rec-id">{{ t.ticket_number }}</div>
            <div class="rec-name">{{ t.subject }}</div>
            <div class="rec-meta">
              <span class="link" role="button" (click)="openCustomer()">{{ customerLabel() }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls(t.priority) }}">{{ optionLabel(PRIORITY_OPTIONS, t.priority) }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls(t.status) }}">{{ optionLabel(STATUS_OPTIONS, t.status) }}</span>
              <span class="dot"></span>
              <span>Assigned to <b>{{ assigneeLabel() }}</b></span>
              <span class="dot"></span>
              <span class="badge-s b-info">First response {{ t.first_response_duration ?? EM_DASH }}</span>
            </div>
          </div>
          <div class="rec-actions">
            <select class="fselect" style="height: 30px;" title="Change Status" [disabled]="statusSaving()" (change)="onStatusSelect($any($event.target).value)">
              @for (opt of visibleStatusOptions(); track opt.value) {
                <option [value]="opt.value" [selected]="opt.value === t.status">{{ opt.label }}</option>
              }
            </select>
            @if (canReassign()) {
              <button class="btn" type="button" (click)="openReassign()">
                <app-icon name="employee" [size]="14" />Reassign
              </button>
            }
            @if (canClose() && t.status !== 'CLOSED') {
              <button class="btn no" type="button" (click)="openClose()">Close ticket</button>
            }
          </div>
        </div>

        @if (statusError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ statusError() }}</div>
        }

        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head">
            <h3>Ticket Details</h3>
          </div>
          <div class="card-body">
            <div class="grid g-2">
              <div class="field">
                <div class="cell-sub">Category</div>
                <div>{{ categoryLabel() }}</div>
              </div>
              <div class="field">
                <div class="cell-sub">Raised Date</div>
                <div class="mono">{{ formatDate(t.raised_date) }}</div>
              </div>
              <div class="field">
                <div class="cell-sub">Due Date</div>
                <div class="mono">{{ t.due_date ? formatDate(t.due_date) : EM_DASH }}</div>
              </div>
              <div class="field">
                <div class="cell-sub">Resolve Time</div>
                <div>{{ t.resolve_duration ?? EM_DASH }}</div>
              </div>
              @if (t.linked_project_id) {
                <div class="field">
                  <div class="cell-sub">Linked Project</div>
                  <button class="btn sm ghost" type="button" (click)="openProject()">{{ projectLabel() }}</button>
                </div>
              }
              @if (t.status === 'CLOSED') {
                <div class="field">
                  <div class="cell-sub">Satisfaction Rating</div>
                  <div>{{ t.satisfaction_rating ? t.satisfaction_rating + ' / 5' : 'Not rated' }}</div>
                </div>
              }
            </div>
            <div style="height: 14px;"></div>
            <div class="field">
              <div class="cell-sub">Description</div>
              <p style="margin: 6px 0 0; white-space: pre-wrap;">{{ t.description }}</p>
            </div>
          </div>
        </div>

        <div class="grid g-8-4">
          <app-conversation-screen [config]="conversationConfig" [embedded]="true" />
          <div>
            <div class="card" style="margin-bottom: 12px;">
              <div class="card-head">
                <h3>Assignment History</h3>
              </div>
              <div class="card-body">
                <div class="timeline">
                  @for (h of history(); track h.id) {
                    <div class="tl-item">
                      <div class="tl-dot" style="--tone: var(--accent); --tone-bg: var(--accent-subtle);">
                        <app-icon name="employee" [size]="11" />
                      </div>
                      <div class="tl-head">
                        <span class="who">{{ employeeLabel(h.new_assignee_id) }}</span>
                        <span class="when">{{ formatDate(h.changed_at) }}</span>
                      </div>
                      <div class="tl-body">
                        {{ h.previous_assignee_id ? 'Reassigned from ' + employeeLabel(h.previous_assignee_id) : 'Assigned' }} by {{ userLabel(h.changed_by)
                        }}{{ h.note ? ' — "' + h.note + '"' : '' }}
                      </div>
                    </div>
                  }
                  @if (!history().length) {
                    <p class="cell-sub" style="margin: 0;">No reassignments yet — this ticket has kept its original assignee.</p>
                  }
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-head">
                <h3>Linked</h3>
              </div>
              <div class="card-body">
                <div class="qlinks">
                  <div class="qlink" role="button" (click)="openCustomer()">
                    <app-icon name="customer" [size]="14" />Customer 360
                  </div>
                  @if (t.linked_project_id) {
                    <div class="qlink" role="button" (click)="openProject()">
                      <app-icon name="project" [size]="14" />{{ projectLabel() }}
                    </div>
                  }
                  <div class="qlink" role="button" (click)="goToList()">
                    <app-icon name="ticket" [size]="14" />All tickets
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class TicketDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected readonly EM_DASH = EM_DASH;
  protected readonly PRIORITY_OPTIONS = TICKET_PRIORITY_OPTIONS;
  protected readonly STATUS_OPTIONS = TICKET_STATUS_OPTIONS;

  private readonly ticketId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly ticket = signal<TicketRow | null>(null);
  protected readonly history = signal<readonly TicketAssignmentHistoryRow[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly statusSaving = signal(false);
  protected readonly statusError = signal<string | null>(null);

  protected readonly conversationConfig: ConversationScreenConfig<TicketEntryRow> = {
    shape: 'conversation',
    id: SCREEN,
    title: 'Conversation',
    endpoint: `/tickets/${this.ticketId}/entries`,
    rowId: (r) => r.id,
    bodyKey: 'content',
    timestampKey: 'created_at',
    authorKey: 'author_id',
    authorRef: TICKET_USER_REF,
    authorIsSelf: (r) => r.author_id === this.session.user()?.id,
    entryTypeKey: 'entry_type',
    entryTypes: [
      { value: 'PUBLIC_REPLY', label: 'Public Reply', icon: 'send' },
      { value: 'INTERNAL_NOTE', label: 'Internal Note', icon: 'lock', internal: true },
    ],
    attachmentKey: 'attachment_stored_file_id',
    attachmentUploadPurpose: 'ticket_attachment',
    threadTitle: 'Conversation',
    recordNoun: 'entry',
    // POST /tickets/{id}/entries has no action= gate at all
    // (require_screen(SCREEN) with no action kwarg) — 'view' matches
    // PolicyStore's ALWAYS_ALLOWED regex and correctly mirrors canOpen(),
    // unlike this type's own 'edit' default: there is no 'edit' action on
    // ticket.list at all, so 'edit' would hide the composer from every role
    // including Super Admin.
    screenAction: 'view',
  };

  constructor() {
    if (!this.ticketId) {
      this.loadError.set('No ticket id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.load();
    this.http.get<TicketAssignmentHistoryRow[]>(`${environment.apiBaseUrl}/tickets/${this.ticketId}/assignment-history`).subscribe({
      next: (rows) => this.history.set(rows ?? []),
      error: () => this.history.set([]),
    });
  }

  private load(): void {
    this.isLoading.set(true);
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

  protected formatDate(v: string): string {
    return formatDate(v);
  }

  protected optionLabel(options: readonly { value: string; label: string }[], value: string): string {
    return options.find((o) => o.value === value)?.label ?? humanizeEnum(value);
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  protected customerLabel(): string {
    const t = this.ticket();
    if (!t) return EM_DASH;
    const label = this.refData.label(TICKET_CUSTOMER_REF, t.customer_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected categoryLabel(): string {
    const t = this.ticket();
    if (!t?.category_id) return EM_DASH;
    const label = this.refData.label(TICKET_CATEGORY_REF, t.category_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected assigneeLabel(): string {
    const t = this.ticket();
    if (!t?.assigned_to) return 'Unassigned';
    const label = this.refData.label(TICKET_EMPLOYEE_REF, t.assigned_to);
    return isBlank(label) ? EM_DASH : label;
  }

  protected employeeLabel(id: string): string {
    const label = this.refData.label(TICKET_EMPLOYEE_REF, id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected userLabel(id: string): string {
    const label = this.refData.label(TICKET_USER_REF, id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected canEdit(): boolean {
    // Edit reuses the 'create' action — there is no separate edit action on
    // ticket.list at all (app/rbac/registry/screens.py; PUT /tickets/{id}'s
    // own require_screen(SCREEN, action="create")).
    return this.policy.can(SCREEN, 'create');
  }

  protected canReassign(): boolean {
    return this.policy.can(SCREEN, 'reassign');
  }

  /** 'close' collides with PolicyStore's own ALWAYS_ALLOWED read-only-verb
   * regex (policy.store.ts) — `.can(SCREEN, 'close')` would return true for
   * anyone who can merely open this screen, including an Employee, regardless
   * of the real per-role grant (seed.py restricts 'close' to SUPER_ADMIN/
   * MANAGER). Reading the resolved action set directly is the only correct
   * client-side check; the backend still 403s correctly either way
   * (update_status checks `perms.can("close")` manually in the function
   * body, api/v1/tickets.py).
   */
  protected canClose(): boolean {
    return this.policy.screen(SCREEN)?.actions?.includes('close') ?? false;
  }

  protected visibleStatusOptions(): readonly { value: string; label: string }[] {
    return this.canClose() ? TICKET_STATUS_OPTIONS : TICKET_STATUS_OPTIONS.filter((o) => o.value !== 'CLOSED');
  }

  /** rec-actions' own status <select> (app-screens.js:512's fselect — "the
   * first Public Reply on an Open ticket moves it to In Progress
   * automatically", "Status changed" toast). CLOSED is never committed
   * straight from this control: app-screens.js's own 'ticket.close' screen
   * doc says "Moving Status to Closed opens an optional Satisfaction Rating
   * prompt" — so picking Closed here hands off to that dedicated screen
   * (openClose()) exactly like clicking the "Close ticket" button does,
   * rather than PUTting blind with no rating captured. */
  protected onStatusSelect(newStatus: string): void {
    const t = this.ticket();
    if (!t || !newStatus || newStatus === t.status || this.statusSaving()) return;
    if (newStatus === 'CLOSED') {
      this.openClose();
      return;
    }
    this.statusSaving.set(true);
    this.statusError.set(null);
    this.http.put<TicketRow>(`${environment.apiBaseUrl}/tickets/${this.ticketId}/status`, { status: newStatus }).subscribe({
      next: (row) => {
        this.ticket.set(row);
        this.statusSaving.set(false);
      },
      error: (err) => {
        this.statusSaving.set(false);
        this.statusError.set(err?.error?.detail ?? 'Could not update the status.');
      },
    });
  }

  protected projectLabel(): string {
    const t = this.ticket();
    if (!t?.linked_project_id) return EM_DASH;
    const label = this.refData.label(TICKET_PROJECT_REF, t.linked_project_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected openEdit(): void {
    this.router.navigate(['/tickets', this.ticketId, 'edit']);
  }

  protected openReassign(): void {
    this.router.navigate(['/tickets', this.ticketId, 'reassign']);
  }

  /** §2.3 t.close — navHidden in the prototype (reachable only from this
   * screen's own "Close ticket" button / status select, never a nav item).
   * See ticket.close.component.ts's own header comment for why this is a
   * real route rather than a modal/prompt. */
  protected openClose(): void {
    this.router.navigate(['/tickets', this.ticketId, 'close']);
  }

  protected openCustomer(): void {
    const t = this.ticket();
    if (t) this.router.navigate(['/customers', t.customer_id]);
  }

  protected openProject(): void {
    const t = this.ticket();
    if (t?.linked_project_id) this.router.navigate(['/projects', t.linked_project_id]);
  }

  protected goToList(): void {
    this.router.navigate(['/tickets']);
  }
}
