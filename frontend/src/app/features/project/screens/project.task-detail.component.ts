import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatDate } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { EMPLOYEE_REF, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, TaskCommentRow, TaskRow, TaskSubtaskRow, USER_REF, taskPriorityLabel } from '../project.api';

const SCREEN = 'project.board';

interface SprintOption {
  readonly id: string;
  readonly name: string;
}

/** Task Detail — a standalone bespoke route (projects/:id/tasks/:taskId,
 * plus projects/:id/tasks/new for create), reached by clicking a card on the
 * Task Board. Neither the 'conversation' nor 'checklist' shape fits: both
 * assume an independent same-URL GET+POST endpoint for their sub-resource,
 * but Task comments/subtasks only ever arrive nested inside GET /tasks/{id}
 * itself (TaskOut.subtasks/.comments) — there is no standalone GET
 * /tasks/{id}/comments. Comments/Subtasks below are modelled on customer.
 * activities.component.ts's own "fetch the parent once, append locally on
 * success, never refetch the parent" shape — POST /tasks/{id}/comments
 * returns just the one new comment, and PUT /subtasks/{id} returns just that
 * one updated subtask.
 *
 * project.board is visibility-only for everything except Delete (§0's RBAC
 * trap) — Save/Post Comment/Add Subtask/Toggle Subtask are all gated on a
 * bare canOpen(SCREEN) (PolicyStore.can(..., 'view') resolves the same way),
 * never 'edit'. Delete is the one real action, gated on 'delete'
 * (SA/Manager only), surfacing the 409 ("...other records...still reference
 * it") verbatim on failure.
 *
 * PUT /subtasks/{id} takes `is_checked` as a plain `bool` parameter with no
 * Body()/Query() annotation — FastAPI's field_annotation_is_scalar() is TRUE
 * for a bare bool (unlike the sprint task-picker's list[str] case), so this
 * is a QUERY parameter, not a JSON body; sent via HttpParams below.
 */
@Component({
  selector: 'app-project-task-detail',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          {{ isCreate() ? 'Add Task' : 'Task' }}
          <span class="spec-ref">§2.3/2.4</span>
        </h1>
        @if (!isCreate() && task(); as t) {
          <p class="page-sub">{{ t.title }}</p>
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
          <p><b>Couldn't load this task</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      <!-- app-screens2.js:1199-1202's own rec-head — icon avatar, short id,
           title, a status/priority/due/sprint meta line, and the two quick
           actions (Back to board; a Sprint shortcut only when this task
           actually belongs to one). Create mode has no record yet, so it's
           skipped entirely rather than shown half-populated. -->
      @if (!isCreate() && task(); as t) {
        <div class="rec-head">
          <div class="rec-avatar"><app-icon name="kanban" [size]="20" /></div>
          <div style="min-width: 0;">
            <div class="rec-id">{{ t.id.slice(0, 8).toUpperCase() }}</div>
            <div class="rec-name">{{ t.title }}</div>
            <div class="rec-meta">
              <span class="badge-s {{ badgeCls(t.status) }}">{{ statusLabel(t.status) }}</span>
              @if (t.priority) {
                <span class="dot"></span>
                <span class="badge-s {{ badgeCls(t.priority) }}">{{ priorityLabel(t.priority) }}</span>
              }
              <span class="dot"></span>
              <span>Due {{ t.due_date ? formatDate(t.due_date) : EM_DASH }}</span>
              <span class="dot"></span>
              <span>{{ sprintLabel() }}</span>
            </div>
          </div>
          <div class="rec-actions">
            <button class="btn" type="button" (click)="cancel()"><app-icon name="kanban" [size]="14" />Back to board</button>
            @if (t.sprint_id) {
              <button class="btn" type="button" (click)="goToSprints()"><app-icon name="play" [size]="14" />{{ sprintShortLabel() }}</button>
            }
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
              <div class="cell-sub">Assignee *</div>
              <select class="input" [(ngModel)]="form['assignee_id']" [disabled]="!canWrite()">
                <option value="">— Select —</option>
                @for (e of employeeOptions(); track e.id) {
                  <option [value]="e.id">{{ e.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Due Date</div>
              <input class="input" type="date" [(ngModel)]="form['due_date']" [disabled]="!canWrite()" />
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
              <div class="cell-sub">Priority</div>
              <select class="input" [(ngModel)]="form['priority']" [disabled]="!canWrite()">
                <option [ngValue]="null">— None —</option>
                @for (p of PRIORITY_OPTIONS; track p.value) {
                  <option [value]="p.value">{{ p.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Sprint</div>
              <!-- app-forms.js's own pr.timesheet-adjacent taskdetail field
                   (app-screens2.js:1209): ro/lock, "Set from Sprints" —
                   which sprint a task belongs to is decided from the Sprint
                   side (Update Sprint, §2.5) checking it in or out, never
                   edited here, "so the two screens can never disagree." -->
              <div class="readonly-value">{{ sprintLabel() }}</div>
              <div class="hint">Set from Sprints — Update Sprint (§2.5) checks a task in or out; this field only reflects it here.</div>
            </div>
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

        <div class="card" style="margin-top: 16px;">
          <div class="card-head"><h3>Subtasks ({{ subtasks().length }})</h3></div>
          <div class="table-wrap">
            <table>
              <tbody>
                @for (s of subtasks(); track s.id) {
                  <tr>
                    <td style="width: 28px;"><input type="checkbox" [checked]="s.is_checked" [disabled]="!canWrite()" (change)="toggleSubtask(s)" /></td>
                    <td [style.text-decoration]="s.is_checked ? 'line-through' : 'none'" [style.color]="s.is_checked ? 'var(--text-tertiary)' : null">{{ s.text }}</td>
                  </tr>
                }
                @if (!subtasks().length) {
                  <tr><td class="cell-sub">No subtasks yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (canWrite()) {
            <div class="card-foot" style="justify-content: flex-start; gap: 8px;">
              <input class="input" type="text" style="flex: 1;" placeholder="Add a subtask…" [(ngModel)]="newSubtaskText" />
              <button class="btn primary" type="button" [disabled]="addingSubtask() || !newSubtaskText.trim()" (click)="addSubtask()">Add</button>
            </div>
          }
        </div>
      }
    }
  `,
})
export class ProjectTaskDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);
  protected readonly USER_REF = USER_REF;
  protected readonly EM_DASH = EM_DASH;

  protected readonly STATUS_OPTIONS = TASK_STATUS_OPTIONS;
  protected readonly PRIORITY_OPTIONS = TASK_PRIORITY_OPTIONS;

  protected readonly isCreate = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly task = signal<TaskRow | null>(null);
  protected readonly comments = signal<readonly TaskCommentRow[]>([]);
  protected readonly subtasks = signal<readonly TaskSubtaskRow[]>([]);
  protected readonly sprintOptions = signal<readonly SprintOption[]>([]);

  protected form: Record<string, unknown> = {};
  protected newComment = '';
  protected newSubtaskText = '';
  protected readonly postingComment = signal(false);
  protected readonly addingSubtask = signal(false);

  private projectId(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  private taskId(): string | null {
    return this.route.snapshot.paramMap.get('taskId');
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
    return TASK_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
  }

  protected priorityLabel(v: string | null): string {
    return taskPriorityLabel(v);
  }

  /** ISO timestamp -> 'dd-mm-yyyy, HH:mm', matching conversation-screen.
   * component.ts's own formatWhen() verbatim (that shared component isn't
   * reused here — see this file's own class doc — so the same UTC-based
   * algorithm is repeated rather than left as a raw, unformatted timestamp
   * on every comment). */
  protected formatWhen(v: string): string {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${d.getUTCFullYear()}, ${hh}:${min}`;
  }

  /** app-screens2.js:1209's own read-only Sprint field, and the rec-meta's
   * "Not in a sprint — still in Backlog" text — this is the ONE place Sprint
   * ever renders on Task Detail now (see the template's own header comment
   * on why the old `<select>` was removed). Falls back to `form['sprint_id']`
   * so create mode (no `task()` yet) still resolves correctly, though it is
   * always null there. */
  protected sprintLabel(): string {
    const id = this.task()?.sprint_id ?? (this.form['sprint_id'] as string | null | undefined) ?? null;
    if (!id) return 'Not in a sprint';
    return this.sprintOptions().find((s) => s.id === id)?.name ?? id;
  }

  /** The rec-actions Sprint shortcut button's own short label — app-screens2
   * .js:1202's `t.sprint.replace(/ —.*$/, '')`, stripping " — <rest>" so the
   * button reads "Sprint 14", not the full "Sprint 14 — SSO & Exports". */
  protected sprintShortLabel(): string {
    return this.sprintLabel().replace(/ —.*$/, '');
  }

  protected goToSprints(): void {
    this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'sprints' } });
  }

  ngOnInit(): void {
    const projectId = this.projectId();
    const taskId = this.taskId();
    this.isCreate.set(!taskId);

    this.http.get<SprintOption[]>(`${environment.apiBaseUrl}/projects/${projectId}/sprints`).subscribe({
      next: (rows) => this.sprintOptions.set(rows ?? []),
      error: () => this.sprintOptions.set([]),
    });

    if (!taskId) {
      this.form = { title: '', description: '', assignee_id: '', due_date: null, status: 'BACKLOG', priority: null, sprint_id: null };
      this.isLoading.set(false);
      return;
    }

    this.http.get<TaskRow>(`${environment.apiBaseUrl}/tasks/${taskId}`).subscribe({
      next: (row) => {
        this.task.set(row);
        this.form = {
          title: row.title,
          description: row.description,
          assignee_id: row.assignee_id,
          due_date: row.due_date,
          status: row.status,
          priority: row.priority,
          sprint_id: row.sprint_id,
        };
        this.comments.set(row.comments ?? []);
        this.subtasks.set(row.subtasks ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this task.');
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
    if (!this.form['assignee_id']) {
      this.formError.set('Assignee is required.');
      return;
    }
    this.formError.set(null);
    this.saving.set(true);

    const body = {
      title,
      description: this.form['description'] || null,
      assignee_id: this.form['assignee_id'],
      due_date: this.form['due_date'] || null,
      status: this.form['status'] ?? 'BACKLOG',
      priority: this.form['priority'] || null,
      sprint_id: this.form['sprint_id'] || null,
    };

    const taskId = this.taskId();
    const req$ = taskId
      ? this.http.put<TaskRow>(`${environment.apiBaseUrl}/tasks/${taskId}`, body)
      : this.http.post<TaskRow>(`${environment.apiBaseUrl}/projects/${this.projectId()}/tasks`, body);

    req$.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.router.navigate(['/projects', this.projectId(), 'tasks', row.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to save this task.');
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'board' } });
  }

  protected remove(): void {
    if (!this.canDelete()) return;
    if (!window.confirm('Delete this task? This cannot be undone.')) return;
    this.formError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/tasks/${this.taskId()}`).subscribe({
      next: () => this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'board' } }),
      error: (err) => this.formError.set(err?.error?.detail ?? 'Failed to delete this task.'),
    });
  }

  protected postComment(): void {
    const content = this.newComment.trim();
    if (!content || !this.canWrite()) return;
    this.postingComment.set(true);
    this.http.post<TaskCommentRow>(`${environment.apiBaseUrl}/tasks/${this.taskId()}/comments`, { content }).subscribe({
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

  protected addSubtask(): void {
    const text = this.newSubtaskText.trim();
    if (!text || !this.canWrite()) return;
    this.addingSubtask.set(true);
    this.http.post<TaskSubtaskRow>(`${environment.apiBaseUrl}/tasks/${this.taskId()}/subtasks`, { text }).subscribe({
      next: (subtask) => {
        this.addingSubtask.set(false);
        this.newSubtaskText = '';
        this.subtasks.update((list) => [...list, subtask]);
      },
      error: (err) => {
        this.addingSubtask.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to add this subtask.');
      },
    });
  }

  protected toggleSubtask(subtask: TaskSubtaskRow): void {
    if (!this.canWrite()) return;
    const nextChecked = !subtask.is_checked;
    this.http
      .put<TaskSubtaskRow>(`${environment.apiBaseUrl}/subtasks/${subtask.id}`, {}, { params: { is_checked: String(nextChecked) } })
      .subscribe({
        next: (updated) => this.subtasks.update((list) => list.map((s) => (s.id === updated.id ? updated : s))),
        error: (err) => this.formError.set(err?.error?.detail ?? 'Failed to update this subtask.'),
      });
  }
}
