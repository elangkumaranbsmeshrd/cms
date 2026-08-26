import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatDate } from '../../../shared/screens/cell-format';
import { SprintRow, TaskRow } from '../project.api';
import { EntityPickerComponent } from './entity-picker.component';

const SCREEN = 'project.sprints';

/** "Update Sprint" (§2.5) — a standalone bespoke route (projects/:id/sprints/
 * :sprintId/tasks), reached by clicking a sprint row on the Sprints tab. Not
 * embeddable as a plain RowActionDef (screen.types.ts's own type has no
 * prompt/picker step, only fire-and-go) and not a tab of its own (it's a
 * per-sprint action, not a per-project sub-resource).
 *
 * There is no GET /sprints/{id} endpoint at all — only the LIST
 * (GET /projects/{id}/sprints) exists — so this reads the sprint's own
 * name/dates/status by fetching that list and finding this one row, the same
 * accepted "no GET-by-id" workaround FormScreenConfig itself uses elsewhere
 * in this codebase.
 *
 * CRITICAL (verified directly against the installed FastAPI 0.141.1's own
 * parameter-inference source, fastapi/dependencies/utils.py:
 * analyze_param — a bare `task_ids: list[str]` parameter with no Query()/
 * Body() annotation is classified via field_annotation_is_scalar(), which is
 * False for any list[...] type, so FastAPI treats it as an implicit Body —
 * and since it is the ONLY body field on this endpoint, FastAPI does not
 * embed it under a "task_ids" key): PUT /sprints/{id}/tasks takes the request
 * body as a BARE JSON ARRAY of task-id strings, `["id1","id2"]`, not
 * `{"task_ids":[...]}`. http.put(url, taskIds) below sends exactly that.
 */
@Component({
  selector: 'app-project-sprint-tasks',
  standalone: true,
  imports: [EntityPickerComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Update Sprint<span class="spec-ref">§2.5</span></h1>
        <p class="page-sub">Choose which of this project's tasks belong to this sprint. Saving replaces the sprint's full task membership.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="card"><div class="empty"><p>Loading…</p></div></div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this sprint</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      @if (sprint(); as s) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-body">
            <div class="rec-meta" style="margin: 0;">
              <span class="cell-strong">{{ s.name }}</span>
              <span class="dot"></span>
              <span>{{ formatDate(s.start_date) }} → {{ formatDate(s.end_date) }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls(s.status) }}">{{ s.status }}</span>
            </div>
          </div>
        </div>

        @if (s.status !== 'ACTIVE') {
          <div class="rbac-note">Only an Active sprint's tasks can be updated — this sprint is {{ s.status }}.</div>
        }
        @if (actionError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
        }

        <div class="card">
          <div class="card-head"><h3>Tasks</h3></div>
          <div class="card-body">
            <app-entity-picker
              [options]="taskOptions()"
              [selectedIds]="selectedTaskIds()"
              searchPlaceholder="Search tasks…"
              emptyText="This project has no tasks yet."
              (selectionChange)="selectedTaskIds.set($event)"
            />
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            @if (canManage()) {
              <button class="btn primary" type="button" [disabled]="saving() || s.status !== 'ACTIVE'" (click)="save()">
                {{ saving() ? 'Saving…' : 'Save' }}
              </button>
            }
          </div>
        </div>
      }
    }
  `,
})
export class ProjectSprintTasksComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly sprint = signal<SprintRow | null>(null);
  protected readonly taskOptions = signal<readonly { id: string; label: string }[]>([]);
  protected readonly selectedTaskIds = signal<readonly string[]>([]);

  private projectId(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  private sprintId(): string {
    return this.route.snapshot.paramMap.get('sprintId') ?? '';
  }

  protected canManage(): boolean {
    return this.policy.can(SCREEN, 'manage');
  }

  protected badgeCls(v: string): string {
    return v.toLowerCase();
  }

  protected formatDate(v: string): string {
    return formatDate(v);
  }

  ngOnInit(): void {
    const projectId = this.projectId();
    const sprintId = this.sprintId();
    this.isLoading.set(true);
    this.loadError.set(null);

    forkJoin({
      sprints: this.http.get<SprintRow[]>(`${environment.apiBaseUrl}/projects/${projectId}/sprints`),
      tasks: this.http.get<TaskRow[]>(`${environment.apiBaseUrl}/projects/${projectId}/tasks`),
    }).subscribe({
      next: ({ sprints, tasks }) => {
        const found = (sprints ?? []).find((s) => s.id === sprintId) ?? null;
        if (!found) {
          this.loadError.set('This sprint could not be found.');
          this.isLoading.set(false);
          return;
        }
        this.sprint.set(found);
        this.taskOptions.set((tasks ?? []).map((t) => ({ id: t.id, label: t.title })));
        this.selectedTaskIds.set((tasks ?? []).filter((t) => t.sprint_id === sprintId).map((t) => t.id));
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this sprint.');
        this.isLoading.set(false);
      },
    });
  }

  protected save(): void {
    if (!this.canManage()) return;
    this.saving.set(true);
    this.actionError.set(null);
    // Bare JSON array body — see this file's own header comment.
    this.http.put<SprintRow>(`${environment.apiBaseUrl}/sprints/${this.sprintId()}/tasks`, this.selectedTaskIds()).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'sprints' } });
      },
      error: (err) => {
        this.saving.set(false);
        this.actionError.set(err?.error?.detail ?? 'Failed to update this sprint\'s tasks.');
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/projects', this.projectId()], { queryParams: { tab: 'sprints' } });
  }
}
