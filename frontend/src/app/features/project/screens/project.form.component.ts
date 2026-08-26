import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CUSTOMER_REF, EMPLOYEE_REF, PROJECT_STATUS_OPTIONS, ProjectRow } from '../project.api';
import { EntityPickerComponent } from './entity-picker.component';

const SCREEN = 'project.directory';

interface OpportunityOption {
  readonly id: string;
  readonly title: string;
}

/** §2 Add/Edit Project — deliberately NOT FormScreenConfig: Opportunity must
 * refetch its own option list every time Customer changes (GET /opportunities
 * ?customer_id=X — a genuinely dynamic source FormScreenConfig's static
 * FieldConfig model has no hook for), and Team Members is a live-fetched
 * multi-select FormScreenConfig's 'checkgroup' can't represent either
 * (screen.types.ts's own FieldType doc: "only renders fixed, config-authored
 * options"). One bespoke component serves both create (routed at
 * projects/new) and edit (routed at projects/:id/edit, reached from the
 * record host's own header "Edit Project" button) — §2's "no separate
 * screen" reads as no separate RBAC SCREEN key (both routes stay gated on
 * project.directory's own 'edit' action, matching create_project/
 * update_project's identical require_screen(DIRECTORY_SCREEN, action="edit")
 * in projects.py), not literally zero URLs — the record host at projects/:id
 * is already its own large bespoke component, so an inline edit-in-place
 * there would mean duplicating this whole dynamic form a second time inside
 * an already-big file instead of reusing this one via a route.
 *
 * A real GET /projects/{id} exists (unlike the 15 simple Masters lookups
 * FormScreenConfig was built around), so edit mode fetches it directly rather
 * than FormScreenConfig's "look the row up out of the whole list" workaround
 * — simpler than the brief's own anticipated trade-off, unlocked precisely by
 * not forcing this into that shape.
 */
@Component({
  selector: 'app-project-form',
  standalone: true,
  imports: [FormsModule, EntityPickerComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          {{ isEdit() ? 'Edit Project' : 'Add Project' }}
          <span class="spec-ref">§2.1/§2.2</span>
        </h1>
        <p class="page-sub">{{ isEdit() ? 'Update this project\\'s details, lead, and team.' : 'Create a new project and assign its lead and team.' }}</p>
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
      @if (!canEdit()) {
        <div class="rbac-note">You have view-only access — changes here cannot be saved.</div>
      }
      @if (formError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
      }

      <div class="card">
        <div class="card-head"><h3>Project Details</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div>
              <div class="cell-sub">Project Name *</div>
              <input class="input" type="text" [(ngModel)]="form['project_name']" [disabled]="!canEdit()" maxlength="150" />
            </div>
            <div>
              <div class="cell-sub">Project Code</div>
              <!-- data.js:1243's own ro/lock field, "Auto-generated on
                   save" — create mode has no code yet (none is allocated
                   until the POST actually creates the row), so it previews
                   the same lock text the prototype's mock value stands in
                   for rather than showing a blank box. -->
              <div class="readonly-value">{{ isEdit() ? form['project_code'] : 'Auto-generated on save' }}</div>
            </div>
            <div>
              <div class="cell-sub">Customer *</div>
              <select class="input" [value]="form['customer_id'] || ''" [disabled]="!canEdit()" (change)="onCustomerChange($any($event.target).value)">
                <option value="">— Select —</option>
                @for (c of refData.options(CUSTOMER_REF) ?? []; track c.id) {
                  <option [value]="c.id">{{ c.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Opportunity</div>
              <select class="input" [(ngModel)]="form['opportunity_id']" [disabled]="!canEdit() || !form['customer_id']">
                <option [ngValue]="null">— None —</option>
                @for (o of opportunities(); track o.id) {
                  <option [value]="o.id">{{ o.title }}</option>
                }
              </select>
              @if (!form['customer_id']) {
                <div class="hint">Pick a Customer first.</div>
              } @else if (opportunitiesLoading()) {
                <div class="hint">Loading opportunities…</div>
              }
            </div>
            <div>
              <div class="cell-sub">Status</div>
              <select class="input" [(ngModel)]="form['status']" [disabled]="!canEdit()">
                @for (s of STATUS_OPTIONS; track s.value) {
                  <option [value]="s.value">{{ s.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Start Date</div>
              <input class="input" type="date" [(ngModel)]="form['start_date']" [disabled]="!canEdit()" />
            </div>
            <div>
              <div class="cell-sub">End Date</div>
              <input class="input" type="date" [(ngModel)]="form['end_date']" [disabled]="!canEdit()" />
            </div>
            <div>
              <div class="cell-sub">Budget</div>
              <input class="input" type="number" min="0" step="0.01" [(ngModel)]="form['budget']" [disabled]="!canEdit()" />
            </div>
            <div>
              <div class="cell-sub">Project Lead *</div>
              <select class="input" [(ngModel)]="form['project_lead_id']" [disabled]="!canEdit()">
                <option value="">— Select —</option>
                @for (e of employeeOptions(); track e.id) {
                  <option [value]="e.id">{{ e.label }}</option>
                }
              </select>
            </div>
            <div style="grid-column: span 2;">
              <div class="cell-sub">Description</div>
              <textarea class="input" rows="3" [(ngModel)]="form['description']" [disabled]="!canEdit()"></textarea>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 16px;">
        <div class="card-head"><h3>Team Members</h3></div>
        <div class="card-body">
          <app-entity-picker
            [options]="employeeOptions()"
            [selectedIds]="memberIds()"
            searchPlaceholder="Search employees…"
            emptyText="No employees available."
            (selectionChange)="onMembersChange($event)"
          />
        </div>
      </div>

      <div class="card-foot" style="margin-top: 16px; border-top: none;">
        <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
        @if (canEdit()) {
          <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        }
      </div>
    }
  `,
})
export class ProjectFormComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly CUSTOMER_REF = CUSTOMER_REF;
  protected readonly STATUS_OPTIONS = PROJECT_STATUS_OPTIONS;

  protected readonly isEdit = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected form: Record<string, unknown> = {};
  protected readonly memberIds = signal<readonly string[]>([]);
  protected readonly opportunities = signal<readonly OpportunityOption[]>([]);
  protected readonly opportunitiesLoading = signal(false);

  private projectId(): string | null {
    return this.route.snapshot.paramMap.get('id');
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected employeeOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(EMPLOYEE_REF) ?? [];
  }

  ngOnInit(): void {
    const id = this.projectId();
    this.isEdit.set(!!id);
    if (id) {
      this.http.get<ProjectRow>(`${environment.apiBaseUrl}/projects/${id}`).subscribe({
        next: (row) => {
          this.form = {
            project_name: row.project_name,
            project_code: row.project_code,
            customer_id: row.customer_id,
            opportunity_id: row.opportunity_id,
            status: row.status,
            start_date: row.start_date,
            end_date: row.end_date,
            budget: row.budget,
            description: row.description,
            project_lead_id: row.project_lead_id,
          };
          this.memberIds.set(row.member_ids ?? []);
          this.isLoading.set(false);
          if (row.customer_id) this.loadOpportunities(row.customer_id, row.opportunity_id);
        },
        error: (err) => {
          this.loadError.set(err?.error?.detail ?? 'Failed to load this project.');
          this.isLoading.set(false);
        },
      });
    } else {
      this.form = {
        project_name: '',
        customer_id: '',
        opportunity_id: null,
        status: 'NOT_STARTED',
        start_date: null,
        end_date: null,
        budget: null,
        description: '',
        project_lead_id: '',
      };
      this.memberIds.set([]);
      this.isLoading.set(false);
    }
  }

  protected onCustomerChange(customerId: string): void {
    this.form['customer_id'] = customerId;
    this.form['opportunity_id'] = null;
    this.opportunities.set([]);
    if (customerId) this.loadOpportunities(customerId, null);
  }

  private loadOpportunities(customerId: string, keepSelectedId: string | null): void {
    this.opportunitiesLoading.set(true);
    this.http.get<OpportunityOption[]>(`${environment.apiBaseUrl}/opportunities`, { params: { customer_id: customerId } }).subscribe({
      next: (rows) => {
        this.opportunities.set(rows ?? []);
        this.opportunitiesLoading.set(false);
        // Keep the loaded opportunity selected only if it truly belongs to
        // this customer's own list — otherwise a stale id would silently
        // resubmit on save.
        if (keepSelectedId && !(rows ?? []).some((o) => o.id === keepSelectedId)) {
          this.form['opportunity_id'] = null;
        }
      },
      error: () => {
        this.opportunities.set([]);
        this.opportunitiesLoading.set(false);
      },
    });
  }

  protected onMembersChange(ids: readonly string[]): void {
    this.memberIds.set(ids);
  }

  protected save(): void {
    if (!this.canEdit()) return;
    const name = String(this.form['project_name'] ?? '').trim();
    if (name.length < 2 || name.length > 150) {
      this.formError.set('Project Name must be 2-150 characters.');
      return;
    }
    if (!this.form['customer_id']) {
      this.formError.set('Customer is required.');
      return;
    }
    if (!this.form['project_lead_id']) {
      this.formError.set('Project Lead is required.');
      return;
    }
    const budgetRaw = this.form['budget'];
    if (budgetRaw !== null && budgetRaw !== undefined && budgetRaw !== '' && Number(budgetRaw) <= 0) {
      this.formError.set('Budget must be a positive number.');
      return;
    }
    this.formError.set(null);
    this.saving.set(true);

    const body = {
      project_name: name,
      customer_id: this.form['customer_id'],
      opportunity_id: this.form['opportunity_id'] || null,
      status: this.form['status'] ?? 'NOT_STARTED',
      start_date: this.form['start_date'] || null,
      end_date: this.form['end_date'] || null,
      budget: budgetRaw === '' || budgetRaw === undefined ? null : budgetRaw,
      description: this.form['description'] || null,
      project_lead_id: this.form['project_lead_id'],
      member_ids: this.memberIds(),
    };

    const id = this.projectId();
    const req$ = id
      ? this.http.put<ProjectRow>(`${environment.apiBaseUrl}/projects/${id}`, body)
      : this.http.post<ProjectRow>(`${environment.apiBaseUrl}/projects`, body);

    req$.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.router.navigate(['/projects', row.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to save this project.');
      },
    });
  }

  protected cancel(): void {
    const id = this.projectId();
    this.router.navigate(id ? ['/projects', id] : ['/projects']);
  }
}
