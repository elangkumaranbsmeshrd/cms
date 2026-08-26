import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { badgeClass } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { BoardScreenComponent } from '../../../shared/screens/board-screen/board-screen.component';
import { ListScreenComponent } from '../../../shared/screens/list-screen/list-screen.component';
import { ReportScreenComponent } from '../../../shared/screens/report-screen/report-screen.component';
import { BoardScreenConfig, ListScreenConfig, ReportScreenConfig } from '../../../shared/screens/screen.types';
import { CUSTOMER_REF, EMPLOYEE_REF, PROJECT_STATUS_OPTIONS, ProjectRow, TaskRow, BugRow, TimesheetEntryRow } from '../project.api';
import { buildProjectBugsBoardConfig } from './project.bugs.board.config';
import { buildProjectReportConfig } from './project.report.config';
import { buildProjectTasksBoardConfig } from './project.tasks.board.config';
import { buildProjectTeamTimesheetListConfig } from './project.team-timesheet.list.config';
import { ProjectMilestonesComponent } from './project.milestones.component';
import { ProjectSprintsComponent } from './project.sprints.component';

interface TabMeta {
  readonly key: string;
  readonly label: string;
}

/** §3 Project Record — the tabbed host at projects/:id, hosting Task Board /
 * Bugs / Sprints / Milestones / Report / Team Timesheet. Deliberately a
 * BESPOKE component, NOT a real TabbedScreenConfig object: tabbed-screen.
 * component.ts's own template only switches on `tab.config.shape` for
 * 'list' and 'singleton' (`@case ('list')`/`@case ('singleton')`, with every
 * other shape — including 'board' and 'report', both of which this record
 * needs FOUR of its six tabs to be — falling through to its own literal
 * "This tab's shape ({{ tab.config.shape }}) can't be embedded yet." @default
 * branch). Modifying that shared component was out of scope (this module's
 * own hard boundary: "Stay entirely inside your own folder"), so this
 * composes BoardScreenComponent/ListScreenComponent/ReportScreenComponent
 * directly instead — the exact same components ScreenHostComponent/
 * TabbedScreenComponent themselves already render, just wired up by hand.
 * ReportScreenComponent's own `embedded` input doc already anticipates
 * this ("...once a later phase wires one into a tabbed record") — this is
 * that later phase, just not through TabbedScreenComponent itself.
 *
 * The host's own RBAC id is project.directory (there is no separate
 * project.master_record key in app/rbac/registry/screens.py) — each TAB
 * carries its own distinct screen id and is filtered independently in
 * visibleTabs(), exactly matching the established precedent
 * employee.my_projects_tasks's own Timesheets tab already sets (a real,
 * separately-keyed RBAC screen — project.timesheet.mine — embedded with zero
 * SCREEN_ROUTES entry of its own).
 */
@Component({
  selector: 'app-project-record',
  standalone: true,
  imports: [RouterLink, BoardScreenComponent, ListScreenComponent, ReportScreenComponent, ProjectSprintsComponent, ProjectMilestonesComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Project Record</h1>
      </div>
      <div class="page-actions">
        @if (canEditProject()) {
          <button class="btn" type="button" (click)="editProject()">Edit Project</button>
        }
        @if (canCreateInvoice() && project()) {
          <button class="btn ghost" type="button" (click)="createInvoice()">Create Invoice</button>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="card"><div class="empty"><p>Loading…</p></div></div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this project</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      @if (project(); as p) {
        <div class="rec-head">
          <div class="rec-avatar">{{ p.project_name.charAt(0).toUpperCase() }}</div>
          <div style="min-width: 0;">
            <div class="rec-id">{{ p.project_code }}</div>
            <div class="rec-name">{{ p.project_name }}</div>
            <div class="rec-meta">
              <span>{{ refData.label(CUSTOMER_REF, p.customer_id) }}</span>
              <span class="dot"></span>
              <span>Lead: {{ refData.label(EMPLOYEE_REF, p.project_lead_id) }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls(p.status) }}">{{ statusLabel(p.status) }}</span>
              @if (opportunityLink(); as opp) {
                <span class="dot"></span>
                <a [routerLink]="['/opportunities', opp.id]">View Opportunity: {{ opp.title }}</a>
              }
            </div>
          </div>
        </div>

        <div class="tabs">
          @for (tab of visibleTabs(); track tab.key) {
            <div class="tab" [class.on]="tab.key === activeTabKey()" role="button" (click)="selectTab(tab.key)">
              {{ tab.label }}
              @if (counts()[tab.key]; as n) {
                <span class="cnt">{{ n }}</span>
              }
            </div>
          }
        </div>

        @switch (activeTabKey()) {
          @case ('board') {
            <app-board-screen [config]="taskBoardConfig" [embedded]="true" />
          }
          @case ('bugs') {
            <app-board-screen [config]="bugsBoardConfig" [embedded]="true" />
          }
          @case ('sprints') {
            <app-project-sprints [projectId]="id" />
          }
          @case ('milestones') {
            <app-project-milestones [projectId]="id" />
          }
          @case ('report') {
            <app-report-screen [config]="reportConfig" [embedded]="true" />
          }
          @case ('timesheet') {
            <app-list-screen [config]="teamTimesheetConfig" [embedded]="true" />
          }
        }
      }
    }
  `,
})
export class ProjectRecordComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly CUSTOMER_REF = CUSTOMER_REF;
  protected readonly EMPLOYEE_REF = EMPLOYEE_REF;

  protected readonly id: string = this.route.snapshot.paramMap.get('id') ?? '';

  // Built once per component instance — the endpoint each closes over is
  // fixed for this project's own id and never needs to change identity
  // (unlike ProjectSprintsComponent's own listConfig, nothing here needs a
  // manual reload nudge: BoardScreenComponent/ListScreenComponent/
  // ReportScreenComponent each own their own refetch-on-row-action already).
  protected readonly taskBoardConfig: BoardScreenConfig<TaskRow> = buildProjectTasksBoardConfig(this.id, this.refData);
  protected readonly bugsBoardConfig: BoardScreenConfig<BugRow> = buildProjectBugsBoardConfig(this.id, this.refData);
  protected readonly reportConfig: ReportScreenConfig = buildProjectReportConfig(this.id);
  protected readonly teamTimesheetConfig: ListScreenConfig<TimesheetEntryRow> = buildProjectTeamTimesheetListConfig(this.id);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly project = signal<ProjectRow | null>(null);
  protected readonly myEmployeeId = signal<string | null>(null);
  // §6.1 "Allow Employee to View the Opportunity Behind Their Assigned
  // Project" (opportunity module, deferred there for lack of a UI home) —
  // built here instead of exposing the toggle's own state client-side:
  // always attempt the fetch when a Project has one linked, render nothing
  // on a 404. Works unchanged for both an already-privileged Manager/Super
  // Admin (opportunity.pipeline visible outright) and a toggle-gated
  // Employee (visible only via the toggle's bypass) — same request either
  // way, the backend alone decides whether it 404s.
  protected readonly opportunityLink = signal<{ id: string; title: string } | null>(null);
  protected readonly counts = signal<Record<string, number>>({});
  private readonly selectedTab = signal<string | null>(null);

  private meLoaded = false;
  private timesheetCountFetched = false;

  ngOnInit(): void {
    this.http.get<ProjectRow>(`${environment.apiBaseUrl}/projects/${this.id}`).subscribe({
      next: (row) => {
        this.project.set(row);
        this.isLoading.set(false);
        this.maybeFetchTimesheetCount();
        if (row.opportunity_id) {
          const oppId = row.opportunity_id;
          this.http.get<{ id: string; title: string }>(`${environment.apiBaseUrl}/opportunities/${oppId}`).subscribe({
            next: (opp) => this.opportunityLink.set({ id: opp.id, title: opp.title }),
            error: () => this.opportunityLink.set(null),
          });
        }
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this project.');
        this.isLoading.set(false);
      },
    });

    // §7 — resolve the caller's own Employee id once. employee.my_profile is
    // seeded 'full' for every role including EMPLOYEE, so this is always
    // safe to call regardless of who is signed in.
    this.http.get<{ id: string }>(`${environment.apiBaseUrl}/employees/me`).subscribe({
      next: (row) => {
        this.myEmployeeId.set(row?.id ?? null);
        this.meLoaded = true;
        this.maybeFetchTimesheetCount();
      },
      error: () => {
        this.myEmployeeId.set(null);
        this.meLoaded = true;
        this.maybeFetchTimesheetCount();
      },
    });

    if (this.policy.canOpen('project.board')) {
      this.fetchCount('board', `/projects/${this.id}/tasks`);
      this.fetchCount('bugs', `/projects/${this.id}/bugs`);
    }
    if (this.policy.canOpen('project.sprints')) this.fetchCount('sprints', `/projects/${this.id}/sprints`);
    if (this.policy.canOpen('project.milestones')) this.fetchCount('milestones', `/projects/${this.id}/milestones`);
  }

  private fetchCount(key: string, path: string): void {
    this.http.get<readonly unknown[]>(`${environment.apiBaseUrl}${path}`).subscribe({
      next: (rows) => this.counts.update((c) => ({ ...c, [key]: Array.isArray(rows) ? rows.length : 0 })),
      // No badge rather than a broken tab — matches TabbedScreenComponent's
      // own count-fetch error handling exactly.
      error: () => undefined,
    });
  }

  private maybeFetchTimesheetCount(): void {
    if (this.timesheetCountFetched) return;
    if (this.isLoading() || !this.meLoaded) return;
    if (!this.timesheetTabVisible()) return;
    this.timesheetCountFetched = true;
    this.fetchCount('timesheet', `/projects/${this.id}/timesheets`);
  }

  /** §7 — GET/POST /projects/{id}/timesheets is NOT gated via require_screen
   * at all; the real backend gate is `resolve_permission(...).visible OR
   * project.project_lead_id === callingUser'sOwnEmployeeId`. PolicyStore.
   * canOpen() alone only ever resolves the role-based half of that (EMPLOYEE
   * is seeded 'none' on project.timesheet.team) — this reproduces the OR so
   * an Employee-role Project Lead still sees the tab the backend means to
   * let them use, matching this codebase's own "client-side RBAC is UX
   * only" philosophy exactly (the API independently re-derives and allows
   * the same thing regardless of what this shows).
   */
  protected timesheetTabVisible(): boolean {
    if (this.policy.canOpen('project.timesheet.team')) return true;
    const p = this.project();
    const me = this.myEmployeeId();
    return !!p && !!me && p.project_lead_id === me;
  }

  protected visibleTabs(): readonly TabMeta[] {
    const out: TabMeta[] = [];
    if (this.policy.canOpen('project.board')) {
      out.push({ key: 'board', label: 'Task Board' });
      out.push({ key: 'bugs', label: 'Bugs' });
    }
    if (this.policy.canOpen('project.sprints')) out.push({ key: 'sprints', label: 'Sprints' });
    if (this.policy.canOpen('project.milestones')) out.push({ key: 'milestones', label: 'Milestones' });
    if (this.policy.canOpen('project.report')) out.push({ key: 'report', label: 'Report' });
    if (this.timesheetTabVisible()) out.push({ key: 'timesheet', label: 'Team Timesheet' });
    return out;
  }

  protected activeTabKey(): string {
    const tabs = this.visibleTabs();
    const chosen = this.selectedTab();
    if (chosen && tabs.some((t) => t.key === chosen)) return chosen;
    const fromUrl = this.route.snapshot.queryParamMap.get('tab');
    if (fromUrl && tabs.some((t) => t.key === fromUrl)) return fromUrl;
    return tabs[0]?.key ?? '';
  }

  protected selectTab(key: string): void {
    this.selectedTab.set(key);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: key }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected canEditProject(): boolean {
    return this.policy.can('project.directory', 'edit');
  }

  protected editProject(): void {
    this.router.navigate(['/projects', this.id, 'edit']);
  }

  // invoice.list has no dedicated 'create' action — invoice.list.config.ts's
  // own createScreenAction is explicitly 'edit', same gate
  // opportunity.record.component.ts's own identical button uses.
  protected canCreateInvoice(): boolean {
    return this.policy.can('invoice.list', 'edit');
  }

  // Unlike Opportunity's own "Create Invoice" (customer_id + reference
  // only — Invoice has no opportunity_id FK), this ALSO passes project_id:
  // §6.2's "Allow Manager Read-Only Access to Their Projects' Invoices"
  // toggle needs a real link to scope by, and invoice.document.config.ts's
  // own emptyRow() already reads project_id off the create route's query
  // params for exactly this handoff.
  protected createInvoice(): void {
    const p = this.project();
    if (!p) return;
    this.router.navigate(['/invoices', 'new'], { queryParams: { customer_id: p.customer_id, project_id: p.id, reference: p.project_code } });
  }

  protected statusLabel(v: string): string {
    return PROJECT_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
  }

  protected badgeCls(v: string): string {
    return badgeClass(v);
  }
}
