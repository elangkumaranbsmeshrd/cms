import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatMoney } from '../../../shared/screens/cell-format';

const SCREEN = 'employee.insurance';

interface DependentRow {
  readonly id: string;
  readonly dependent_name: string;
  readonly relationship: string;
}

interface NomineeRow {
  readonly id: string;
  readonly nominee_name: string;
  readonly relationship: string;
  readonly contact_phone: string | null;
}

interface EnrollmentRow {
  readonly id: string;
  readonly insurance_plan_id: string;
  readonly enrollment_date: string;
  readonly unenrolled_date: string | null;
  readonly plan_type_snapshot: string;
  readonly plan_name_snapshot: string;
  readonly coverage_amount_snapshot: string;
  readonly company_contribution_monthly_snapshot: string;
  readonly employee_contribution_monthly_snapshot: string;
  readonly status: string;
  readonly dependents: readonly DependentRow[];
  readonly nominees: readonly NomineeRow[];
}

interface PlanOption {
  readonly id: string;
  readonly plan_name: string;
  readonly plan_type: string;
}

/** §2.2 Insurance & Benefits tab (employee.insurance) — enroll/dependents/
 * nominees/end, a real sub-resource with its own conditional-by-plan-type
 * fields (dependents only for HEALTH, at least one nominee required for
 * LIFE/PERSONAL_ACCIDENT). Bespoke component for the same reason
 * emp.salary-structure.component.ts is — see that file's doc comment.
 */
@Component({
  selector: 'app-emp-insurance',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Enrollments</h3>
          @if (canEdit() && !showForm()) {
            <button class="btn sm ghost" type="button" (click)="startEnroll()">+ Enroll in a Plan</button>
          }
        </div>
        <div class="card-body">
          @if (!enrollments().length) {
            <p class="hint" style="margin: 0;">Not enrolled in any insurance plan yet.</p>
          } @else {
            @for (e of enrollments(); track e.id) {
              <div class="card" style="margin-bottom: 12px;">
                <div class="card-body">
                  <div class="grid g-2" style="margin-bottom: 10px;">
                    <div><div class="cell-sub">Plan</div><div class="cell-strong">{{ e.plan_name_snapshot }}</div></div>
                    <div><div class="cell-sub">Type</div><div>{{ e.plan_type_snapshot }}</div></div>
                    <div><div class="cell-sub">Enrollment Date</div><div class="mono">{{ e.enrollment_date }}</div></div>
                    <div>
                      <div class="cell-sub">Status</div>
                      <div>
                        <span class="badge-s" [class.b-success]="e.status === 'ACTIVE'" [class.b-outline]="e.status !== 'ACTIVE'">{{ e.status }}</span>
                      </div>
                    </div>
                    <div><div class="cell-sub">Company Contribution (Monthly)</div><div>{{ formatMoney(e.company_contribution_monthly_snapshot) }}</div></div>
                    <div><div class="cell-sub">Employee Contribution (Monthly)</div><div>{{ formatMoney(e.employee_contribution_monthly_snapshot) }}</div></div>
                  </div>

                  @if (e.plan_type_snapshot === 'HEALTH') {
                    <div class="cell-sub" style="margin-bottom: 4px;">Dependents Covered</div>
                    @if (e.dependents.length) {
                      <ul style="margin: 0 0 10px; padding-left: 18px;">
                        @for (d of e.dependents; track d.id) {
                          <li>{{ d.dependent_name }} ({{ d.relationship }})</li>
                        }
                      </ul>
                    } @else {
                      <p class="hint" style="margin: 0 0 10px;">No dependents added.</p>
                    }
                    @if (canEdit() && e.status === 'ACTIVE') {
                      <button class="btn sm ghost" type="button" (click)="addDependent(e)">+ Add Dependent</button>
                    }
                  }

                  @if (e.plan_type_snapshot === 'LIFE' || e.plan_type_snapshot === 'PERSONAL_ACCIDENT') {
                    <div class="cell-sub" style="margin: 10px 0 4px;">Nominees</div>
                    @if (e.nominees.length) {
                      <ul style="margin: 0 0 10px; padding-left: 18px;">
                        @for (n of e.nominees; track n.id) {
                          <li>{{ n.nominee_name }} ({{ n.relationship }}){{ n.contact_phone ? ' — ' + n.contact_phone : '' }}</li>
                        }
                      </ul>
                    } @else {
                      <p class="hint" style="margin: 0 0 10px;">No nominees added.</p>
                    }
                    @if (canEdit() && e.status === 'ACTIVE') {
                      <button class="btn sm ghost" type="button" (click)="addNominee(e)">+ Add Nominee</button>
                    }
                  }

                  @if (canEdit() && e.status === 'ACTIVE') {
                    <div style="margin-top: 12px;">
                      <button class="btn sm ghost" type="button" (click)="endEnrollment(e)">End Enrollment</button>
                    </div>
                  }
                </div>
              </div>
            }
          }
        </div>
      </div>

      @if (showForm()) {
        <div class="card">
          <div class="card-head"><h3>Enroll in a Plan</h3></div>
          <div class="card-body">
            @if (formError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
            }
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div>
                <div class="cell-sub">Insurance Plan</div>
                <select class="input" [(ngModel)]="form['insurance_plan_id']" (ngModelChange)="onPlanChange()">
                  <option [value]="null">—</option>
                  @for (p of plans(); track p.id) {
                    <option [value]="p.id">{{ p.plan_name }} ({{ p.plan_type }})</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">Enrollment Date</div>
                <input class="input" type="date" [(ngModel)]="form['enrollment_date']" />
              </div>
            </div>

            @if (selectedPlanType() === 'LIFE' || selectedPlanType() === 'PERSONAL_ACCIDENT') {
              <div class="cell-sub" style="margin-bottom: 4px;">Nominee (required for this plan type)</div>
              <div class="grid g-2" style="margin-bottom: 12px;">
                <input class="input" placeholder="Nominee Name" [(ngModel)]="form['nominee_name']" />
                <input class="input" placeholder="Relationship" [(ngModel)]="form['nominee_relationship']" />
                <input class="input" placeholder="Phone" [(ngModel)]="form['nominee_phone']" />
              </div>
            }
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="showForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="saveEnrollment()">
              {{ saving() ? 'Saving…' : 'Enroll' }}
            </button>
          </div>
        </div>
      }
    }
  `,
})
export class EmpInsuranceComponent implements OnInit {
  readonly employeeId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  protected readonly formatMoney = formatMoney;

  protected readonly isLoading = signal(true);
  protected readonly enrollments = signal<readonly EnrollmentRow[]>([]);
  protected readonly plans = signal<readonly PlanOption[]>([]);
  protected readonly actionError = signal<string | null>(null);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly selectedPlanType = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
    // /options, not the gated masters.insurance_plans screen — that screen is
    // Super-Admin-only (seed.py), so this picker was empty for Employee and
    // Manager on their own Insurance & Benefits tab. plan_type rides along
    // deliberately (masters_lookup.py's options_extra_fields): the form
    // branches on it (dependents only for HEALTH), so the client needs the
    // value. The plan's coverage and contribution figures stay unreachable.
    this.http
      .get<{ id: string; label: string; is_active: boolean; plan_type: string }[]>(
        `${environment.apiBaseUrl}/masters/insurance-plans/options`,
      )
      .subscribe({
        next: (rows) => this.plans.set(rows.map((r) => ({ id: r.id, plan_name: r.label, plan_type: r.plan_type }))),
        error: () => this.plans.set([]),
      });
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<EnrollmentRow[]>(`${environment.apiBaseUrl}/employees/${this.employeeId()}/insurance-enrollments`).subscribe({
      next: (rows) => {
        this.enrollments.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startEnroll(): void {
    this.form = { insurance_plan_id: null, enrollment_date: '', nominee_name: '', nominee_relationship: '', nominee_phone: '' };
    this.selectedPlanType.set(null);
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected onPlanChange(): void {
    const plan = this.plans().find((p) => p.id === this.form['insurance_plan_id']);
    this.selectedPlanType.set(plan?.plan_type ?? null);
  }

  protected saveEnrollment(): void {
    if (!this.form['insurance_plan_id'] || !this.form['enrollment_date']) {
      this.formError.set('Insurance Plan and Enrollment Date are required.');
      return;
    }
    const planType = this.selectedPlanType();
    const nominees: unknown[] = [];
    if (planType === 'LIFE' || planType === 'PERSONAL_ACCIDENT') {
      if (!this.form['nominee_name'] || !this.form['nominee_relationship']) {
        this.formError.set('At least one nominee is required to enroll in a Life or Personal Accident plan.');
        return;
      }
      nominees.push({ nominee_name: this.form['nominee_name'], relationship: this.form['nominee_relationship'], contact_phone: this.form['nominee_phone'] || null, is_primary: true });
    }
    this.saving.set(true);
    this.formError.set(null);
    const body = { insurance_plan_id: this.form['insurance_plan_id'], enrollment_date: this.form['enrollment_date'], dependents: [], nominees };
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId()}/insurance-enrollments`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        const detail = err?.error?.detail;
        this.formError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to save.');
      },
    });
  }

  protected addDependent(enrollment: EnrollmentRow): void {
    const name = window.prompt('Dependent name?');
    if (!name) return;
    const relationship = window.prompt('Relationship?') ?? '';
    this.actionError.set(null);
    this.http
      .post(`${environment.apiBaseUrl}/employees/${this.employeeId()}/insurance-enrollments/${enrollment.id}/dependents`, { dependent_name: name, relationship, display_order: enrollment.dependents.length })
      .subscribe({
        next: () => this.load(),
        error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to add dependent.'),
      });
  }

  protected addNominee(enrollment: EnrollmentRow): void {
    const name = window.prompt('Nominee name?');
    if (!name) return;
    const relationship = window.prompt('Relationship?') ?? '';
    this.actionError.set(null);
    this.http
      .post(`${environment.apiBaseUrl}/employees/${this.employeeId()}/insurance-enrollments/${enrollment.id}/nominees`, { nominee_name: name, relationship, contact_phone: null, is_primary: enrollment.nominees.length === 0 })
      .subscribe({
        next: () => this.load(),
        error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to add nominee.'),
      });
  }

  protected endEnrollment(enrollment: EnrollmentRow): void {
    if (!window.confirm('End this enrollment? The employee will no longer be covered by this plan.')) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId()}/insurance-enrollments/${enrollment.id}/end`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to end enrollment.'),
    });
  }
}
