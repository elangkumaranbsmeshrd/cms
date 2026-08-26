import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { ListScreenComponent } from '../../../shared/screens/list-screen/list-screen.component';
import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { SPRINT_STATUS_OPTIONS, SprintRow, TaskRow } from '../project.api';

const SCREEN = 'project.sprints';

// data.js:1250's own Tasks column — "a live count of tasks actually linked
// to that sprint." GET /projects/{id}/sprints (SprintOut, schemas/project.py
// :168-175) carries no such count itself, so `taskCount` is a plain closure
// over a sprint_id -> count map the host component builds from the SAME
// real GET /projects/{id}/tasks every Task Board/Sprint-Tasks screen already
// uses (Task.sprint_id) — a client-side rollup over real data, not a
// fabricated field.
function buildSprintsListConfig(projectId: string, taskCount: (sprintId: string) => number): ListScreenConfig<SprintRow> {
  return {
    shape: 'list',
    id: 'project.sprints',
    title: 'Sprints',
    recordNoun: 'sprint',
    endpoint: `/projects/${projectId}/sprints`,
    exportable: true,
    rowId: (row) => row.id,
    // "Update Sprint" (assigning tasks) can't fit RowActionDef/
    // SecondaryActionDef — both fire-and-go, no prompt step, and this
    // genuinely needs a task-multiselect first — so it's the row's own
    // rowRoute, opening the bespoke picker page rather than a fake "view"
    // page with no other purpose.
    rowRoute: (row) => ['/projects', projectId, 'sprints', row.id, 'tasks'],
    searchParam: 'search',
    searchFields: ['name'],
    includeInactiveParam: false,
    filters: [
      { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: SPRINT_STATUS_OPTIONS },
      { key: 'start_date', label: 'Start Date', kind: 'daterange', transport: 'server' },
      { key: 'end_date', label: 'End Date', kind: 'daterange', transport: 'server' },
    ],
    // Column order/shape mirrors data.js:1250 verbatim (Sprint Name / Start
    // Date / End Date / Status / Tasks, the last right-aligned + mono).
    columns: [
      { key: 'name', header: 'Name', cellClass: 'cell-strong' },
      { key: 'start_date', header: 'Start Date', type: 'date' },
      { key: 'end_date', header: 'End Date', type: 'date' },
      { key: 'status', header: 'Status', type: 'status', staticOptions: SPRINT_STATUS_OPTIONS },
      { key: 'task_count', header: 'Tasks', type: 'number', cellClass: 'mono', compute: (row) => taskCount(row.id) },
    ],
    rowActions: [
      {
        label: 'Complete Sprint',
        endpoint: (row) => `/sprints/${row.id}/complete`,
        screenAction: 'manage',
        visible: (row) => row.status === 'ACTIVE',
        confirm: 'Complete this sprint? Any task still not Done returns to the Backlog.',
      },
    ],
    defaultPageSize: 25,
    emptyText: 'No sprints started yet.',
  };
}

/** §3 Sprints tab (project.sprints) — a thin bespoke wrapper around the real
 * `<app-list-screen>` embed, which supplies filters/export/chips for free.
 * Only "Start Sprint" sits outside that generic shape: ListScreenConfig.
 * createRoute only NAVIGATES somewhere, and Start Sprint's 3 fields (Name/
 * Start/End) don't need a whole separate route + component just for that —
 * an inline toggle-form above the list instead (CustomerActivitiesComponent's
 * own pattern). "Update Sprint" (see buildSprintsListConfig's own rowRoute
 * comment) and "Complete Sprint" (a plain RowActionDef, no body-building
 * needed) both stay on the real embedded list.
 */
@Component({
  selector: 'app-project-sprints',
  standalone: true,
  imports: [FormsModule, ListScreenComponent],
  template: `
    <div class="card" style="margin-bottom: 16px;">
      <div class="card-head">
        <h3>Sprints</h3>
        @if (canManage() && !showForm()) {
          <button class="btn sm ghost" type="button" (click)="startAdd()">+ Start Sprint</button>
        }
      </div>
      @if (showForm()) {
        <div class="card-body">
          @if (formError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
          }
          <div class="grid g-2">
            <div>
              <div class="cell-sub">Sprint Name *</div>
              <input class="input" type="text" [(ngModel)]="form['name']" />
            </div>
            <div></div>
            <div>
              <div class="cell-sub">Start Date *</div>
              <input class="input" type="date" [(ngModel)]="form['start_date']" />
            </div>
            <div>
              <div class="cell-sub">End Date *</div>
              <input class="input" type="date" [(ngModel)]="form['end_date']" />
            </div>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="saving()" (click)="showForm.set(false)">Cancel</button>
          <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Starting…' : 'Start Sprint' }}</button>
        </div>
      }
    </div>
    <app-list-screen [config]="listConfig()" [embedded]="true" />
  `,
})
export class ProjectSprintsComponent {
  readonly projectId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  // data.js:1250's own "Tasks" column — a live count of tasks actually
  // linked to that sprint, rolled up client-side from Task.sprint_id over
  // the SAME real GET /projects/{id}/tasks the Task Board and "Update
  // Sprint" picker already fetch (no such count exists on SprintOut itself).
  // `taskCount` is a stable bound closure read lazily by the `task_count`
  // column's own `compute` (buildSprintsListConfig, below) — a signal read
  // from inside ListScreenComponent's own template still registers THAT
  // component's view as a dependency (Angular tracks the reading context,
  // not the signal's owner), so counts arriving after the list already
  // rendered still land in the right cells without forcing a fresh
  // `listConfig` identity or disturbing the embedded list's own filter/page
  // state.
  private readonly taskSprintCounts = signal<Record<string, number>>({});
  protected readonly taskCount = (sprintId: string): number => this.taskSprintCounts()[sprintId] ?? 0;

  // Bumped after a successful "Start Sprint" to force listConfig() to return
  // a fresh object identity, the signal ListScreenComponent's own internal
  // effect() keys a refetch off of — Start Sprint fires outside the embedded
  // list entirely, so nothing else would ever tell it to reload.
  private readonly reloadTick = signal(0);

  protected readonly listConfig = computed<ListScreenConfig<SprintRow>>(() => {
    this.reloadTick();
    return buildSprintsListConfig(this.projectId(), this.taskCount);
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      this.http.get<readonly TaskRow[]>(`${environment.apiBaseUrl}/projects/${id}/tasks`).subscribe({
        next: (rows) => {
          const counts: Record<string, number> = {};
          for (const t of rows ?? []) {
            if (!t.sprint_id) continue;
            counts[t.sprint_id] = (counts[t.sprint_id] ?? 0) + 1;
          }
          this.taskSprintCounts.set(counts);
        },
        // No count rather than a broken tab — matches project.record.
        // component.ts's own fetchCount() error handling exactly.
        error: () => this.taskSprintCounts.set({}),
      });
    });
  }

  protected canManage(): boolean {
    return this.policy.can(SCREEN, 'manage');
  }

  protected startAdd(): void {
    this.form = { name: '', start_date: null, end_date: null };
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected save(): void {
    const name = String(this.form['name'] ?? '').trim();
    if (!name) {
      this.formError.set('Sprint Name is required.');
      return;
    }
    const start = this.form['start_date'];
    const end = this.form['end_date'];
    if (!start || !end) {
      this.formError.set('Start Date and End Date are both required.');
      return;
    }
    if (String(end) < String(start)) {
      this.formError.set('End Date cannot be before Start Date.');
      return;
    }
    this.formError.set(null);
    this.saving.set(true);
    this.http.post(`${environment.apiBaseUrl}/projects/${this.projectId()}/sprints`, { name, start_date: start, end_date: end }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.reloadTick.update((n) => n + 1);
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to start this sprint.');
      },
    });
  }
}
