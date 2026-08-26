import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { SessionStore } from '../../../core/auth/session.store';
import { IconComponent } from '../../ui/icon.component';
import { EM_DASH, humanizeEnum, isBlank } from '../cell-format';
import { RefDataService } from '../ref-data.service';
import { ConversationScreenConfig } from '../screen.types';
import { RoleButtonDirective } from '../../ui/role-button.directive';

/** The prototype's R.conversation (app-screens.js:504-555) — a threaded
 * message list with a compose/reply box underneath. Ticket detail's
 * Conversation tab is the real consumer.
 *
 * Deliberately scoped to JUST the thread (app-screens.js:516-538) — the
 * prototype's own rec-head/status-select/Assignment-History-timeline/Linked
 * qlinks around it (app-screens.js:507-515, 542-553) are page composition
 * for a specific ticket-detail screen, not something this reusable shape
 * owns. Per screen.types.ts's own note on RecordScreenConfig.tabs ("each
 * tab is itself one of the shapes → tabs compose, they don't special-case"),
 * a future ticket.detail TabbedScreenConfig supplies its own
 * RecordHeaderDef for the identity card and can add a separate card/tab for
 * Assignment History — stuffing them into THIS config would make every
 * other future consumer of 'conversation' (a Task's comment thread, a Bug's
 * comment thread — projects.py's TaskComment/BugComment share the exact
 * same author_id-on-a-bare-row shape, models/project.py:75/107) carry
 * ticket-only baggage it has no use for.
 */
@Component({
  selector: 'app-conversation-screen',
  standalone: true,
  imports: [IconComponent, FormsModule, RoleButtonDirective],
  template: `
    <!-- embedded = hosted as a tab body inside a TabbedScreenConfig record
         screen (e.g. Ticket Detail), which already renders the page title
         and the record's own identity card — same suppression convention as
         ListScreenComponent's 'embedded' input. -->
    <div class="page-head" [class.embedded]="embedded()">
      @if (!embedded()) {
        <div>
          <h1 class="page-title">
            {{ config().title }}
            @if (config().specRef) {
              <span class="spec-ref">{{ config().specRef }}</span>
            }
            @if (policy.isReadOnly(config().id)) {
              <span class="badge-s b-warn" title="You have view-only access to this screen — no changes can be made here.">Read-only</span>
            }
          </h1>
          @if (config().description) {
            <p class="page-sub">{{ config().description }}</p>
          }
        </div>
      }
    </div>

    <div class="card">
      <div class="card-head">
        <h3>{{ threadTitle() }}</h3>
        <span class="sub">{{ countLabel() }}</span>
      </div>
      <div class="card-body">
        @if (loading()) {
          <div class="empty">
            <p>Loading…</p>
          </div>
        } @else if (loadError()) {
          <div class="empty">
            <div class="ico">⚠</div>
            <p><b>Couldn't load this conversation</b></p>
            <p class="hint">{{ loadError() }}</p>
          </div>
        } @else if (rows().length === 0) {
          <div class="empty">
            <p>{{ config().emptyText ?? 'No messages yet.' }}</p>
          </div>
        } @else {
          @for (row of rows(); track config().rowId(row)) {
            <div class="msg" [class.internal]="isInternal(row)">
              <div class="msg-av">{{ initialsFor(row) }}</div>
              <div class="msg-body">
                <div class="msg-head">
                  <b>{{ authorName(row) }}</b>
                  @if (config().entryTypeKey) {
                    <span class="badge-s {{ isInternal(row) ? 'b-warn' : 'b-info' }}">{{ typeLabel(row) }}</span>
                  }
                  <span class="when">{{ formatWhen(row) }}</span>
                </div>
                <div class="msg-text">{{ bodyText(row) }}</div>
                @if (attachmentId(row); as fid) {
                  <div style="margin-top: 6px;">
                    <button class="btn sm ghost" type="button" (click)="openAttachment(row)">
                      <app-icon name="doc" [size]="12" />Attachment
                    </button>
                  </div>
                }
              </div>
            </div>
          }
        }

        @if (canReply()) {
          <div style="height: 14px;"></div>
          <div class="composer">
            @if (entryTypeOptions().length > 1) {
              <div class="composer-head">
                <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary); margin: 0;">
                  Entry Type <span class="req">*</span>
                </label>
                <div class="seg">
                  @for (t of entryTypeOptions(); track t.value) {
                    <button type="button" [class.on]="selectedType === t.value" [class.warn]="!!t.internal" (click)="selectedType = t.value">
                      @if (t.icon) {
                        <app-icon [name]="t.icon" [size]="12" />
                      }
                      {{ t.label }}
                    </button>
                  }
                </div>
              </div>
            }
            <div class="composer-body">
              <div class="field" style="margin-bottom: 0;">
                <label>Content <span class="req">*</span></label>
                <textarea
                  class="input"
                  [placeholder]="config().composerPlaceholder ?? 'Write your reply…'"
                  style="min-height: 74px;"
                  [(ngModel)]="content"
                ></textarea>
              </div>
            </div>
            @if (sendError()) {
              <div class="form-error" style="margin: 0 10px 10px;">{{ sendError() }}</div>
            }
            <div class="composer-foot">
              @if (config().attachmentKey) {
                <span style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">Attachment</span>
                @if (pendingAttachment(); as att) {
                  <span class="chip">
                    {{ att.filename }}
                    <span class="rm" role="button" [attr.aria-label]="'Remove attachment ' + att.filename" (click)="removeAttachment()">×</span>
                  </span>
                } @else {
                  <button class="btn sm" type="button" [disabled]="uploading()" (click)="fileInput.click()">
                    <app-icon name="upload" [size]="13" />{{ uploading() ? 'Uploading…' : 'Attach' }}
                  </button>
                  <input
                    #fileInput
                    type="file"
                    style="display: none;"
                    accept="application/pdf,image/jpeg,image/png"
                    (change)="onFileSelected($event)"
                  />
                }
              }
              <button class="btn primary" style="margin-left: auto;" type="button" [disabled]="!canSend()" (click)="send()">
                <app-icon name="send" [size]="13" />{{ sending() ? 'Sending…' : 'Send' }}
              </button>
            </div>
          </div>
        } @else if (policy.isReadOnly(config().id)) {
          <div class="rbac-note" style="margin-top: 14px;">
            <app-icon name="info" [size]="14" />
            <div>You have view-only access to this screen — replying is not available.</div>
          </div>
        }
      </div>
    </div>
  `,
})
export class ConversationScreenComponent<T = any> {
  readonly config = input.required<ConversationScreenConfig<T>>();
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly refData = inject(RefDataService);
  private readonly session = inject(SessionStore);
  protected readonly policy = inject(PolicyStore);

  protected readonly rows = signal<readonly T[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly pendingAttachment = signal<{ id: string; filename: string } | null>(null);

  // Plain fields, not signals — [(ngModel)] needs a settable property, the
  // exact same shape form-screen.component.ts's `formModel` uses for the
  // same reason (template checker aside, ngModel writes through the setter
  // path, not signal.set()).
  protected content = '';
  protected selectedType = '';

  constructor() {
    // Re-fetches the whole thread whenever the config changes — e.g. the
    // tab is re-entered for a different ticket. Mirrors TabbedScreenComponent's
    // own effect() reset-then-refetch pattern (tabbed-screen.component.ts:131-159).
    effect(() => {
      const cfg = this.config();
      this.rows.set([]);
      this.loading.set(true);
      this.loadError.set(null);
      this.sendError.set(null);
      this.content = '';
      this.pendingAttachment.set(null);
      this.selectedType = cfg.entryTypes?.find((t) => !t.internal)?.value ?? cfg.entryTypes?.[0]?.value ?? '';

      this.http.get<T[]>(`${environment.apiBaseUrl}${cfg.endpoint}`).subscribe({
        next: (rows) => {
          this.rows.set(Array.isArray(rows) ? rows : []);
          this.loading.set(false);
        },
        error: (err) => {
          this.loadError.set(err?.error?.detail ?? 'Could not load this conversation.');
          this.loading.set(false);
        },
      });
    });
  }

  // ---- reading a row -----------------------------------------------------

  /** The real schema (schemas/ticket.py:84-92, and equally TaskComment/
   * BugComment — models/project.py:75/107) never denormalizes a name onto
   * the row: `author_id` is a bare User id. `authorRef` reuses the exact
   * same RefDataService lookup ColumnDef.ref/FieldConfig.ref already rely
   * on for this. `authorIsSelf` is a shortcut for the row the current user
   * JUST posted via `send()` below — their own name is already known
   * client-side without waiting on (or being subject to a miss in) the
   * lookup cache. */
  protected authorName(row: T): string {
    const cfg = this.config();
    if (cfg.authorIsSelf?.(row)) {
      return this.session.user()?.fullName ?? 'You';
    }
    const raw = (row as Record<string, unknown>)[cfg.authorKey];
    if (cfg.authorRef) {
      const label = this.refData.label(cfg.authorRef, raw as string | null | undefined);
      return isBlank(label) ? EM_DASH : label;
    }
    return isBlank(raw) ? EM_DASH : String(raw);
  }

  /** Mirrors the prototype's initials() (app-core.js:74) — up to two words'
   * first letters, uppercased. */
  protected initialsFor(row: T): string {
    const parts = this.authorName(row).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((w) => w.charAt(0).toUpperCase()).join('') || '?';
  }

  protected bodyText(row: T): string {
    const raw = (row as Record<string, unknown>)[this.config().bodyKey];
    return isBlank(raw) ? '' : String(raw);
  }

  /** ISO timestamp (what every backend datetime field sends, e.g.
   * TicketEntryOut.created_at) -> 'dd-mm-yyyy, HH:mm'. Distinct from
   * cell-format's formatDate(), which only handles a bare 'yyyy-mm-dd' date
   * with no time component — a message thread needs the time too. Reads
   * the UTC fields (not local-timezone getters), matching how the rest of
   * this codebase already treats backend datetimes as UTC wall-clock values
   * (date-presets.ts:24's getUTCFullYear()/getUTCMonth()/getUTCDate()). */
  protected formatWhen(row: T): string {
    const raw = (row as Record<string, unknown>)[this.config().timestampKey];
    const str = String(raw ?? '').trim();
    if (!str) return EM_DASH;
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return str;
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${d.getUTCFullYear()}, ${hh}:${min}`;
  }

  /** Internal Note vs Public Reply tint — deliberately NOT run through
   * cell-format's generic badgeClass() (its BADGE_CLASS map has no
   * 'internal note'/'public reply' entries at all): this is a fixed
   * two-value distinction the prototype hardcodes to warn/info
   * (app-screens.js:519), not a Masters status enum a screen defines its
   * own vocabulary for. */
  protected isInternal(row: T): boolean {
    const cfg = this.config();
    if (!cfg.entryTypeKey) return false;
    const raw = String((row as Record<string, unknown>)[cfg.entryTypeKey] ?? '');
    return cfg.entryTypes?.find((t) => t.value === raw)?.internal ?? false;
  }

  protected typeLabel(row: T): string {
    const cfg = this.config();
    if (!cfg.entryTypeKey) return '';
    const raw = String((row as Record<string, unknown>)[cfg.entryTypeKey] ?? '');
    return cfg.entryTypes?.find((t) => t.value === raw)?.label ?? humanizeEnum(raw);
  }

  protected attachmentId(row: T): string | null {
    const key = this.config().attachmentKey;
    if (!key) return null;
    const raw = (row as Record<string, unknown>)[key];
    return isBlank(raw) ? null : String(raw);
  }

  // Auth is Bearer-header-only (auth.interceptor.ts) — a plain <a href> to
  // /files/{id} would hit the API unauthenticated, same reasoning as
  // ListScreenComponent.exportAs() (list-screen.component.ts:566-568).
  protected openAttachment(row: T): void {
    const fid = this.attachmentId(row);
    if (!fid) return;
    this.http.get(`${environment.apiBaseUrl}/files/${fid}`, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        const blob = res.body;
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        // Left un-revoked deliberately: the new tab needs the object URL to
        // stay alive to actually display/download it.
        window.open(url, '_blank', 'noopener');
      },
      error: () => this.sendError.set('Could not open that attachment.'),
    });
  }

  // ---- composer -----------------------------------------------------------

  /** Defaults to 'edit' — the same convention RecordScreenConfig.edit and
   * every list screen's createScreenAction use for "is this role allowed to
   * write here at all", so a role with view-only access to the host screen
   * sees the thread but not the reply box, without a second RBAC concept. */
  protected canReply(): boolean {
    return this.policy.can(this.config().id, this.config().screenAction ?? 'edit');
  }

  protected entryTypeOptions(): readonly { value: string; label: string; icon?: string; internal?: boolean }[] {
    return this.config().entryTypes ?? [];
  }

  protected canSend(): boolean {
    return !this.sending() && this.content.trim().length > 0;
  }

  protected threadTitle(): string {
    return this.config().threadTitle ?? 'Conversation';
  }

  /** "N entries" / "N comments" — same singular/plural convention as
   * ListScreenComponent.recordNounPlural() (list-screen.component.ts:437-442),
   * reused rather than reinvented for the same English-pluralization gap. */
  protected countLabel(): string {
    const n = this.rows().length;
    const noun = this.config().recordNoun ?? 'entry';
    return `${n} ${n === 1 ? noun : this.pluralize(noun)}`;
  }

  private pluralize(noun: string): string {
    if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
    if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
    return `${noun}s`;
  }

  protected send(): void {
    if (!this.canSend()) return;
    const cfg = this.config();
    this.sending.set(true);
    this.sendError.set(null);
    const body: Record<string, unknown> = { [cfg.bodyKey]: this.content.trim() };
    if (cfg.entryTypeKey) body[cfg.entryTypeKey] = this.selectedType;
    if (cfg.attachmentKey) body[cfg.attachmentKey] = this.pendingAttachment()?.id ?? null;

    this.http.post<T>(`${environment.apiBaseUrl}${cfg.endpoint}`, body).subscribe({
      next: (row) => {
        this.rows.update((r) => [...r, row]);
        this.content = '';
        this.pendingAttachment.set(null);
        this.sending.set(false);
      },
      error: (err) => {
        this.sending.set(false);
        this.sendError.set(err?.error?.detail ?? 'That message could not be sent.');
      },
    });
  }

  // Uploads immediately on selection (POST /files, files.py:76-97) rather
  // than deferring to `send()` time — the file is validated (mime/size/magic
  // bytes) and given a real stored_file_id right away, so a bad file is
  // rejected before the person has typed their reply, not after.
  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // lets the same file be re-picked after a remove
    if (!file) return;
    const cfg = this.config();
    this.uploading.set(true);
    this.sendError.set(null);
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', cfg.attachmentUploadPurpose ?? 'generic');
    this.http.post<{ id: string; original_filename: string }>(`${environment.apiBaseUrl}/files`, form).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.pendingAttachment.set({ id: res.id, filename: res.original_filename });
      },
      error: (err) => {
        this.uploading.set(false);
        this.sendError.set(err?.error?.detail ?? 'That file could not be uploaded.');
      },
    });
  }

  protected removeAttachment(): void {
    this.pendingAttachment.set(null);
  }
}
