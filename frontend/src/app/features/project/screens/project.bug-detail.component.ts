import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatDate } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { BUG_SEVERITY_OPTIONS, BUG_STATUS_OPTIONS, BugCommentRow, BugRow, EMPLOYEE_REF, USER_REF, bugSeverityLabel } from '../project.api';

const SCREEN = 'project.board';

/** Bug Detail — the same pattern as Task Detail (see that file's own class
 * doc for the full reasoning on why this is a standalone bespoke route
 * rather than 'conversation'/'checklist'), minus Subtasks (Bug has none) and
 * with Severity (required) replacing Priority, Assignee genuinely nullable
 * (unlike Task's required one), and a read-only Reported By line — a raw
 * platform User id, resolved to a name via USER_REF (GET /users).
 */
@Component({
  selector: 'app-project-bug-detail',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          {{ isCreate() ? 'Report Bug' : 'Bug' }}
          <span class="spec-ref">§2.6</span>
        </h1>
        @if (!isCreate() && bug(); as b) {
          <p class="page-sub">{{ b.title }}</p>
        }
      </div>
      <div class="page-actions">
        @if (!isCreate() && canDelete()) {
          <button class="btn" type="button" (click)="remove()">Delete</button>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="card"><div class="empty"><p>Loading…</p></div></div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this bug</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      <!-- Bugs get the same rec-head treatment Task Detail does (project.
           task-detail.component.ts's own header comment), using the 'alert'
           icon instead of 'kanban' — "a separate tracker from Tasks, kept
           visually distinct" (data.js:1254's own proj.bugs desc) carries
           through from the board card's badge onto this record too. -->
      @if (!isCreate() && bug(); as b) {
        <div class="rec-head">
          <div class="rec-avatar" style="background: var(--danger-bg); color: var(--danger); border-color: var(--danger-line);">
            <app-icon name="alert" [size]="20" />
          </div>
          <div style="min-width: 0;">
            <div class="rec-id">{{ b.id.slice(0, 8).toUpperCase() }}</div>
            <div class="rec-name">{{ b.title }}</div>
            <div class="rec-meta">
              <span class="badge-s {{ badgeCls(b.status) }}">{{ statusLabel(b.status) }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls(b.severity) }}">{{ severityLabel(b.severity) }}</span>
              <span class="dot"></span>
              <span>Due {{ b.due_date ? formatDate(b.due_date) : EM_DASH }}</span>
              <span class="dot"></span>
              <span>Reported by {{ refData.label(USER_REF, b.reported_by) }}</span>
            </div>
          </div>
          <div class="rec-actions">
            <button class="btn" type="button" (click)="cancel()"><app-icon name="alert" [size]="14" />Back to bugs</button>
          </div>
        </div>
      }
      @if (formError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
      }
      <div class="card">
        <div class="card-head"><h3>Details</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div style="grid-column: span 2;">
              <div class="cell-sub">Title *</div>
              <input class="input" type="text" [(ngModel)]="form['title']" [disabled]="!canWrite()" />
            </div>
            <div>
              <div class="cell-sub">Severity *</div>
              <select class="input" [(ngModel)]="form['severity']" [disabled]="!canWrite()">
                @for (s of SEVERITY_OPTIONS; track s.value) {
                  <option [value]="s.value">{{ s.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Status</div>
              <select class="input" [(ngModel)]="form['status']" [disabled]="!canWrite()">
                @for (s of STATUS_OPTIONS; track s.value) {
                  <option [value]="s.value">{{ s.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Assignee</div>
              <select class="input" [(ngModel)]="form['assignee_id']" [disabled]="!canWrite()">
                <option [ngValue]="null">— Unassigned —</option>
                @for (e of employeeOptions(); track e.id) {
                  <option [value]="e.id">{{ e.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Due Date</div>
              <input class="input" type="date" [(ngModel)]="form['due_date']" [disabled]="!canWrite()" />
            </div>
            @if (!isCreate() && bug(); as b) {
              <div>
                <div class="cell-sub">Reported By</div>
                <div class="input" style="background: var(--bg-subtle); color: var(--text-tertiary);">{{ refData.label(USER_REF, b.reported_by) }}</div>
              </div>
            }
            <div style="grid-column: span 2;">
              <div class="cell-sub">Description</div>
              <textarea class="input" rows="3" [(ngModel)]="form['description']" [disabled]="!canWrite()"></textarea>
            </div>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
          @if (canWrite()) {
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
          }
        </div>
      </div>

      @if (!isCreate()) {
        <div class="card" style="margin-top: 16px;">
          <div class="card-head"><h3>Comments ({{ comments().length }})</h3></div>
          <div class="card-body">
            @if (!comments().length) {
              <p class="hint" style="margin: 0;">No comments yet.</p>
            }
            @for (c of comments(); track c.id) {
              <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div class="cell-sub mono">{{ refData.label(USER_REF, c.author_id) }} · {{ formatWhen(c.created_at) }}</div>
                <div>{{ c.content }}</div>
              </div>
            }
          </div>
          @if (canWrite()) {
            <div class="card-foot" style="justify-content: flex-start; gap: 8px;">
              <textarea class="input" rows="2" style="flex: 1;" placeholder="Add a comment…" [(ngModel)]="newComment"></textarea>
              <button class="btn primary" type="button" [disabled]="postingComment() || !newComment.trim()" (click)="postComment()">Post</button>
            </div>
          }
        </div>
      }
    }
  `,
})
export class ProjectBugDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);
  protected readonly USER_REF = USER_REF;
  protected readonly EM_DASH = EM_DASH;

  protected readonly STATUS_OPTIONS = BUG_STATUS_OPTIONS;
  protected readonly SEVERITY_OPTIONS = BUG_SEVERITY_OPTIONS;

  protected readonly isCreate = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly bug = signal<BugRow | null>(null);
  protected readonly comments = signal<readonly BugCommentRow[]>([]);

  protected form: Record<string, unknown> = {};
  protected newComment = '';
  protected readonly postingComment = signal(false);

  private projectId(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  private bugId(): string | null {
    return this.route.snapshot.paramMap.get('bugId');
  }

  protected canWrite(): boolean {
    return this.policy.canOpen(SCREEN);
  }

  protected canDelete(): boolean {
    return this.policy.can(SCREEN, 'delete');
  }

  protected employeeOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(EMPLOYEE_REF) ?? [];
  }

  protected formatDate(v: string): string {
    return formatDate(v);
  }

  protected badgeCls(v: string): string {
    return badgeClass(v);
  }

  protected statusLabel(v: string): string {
    return BUG_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
  }

  protected severityLabel(v: string): string {
    return bugSeverityLabel(v);
  }

  /** ISO timestamp -> 'dd-mm-yyyy, HH:mm' — see project.task-detail.
   * component.ts's own formatWhen() doc for why this repeats conversation-
   * screen.component.ts's algorithm rather than reusing it directly. */
  protected formatWhen(v: string): string {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${d.getUTCFullYear()}, ${hh}:${min}`;
  }

  ngOnInit(): void {
    const bugId = this.bugId();
    this.isCreate.set(!bugId);

    if (!bugId) {
      this.form = { title: '', description: '', severity: 'LOW', status: 'OPEN', assignee_id: null, due_date: null };
      this.isLoading.set(false);
      return;
    }

    this.http.get<BugRow>(`${environment.apiBaseUrl}/bugs/${bugId}`).subscribe({
      next: (row) => {
        this.bug.set(row);
        this.form = {
          title: row.title,
          description: row.description,
          severity: row.severity,
          status: row.status,
          assignee_id: row.assignee_id,
          due_date: row.due_date,
        };
        this.comments.set(row.comments ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this bug.');
        this.isLoading.set(false);
      },
    });
  }

  protected save(): void {
    if (!this.canWrite()) return;
    const title = String(this.form['title'] ?? '').trim();
    if (!title) {
      this.formError.set('Title is required.');
      return;
    }
    if (!this.form['severity']) {
      this.formError.set('Severity is required.');
      return;
    }
    this.formError.set(null);
    this.saving.set(true);

    const body = {
      title,
      description: this.form['description'] || null,
      severity: this.form['severity'],
      status: this.form['status'] ?? 'OPEN',
      assignee_id: this.form['assignee_id'] || null,
      due_date: this.form['due_date'] || null,
    };

    const bugId = this.bugId();
    const req$ = bugId
      ? this.http.put<BugRow>(`${environment.apiBaseUrl}/bugs/${bugId}`, body)
      : this.http.post<BugRow>(`${environment.apiBaseUrl}/projects/${this.projectId()}/bugs`, body);

    req$.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.router.navigate(['/projects', this.projectId(), 'bugs', row.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to save this bug.');
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'bugs' } });
  }

  protected remove(): void {
    if (!this.canDelete()) return;
    if (!window.confirm('Delete this bug? This cannot be undone.')) return;
    this.formError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/bugs/${this.bugId()}`).subscribe({
      next: () => this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'bugs' } }),
      error: (err) => this.formError.set(err?.error?.detail ?? 'Failed to delete this bug.'),
    });
  }

  protected postComment(): void {
    const content = this.newComment.trim();
    if (!content || !this.canWrite()) return;
    this.postingComment.set(true);
    this.http.post<BugCommentRow>(`${environment.apiBaseUrl}/bugs/${this.bugId()}/comments`, { content }).subscribe({
      next: (comment) => {
        this.postingComment.set(false);
        this.newComment = '';
        this.comments.update((list) => [...list, comment]);
      },
      error: (err) => {
        this.postingComment.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to post this comment.');
      },
    });
  }
}
