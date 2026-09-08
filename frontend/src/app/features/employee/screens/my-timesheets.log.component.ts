import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';

/**
 * §2.8's "log hours" form — the half of My Timesheet that was never built.
 *
 * GET /timesheets/me shipped, so the screen could always SHOW hours; POST
 * /timesheets shipped too, and nothing ever called it. my-timesheets.list.
 * config.ts said so in its own comment ("Logging a new entry (POST /timesheets)
 * is deliberately not wired here — a real create form given the scope of
 * everything else in this pass"), which makes this a deferral rather than a
 * design decision. The effect was a self-service screen an employee could read
 * and never write to: the only way to get a row onto it was for someone to
 * insert one directly.
 *
 * WHY A SEPARATE ROUTE RATHER THAN A CARD ON THE TAB
 * My Leave puts its Apply card inline, but that screen is a bespoke component
 * that owns its own rendering. My Timesheet is a ListScreenConfig mounted as a
 * tab, and TabDef has no component-tab kind — so an inline card would mean
 * either converting the whole tab to a bespoke component (losing the filters,
 * export and row actions ListScreenConfig gives it for free) or adding a new
 * tab kind to shared/. Routing to a create screen is what the list already
 * supports through createRoute, and it is the shape every other create in this
 * app uses.
 *
 * WHAT THE SPEC ASKS FOR THAT IS NOT OBVIOUS
 *   - Task and the five non-task categories are ONE dropdown, not two controls.
 *     §2.8 (2026-07-30 addition) is explicit about why: "hours don't always
 *     belong to a task, and the form shouldn't force one… if the only way to
 *     log time is against a task, that time either goes unrecorded or gets
 *     awkwardly padded onto whatever task is open, and either way the day's
 *     hours are no longer honest." The API stores one or the other, so the
 *     control's value carries which kind it is.
 *   - Hours above 12 is a SOFT warning. §2.8: "the 24 cap is a hard
 *     server-side rule… the soft warning above 12 is a frontend plausibility
 *     nudge, not enforced by the API." So it warns and still submits.
 *   - Save as Draft is off by default — an entry logs straight to Submitted
 *     unless explicitly held back.
 *   - Project is not in §2.8's field table because that table describes an
 *     entry within a project's own context. My Timesheet spans every project
 *     the person is on, so the project has to be picked here; POST /timesheets
 *     takes it as a required query param.
 */

interface MyProjectRow {
  readonly id: string;
  readonly project_code: string;
  readonly project_name: string;
}

interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

/** §2.8's five non-task categories, "built exactly as listed". Values match
 * TimesheetEntryWrite's own validator (backend/app/schemas/project.py). */
const CATEGORY_OPTIONS = [
  { value: 'BENCH', label: 'Bench / Free Time' },
  { value: 'INTERNAL_MEETING', label: 'Internal Meeting' },
  { value: 'TRAINING', label: 'Training / Learning' },
  { value: 'ADMIN_OVERHEAD', label: 'Admin & Overhead' },
  { value: 'OTHER', label: 'Other' },
];

@Component({
  selector: 'app-my-timesheets-log',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Log Hours <span class="spec-ref">§2.8</span></h1>
        <p class="page-sub">Record time against a task, or against non-task work.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        @if (error()) {
          <div class="form-error" style="margin: 0 0 14px;" role="alert">{{ error() }}</div>
        }

        @if (loadingProjects()) {
          <p class="hint">Loading your projects…</p>
        } @else if (!projects().length) {
          <!-- Not an error state. Logging requires being a project's Lead or
               Member — the endpoint re-checks it and 422s — so someone staffed
               on nothing has nothing to log against, and saying that plainly
               beats an empty dropdown that silently refuses on submit. -->
          <div class="empty">
            <p><b>You're not on any project yet.</b></p>
            <p class="hint">
              Hours are logged against a project you're a Lead or Member of. Once you're staffed on one, it
              will appear here.
            </p>
          </div>
        } @else {
          <div class="grid g-2" style="margin-bottom: 12px;">
            <div>
              <div class="cell-sub">Person</div>
              <div class="cell-strong">{{ session.user()?.fullName }}</div>
              <div class="hint">Locked to you</div>
            </div>

            <div>
              <div class="cell-sub">Project</div>
              <select
                class="input"
                aria-label="Project"
                aria-required="true"
                [ngModel]="projectId()"
                (ngModelChange)="onProjectChange($event)"
              >
                <option [value]="''">—</option>
                @for (p of projects(); track p.id) {
                  <option [value]="p.id">{{ p.project_code }} — {{ p.project_name }}</option>
                }
              </select>
            </div>

            <div>
              <div class="cell-sub">Date</div>
              <input
                class="input"
                type="date"
                aria-label="Date"
                aria-required="true"
                [max]="today"
                [(ngModel)]="entryDate"
              />
              <div class="hint">Cannot be in the future.</div>
            </div>

            <div>
              <div class="cell-sub">Task</div>
              <!-- One control, two kinds of value. The prefix says which the
                   API should receive: a task id, or one of the five non-task
                   categories. -->
              <select class="input" aria-label="Task" aria-required="true" [(ngModel)]="workItem">
                <option [value]="''">—</option>
                @if (loadingTasks()) {
                  <option [value]="''" disabled>Loading tasks…</option>
                }
                @if (tasks().length) {
                  <optgroup label="Tasks on this project">
                    @for (t of tasks(); track t.id) {
                      <option [value]="'task:' + t.id">{{ t.title }}</option>
                    }
                  </optgroup>
                }
                <optgroup label="Non-task time">
                  @for (c of categories; track c.value) {
                    <option [value]="'cat:' + c.value">{{ c.label }}</option>
                  }
                </optgroup>
              </select>
              @if (projectId() && !loadingTasks() && !tasks().length) {
                <div class="hint">This project has no tasks yet — you can still log non-task time against it.</div>
              }
            </div>

            <div>
              <div class="cell-sub">Hours</div>
              <input
                class="input"
                type="number"
                step="0.25"
                min="0"
                max="24"
                aria-label="Hours"
                aria-required="true"
                [(ngModel)]="hours"
              />
              @if (hoursWarning()) {
                <!-- §2.8 calls this a "plausibility nudge, not enforced by the
                     API" — so it warns and does not block. -->
                <div class="hint" style="color: var(--warning);">{{ hoursWarning() }}</div>
              }
            </div>

            <div class="span-2">
              <div class="cell-sub">Notes</div>
              <textarea class="input" rows="3" aria-label="Notes" [(ngModel)]="notes"></textarea>
            </div>

            <div>
              <div class="cell-sub">Save as Draft</div>
              <!-- .toggle is inline-flex with no size of its own — the .track
                   child is what carries the width and height, so omitting it
                   renders a zero-sized element that is invisible to a user and
                   reports hidden to assistive tech. Same markup as My Leave's
                   own Half-Day switch. Space is preventDefault'd so toggling
                   does not also scroll the page. -->
              <span
                class="toggle"
                role="switch"
                tabindex="0"
                aria-label="Save as Draft"
                [attr.aria-checked]="saveAsDraft()"
                [class.on]="saveAsDraft()"
                (click)="saveAsDraft.set(!saveAsDraft())"
                (keydown.enter)="saveAsDraft.set(!saveAsDraft())"
                (keydown.space)="$event.preventDefault(); saveAsDraft.set(!saveAsDraft())"
              >
                <span class="track"></span>
              </span>
              <div class="hint">
                {{
                  saveAsDraft()
                    ? 'Kept as your own working copy — you can edit or discard it until you submit.'
                    : 'Submits for approval straight away. Only Approved hours count toward payroll.'
                }}
              </div>
            </div>
          </div>

          <div class="formbar">
            <div class="formbar-note">Only Approved hours count toward payroll's hour-basis input.</div>
            <div class="formbar-actions">
              <button class="btn" type="button" (click)="cancel()">Cancel</button>
              <button class="btn primary" type="button" [disabled]="saving()" (click)="submit()">
                {{ saving() ? 'Saving…' : saveAsDraft() ? 'Save Draft' : 'Submit' }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class MyTimesheetsLogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  protected readonly categories = CATEGORY_OPTIONS;

  /** LOCAL today, not UTC. toISOString() converts to UTC first, so anywhere
   * east of Greenwich the early-morning hours still report yesterday's date —
   * caught here in IST (UTC+5:30), where a first probe logged 2026-09-08 on
   * 2026-09-09. That is not a cosmetic default: `today` is also the input's
   * `max`, so it would have refused the one date the user most wants at 2am,
   * their own current day. The server compares against ITS today, so the two
   * can still disagree across a timezone gap — that case gets a clean 422 the
   * form surfaces, rather than a silently wrong date. */
  protected readonly today = ((d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(
    new Date(),
  );

  protected readonly projects = signal<MyProjectRow[]>([]);
  protected readonly tasks = signal<TaskRow[]>([]);
  protected readonly loadingProjects = signal(true);
  protected readonly loadingTasks = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly projectId = signal('');
  protected readonly saveAsDraft = signal(false);

  protected entryDate = this.today;
  protected workItem = '';
  protected hours: number | null = null;
  protected notes = '';

  /** §2.8's soft nudge. Deliberately not a computed() over `hours`: `hours` is
   * an ngModel-bound property, not a signal, so a computed would capture no
   * dependency and never recompute. Zone-based change detection re-evaluates a
   * method call each cycle, which is what tracks the field. */
  protected hoursWarning(): string | null {
    const h = Number(this.hours);
    if (!Number.isFinite(h) || h <= 12) return null;
    if (h > 24) return 'More than 24 hours cannot be logged on one entry.';
    return `${h} hours in a single day is unusual — double-check before submitting.`;
  }

  ngOnInit(): void {
    this.http.get<MyProjectRow[]>(`${environment.apiBaseUrl}/employees/me/projects`).subscribe({
      next: (rows) => {
        this.projects.set(rows ?? []);
        this.loadingProjects.set(false);
        // One project is the common case for most people — preselecting it
        // saves a click and makes the task list load immediately.
        if (rows?.length === 1) this.onProjectChange(rows[0].id);
      },
      error: () => {
        this.loadingProjects.set(false);
        this.error.set('Could not load your projects. Please try again.');
      },
    });
  }

  protected onProjectChange(projectId: string): void {
    this.projectId.set(projectId);
    // The task list belongs to the chosen project, so a stale selection from
    // the previous one would submit a task that fails the server's
    // "task does not belong to this project" check.
    this.workItem = '';
    this.tasks.set([]);
    if (!projectId) return;

    this.loadingTasks.set(true);
    this.http.get<TaskRow[]>(`${environment.apiBaseUrl}/projects/${projectId}/tasks`).subscribe({
      next: (rows) => {
        this.tasks.set(rows ?? []);
        this.loadingTasks.set(false);
      },
      error: () => {
        // Not fatal: the five non-task categories are still selectable, so the
        // form stays usable for exactly the case §2.8 added them for.
        this.loadingTasks.set(false);
      },
    });
  }

  protected submit(): void {
    if (this.saving()) return;

    if (!this.projectId() || !this.entryDate || !this.workItem || this.hours === null || this.hours === undefined) {
      this.error.set('Project, Date, Task and Hours are all required.');
      return;
    }
    const h = Number(this.hours);
    if (!Number.isFinite(h) || h <= 0 || h > 24) {
      // Mirrors TimesheetEntryWrite's own validator so the common mistake gets
      // an immediate answer instead of a round trip.
      this.error.set('Hours must be more than 0 and no more than 24.');
      return;
    }
    if (this.entryDate > this.today) {
      this.error.set('Date cannot be in the future.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const isTask = this.workItem.startsWith('task:');
    const body = {
      entry_date: this.entryDate,
      task_id: isTask ? this.workItem.slice(5) : null,
      category: isTask ? null : this.workItem.slice(4),
      hours: h,
      notes: this.notes.trim() || null,
      save_as_draft: this.saveAsDraft(),
    };

    const url = `${environment.apiBaseUrl}/timesheets?project_id=${encodeURIComponent(this.projectId())}`;
    this.http.post(url, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/my-projects-tasks']);
      },
      error: (err) => {
        this.saving.set(false);
        // Surface what the server actually said. Its messages here are
        // specific and actionable — "You must be a Lead or Member of this
        // project to log hours against it" tells the user something a generic
        // failure string never would.
        const detail = err?.error?.detail;
        this.error.set(
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d)).join('; ')
              : 'Could not log these hours. Please try again.',
        );
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/my-projects-tasks']);
  }
}
