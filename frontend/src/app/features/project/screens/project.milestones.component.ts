import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { badgeClass, formatDate } from '../../../shared/screens/cell-format';
import { MILESTONE_STATUS_OPTIONS, MilestoneRow, TaskRow } from '../project.api';
import { EntityPickerComponent } from './entity-picker.component';

const SCREEN = 'project.milestones';

/** §3 Milestones tab (project.milestones) — fully bespoke rather than
 * ListScreenConfig + a separate create/edit route: Create/Edit both need a
 * live-fetched Linked Tasks multi-select (GET /projects/{id}/tasks), the
 * exact same gap FormScreenConfig's 'checkgroup' can't cover that Add/Edit
 * Project's own Team Members field has (screen.types.ts's FieldType doc) —
 * and unlike Sprints (where only the ONE picker action needed carving out),
 * here BOTH create and edit need it, so folding the whole tab into one
 * bespoke component (modelled on customer.activities.component.ts's
 * inline-toggle-form-above-a-list shape) is simpler than splitting a real
 * ListScreenConfig from a bespoke create/edit route reached from `rowRoute`.
 *
 * §0's RBAC trap: Create, Edit, AND Delete are ALL gated on the SAME single
 * 'manage' action (unlike Task/Bug's visibility-open/delete-gated split) —
 * every write path below checks policy.can(SCREEN,'manage'), never 'edit'.
 *
 * Filtering (status/target date range/search) is wired to the real server
 * params `GET /projects/{id}/milestones` already accepts (status,
 * target_date_from, target_date_to, search) — reversed from an earlier,
 * disclosed client-side-only simplification once it was clear the endpoint
 * (and its export branch) supported all four natively; every filter change
 * re-fetches, and export appends the same params so the file always matches
 * what's on screen, the same guarantee every ListScreenConfig-based export
 * already carries.
 */
@Component({
  selector: 'app-project-milestones',
  standalone: true,
  imports: [FormsModule, EntityPickerComponent],
  template: `
    @if (isLoading()) {
      <div class="card"><div class="empty"><p>Loading…</p></div></div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }

      <div class="filterbar">
        <div class="filter-row">
          <div class="searchbox">
            <input type="search" placeholder="Search milestones…" [value]="query()" (input)="setQuery($any($event.target).value)" />
          </div>
          @for (opt of MILESTONE_STATUS_OPTIONS; track opt.value) {
            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px;">
              <input type="checkbox" [checked]="isStatusChecked(opt.value)" (change)="toggleStatus(opt.value)" />
              {{ opt.label }}
            </label>
          }
          <input class="fsearch" type="date" [value]="targetFrom()" (change)="setTargetFrom($any($event.target).value)" title="Target Date From" style="max-width: 150px;" />
          <input class="fsearch" type="date" [value]="targetTo()" (change)="setTargetTo($any($event.target).value)" title="Target Date To" style="max-width: 150px;" />
        </div>
        <div class="chips">
          <span class="count">Showing {{ milestones().length }} milestone{{ milestones().length === 1 ? '' : 's' }}</span>
        </div>
      </div>

      <div class="page-head" style="margin-top: 0;">
        <div></div>
        <div class="page-actions">
          @if (canManage() && !showForm()) {
            <button class="btn primary" type="button" (click)="startAdd()">+ Add Milestone</button>
          }
          <button class="btn" type="button" [disabled]="!!exporting()" (click)="exportAs('pdf')">{{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}</button>
          <button class="btn" type="button" [disabled]="!!exporting()" (click)="exportAs('excel')">{{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}</button>
        </div>
      </div>

      @if (showForm()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>{{ editingId() ? 'Edit Milestone' : 'Add Milestone' }}</h3></div>
          <div class="card-body">
            @if (formError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
            }
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Milestone Name *</div>
                <input class="input" type="text" [(ngModel)]="form['milestone_name']" />
              </div>
              <div>
                <div class="cell-sub">Target Date *</div>
                <input class="input" type="date" [(ngModel)]="form['target_date']" />
              </div>
              <div>
                <div class="cell-sub">Status</div>
                <select class="input" [(ngModel)]="form['status']">
                  @for (s of MILESTONE_STATUS_OPTIONS; track s.value) {
                    <option [value]="s.value">{{ s.label }}</option>
                  }
                </select>
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Description</div>
                <textarea class="input" rows="2" [(ngModel)]="form['description']"></textarea>
              </div>
            </div>
            <div style="margin-top: 12px;">
              <div class="cell-sub">Linked Tasks</div>
              <app-entity-picker
                [options]="taskOptions()"
                [selectedIds]="linkedTaskIds()"
                searchPlaceholder="Search tasks…"
                emptyText="This project has no tasks yet."
                (selectionChange)="linkedTaskIds.set($event)"
              />
            </div>
            @if (editingId()) {
              <div style="margin-top: 12px;">
                <!-- app-forms.js:755's own ro/lock "Linked Task Progress" —
                     "Computed from the Linked Tasks that are Done — a rollup
                     view of real progress, not a manually entered figure."
                     Read from this milestone's own real MilestoneOut.tasks_done
                     /.tasks_total (schemas/project.py), not recomputed
                     client-side — only shown once a real record exists to
                     read it from, so it's absent on Add Milestone. -->
                <div class="cell-sub">Linked Task Progress</div>
                <div class="readonly-value">{{ editingProgress() }}</div>
              </div>
            }
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="showForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      }

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Milestone Name</th>
              <th>Target Date</th>
              <th>Status</th>
              <th>Linked Tasks</th>
              @if (canManage()) {
                <th style="text-align: right;">Actions</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (m of milestones(); track m.id) {
              <tr>
                <td class="cell-strong">{{ m.milestone_name }}</td>
                <td class="mono">{{ formatDate(m.target_date) }}</td>
                <td><span class="badge-s {{ badgeCls(m.status) }}">{{ statusLabel(m.status) }}</span></td>
                <td class="mono">{{ m.tasks_total == null ? '—' : m.tasks_done + '/' + m.tasks_total }}</td>
                @if (canManage()) {
                  <td style="text-align: right; white-space: nowrap;">
                    <button class="btn sm ghost" type="button" (click)="startEdit(m)">Edit</button>
                    <button class="btn sm ghost" type="button" (click)="remove(m)">Delete</button>
                  </td>
                }
              </tr>
            }
            @if (!milestones().length) {
              <tr>
                <td [attr.colspan]="canManage() ? 5 : 4" class="cell-sub">No milestones match.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ProjectMilestonesComponent implements OnInit {
  readonly projectId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly MILESTONE_STATUS_OPTIONS = MILESTONE_STATUS_OPTIONS;

  protected readonly isLoading = signal(true);
  protected readonly actionError = signal<string | null>(null);
  protected readonly milestones = signal<readonly MilestoneRow[]>([]);
  protected readonly taskOptions = signal<readonly { id: string; label: string }[]>([]);

  protected readonly query = signal('');
  protected readonly statusFilter = signal<readonly string[]>([]);
  protected readonly targetFrom = signal('');
  protected readonly targetTo = signal('');

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly linkedTaskIds = signal<readonly string[]>([]);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected form: Record<string, unknown> = {};

  // app-forms.js:755's own "Linked Task Progress" ro field — looks the
  // currently-edited milestone back up in the already-fetched list (same
  // "no GET-by-id, reuse the list" shape used throughout this module) rather
  // than trusting the form's own possibly-stale snapshot, so toggling tasks
  // in the picker above never appears to move this figure until Save
  // actually recomputes it server-side.
  protected readonly editingProgress = computed(() => {
    const id = this.editingId();
    if (!id) return '';
    const m = this.milestones().find((x) => x.id === id);
    if (!m || m.tasks_total == null) return 'No tasks linked';
    return `${m.tasks_done ?? 0}/${m.tasks_total} tasks done`;
  });

  protected canManage(): boolean {
    return this.policy.can(SCREEN, 'manage');
  }

  protected badgeCls(v: string): string {
    return badgeClass(v);
  }

  protected formatDate(v: string): string {
    return formatDate(v);
  }

  protected statusLabel(v: string): string {
    return MILESTONE_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
  }

  protected isStatusChecked(v: string): boolean {
    return this.statusFilter().includes(v);
  }

  protected toggleStatus(v: string): void {
    const cur = this.statusFilter();
    this.statusFilter.set(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    this.fetchMilestones();
  }

  protected setQuery(v: string): void {
    this.query.set(v);
    this.fetchMilestones();
  }

  protected setTargetFrom(v: string): void {
    this.targetFrom.set(v);
    this.fetchMilestones();
  }

  protected setTargetTo(v: string): void {
    this.targetTo.set(v);
    this.fetchMilestones();
  }

  ngOnInit(): void {
    this.fetchMilestones();
    const projectId = this.projectId();
    this.http.get<TaskRow[]>(`${environment.apiBaseUrl}/projects/${projectId}/tasks`).subscribe({
      next: (rows) => this.taskOptions.set((rows ?? []).map((t) => ({ id: t.id, label: t.title }))),
      error: () => this.taskOptions.set([]),
    });
  }

  // Shared by every filter setter above, the initial load, and Save/Delete's
  // own post-action refresh — one place building the real server params
  // GET /projects/{id}/milestones already accepts (status, target_date_from/
  // to, search), so the on-screen table and the export below (which reuses
  // this same param set) can never drift from each other.
  private filterParams(): HttpParams {
    let params = new HttpParams();
    for (const s of this.statusFilter()) params = params.append('status', s);
    if (this.targetFrom()) params = params.set('target_date_from', this.targetFrom());
    if (this.targetTo()) params = params.set('target_date_to', this.targetTo());
    if (this.query().trim()) params = params.set('search', this.query().trim());
    return params;
  }

  private fetchMilestones(): void {
    const projectId = this.projectId();
    this.isLoading.set(true);
    this.http.get<MilestoneRow[]>(`${environment.apiBaseUrl}/projects/${projectId}/milestones`, { params: this.filterParams() }).subscribe({
      next: (rows) => {
        this.milestones.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.actionError.set(err?.error?.detail ?? 'Failed to load milestones.');
        this.isLoading.set(false);
      },
    });
  }

  protected startAdd(): void {
    this.editingId.set(null);
    this.form = { milestone_name: '', target_date: null, description: '', status: 'UPCOMING' };
    this.linkedTaskIds.set([]);
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected startEdit(m: MilestoneRow): void {
    this.editingId.set(m.id);
    this.form = { milestone_name: m.milestone_name, target_date: m.target_date, description: m.description, status: m.status };
    this.linkedTaskIds.set(m.linked_task_ids ?? []);
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected save(): void {
    if (!this.canManage()) return;
    const name = String(this.form['milestone_name'] ?? '').trim();
    if (!name) {
      this.formError.set('Milestone Name is required.');
      return;
    }
    if (!this.form['target_date']) {
      this.formError.set('Target Date is required.');
      return;
    }
    this.formError.set(null);
    this.saving.set(true);

    const body = {
      milestone_name: name,
      target_date: this.form['target_date'],
      description: this.form['description'] || null,
      status: this.form['status'] ?? 'UPCOMING',
      linked_task_ids: this.linkedTaskIds(),
    };

    const id = this.editingId();
    const req$ = id
      ? this.http.put(`${environment.apiBaseUrl}/milestones/${id}`, body)
      : this.http.post(`${environment.apiBaseUrl}/projects/${this.projectId()}/milestones`, body);

    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.fetchMilestones();
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to save this milestone.');
      },
    });
  }

  protected remove(m: MilestoneRow): void {
    if (!this.canManage()) return;
    if (!window.confirm(`Delete milestone "${m.milestone_name}"?`)) return;
    this.actionError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/milestones/${m.id}`).subscribe({
      next: () => this.fetchMilestones(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to delete this milestone.'),
    });
  }

  // RBAC 14 §2.2f, same auth-and-blob mechanism as every other export in this
  // app (Bearer auth is header-only). Filters are real server params now
  // (filterParams(), shared with fetchMilestones()), so the export always
  // matches the on-screen table — no "wider than what you see" warning
  // needed, same guarantee every ListScreenConfig-based export carries.
  protected exportAs(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.actionError.set(null);
    const url = `${environment.apiBaseUrl}/projects/${this.projectId()}/milestones`;
    this.http.get(url, { params: this.filterParams().set('format', format), responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Milestones.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: async (err) => {
        this.exporting.set(null);
        const blob = err?.error;
        if (blob instanceof Blob) {
          try {
            const parsed = JSON.parse(await blob.text());
            this.actionError.set(typeof parsed?.detail === 'string' ? parsed.detail : 'That export failed.');
            return;
          } catch {
            /* not JSON — fall through */
          }
        }
        this.actionError.set('That export failed.');
      },
    });
  }
}
