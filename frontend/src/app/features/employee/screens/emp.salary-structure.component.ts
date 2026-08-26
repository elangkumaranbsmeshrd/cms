import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatMoney } from '../../../shared/screens/cell-format';

const SCREEN = 'employee.salary_structure';

interface StatutoryLineRow {
  readonly id: string;
  readonly print_label_snapshot: string;
  readonly borne_by: string;
  readonly include_in_ctc_snapshot: boolean;
  readonly per_employee_opt_out_allowed_snapshot: boolean;
  readonly computed_amount_monthly: string;
  readonly is_applicable: boolean;
}

interface SalaryStructureRow {
  readonly id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly change_note: string | null;
  readonly basic_salary_monthly: string;
  readonly dearness_allowance_monthly: string;
  readonly hra_monthly: string;
  readonly lta_amount: string;
  readonly lta_payout_basis: string;
  readonly special_allowance_monthly: string;
  readonly other_earnings_monthly: string;
  readonly variable_pay_amount: string;
  readonly variable_pay_frequency: string;
  readonly gross_monthly: string;
  readonly insurance_employee_contribution_monthly: string;
  readonly total_employee_statutory_monthly: string;
  readonly net_monthly: string;
  readonly annual_ctc: string;
  readonly basic_plus_da_share_pct: string;
  readonly is_wage_code_compliant: boolean;
  readonly wage_code_override_reason: string | null;
  readonly statutory_lines: readonly StatutoryLineRow[];
}

/** §2.2 Salary Structure tab (employee.salary_structure) — versioned-by-date
 * revisions, not an in-place edit (backend has no PUT on the structure
 * itself — a new Effective From date creates a NEW row and auto-closes the
 * previous one, see employee_compensation.py's create_salary_structure). A
 * bespoke component for the same reason tax-head-child-screen.component.ts
 * is one: none of the generic shapes (record/form/singleton) model
 * "current value + auto-closing history + per-line toggle with its own,
 * narrower RBAC action" — see that file's own doc comment for the house
 * convention this follows.
 */
@Component({
  selector: 'app-emp-salary-structure',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (toggleError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ toggleError() }}</div>
      }
      @if (current(); as c) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head">
            <h3>Current Structure — effective {{ c.effective_from }}</h3>
            @if (canEditFull()) {
              <button class="btn sm ghost" type="button" (click)="startNewRevision()">+ New Revision</button>
            }
          </div>
          <div class="card-body">
            <div class="grid g-2" style="margin-bottom: 18px;">
              <div><div class="cell-sub">Basic Salary (Monthly)</div><div>{{ formatMoney(c.basic_salary_monthly) }}</div></div>
              <div><div class="cell-sub">Dearness Allowance (Monthly)</div><div>{{ formatMoney(c.dearness_allowance_monthly) }}</div></div>
              <div><div class="cell-sub">HRA (Monthly)</div><div>{{ formatMoney(c.hra_monthly) }}</div></div>
              <div><div class="cell-sub">LTA</div><div>{{ formatMoney(c.lta_amount) }} ({{ c.lta_payout_basis }})</div></div>
              <div><div class="cell-sub">Special Allowance (Monthly)</div><div>{{ formatMoney(c.special_allowance_monthly) }}</div></div>
              <div><div class="cell-sub">Other Earnings (Monthly)</div><div>{{ formatMoney(c.other_earnings_monthly) }}</div></div>
              <div><div class="cell-sub">Variable / Performance Pay</div><div>{{ formatMoney(c.variable_pay_amount) }} ({{ c.variable_pay_frequency }})</div></div>
            </div>

            @if (c.statutory_lines.length) {
              <h3 style="margin: 0 0 10px; font-size: 12.5px;">Statutory Deductions &amp; Contributions</h3>
              <div class="table-wrap" style="margin-bottom: 18px;">
                <table>
                  <thead>
                    <tr>
                      <th>Head</th>
                      <th>Borne By</th>
                      <th class="r">Monthly Amount</th>
                      <th>Applicable</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (line of c.statutory_lines; track line.id) {
                      <tr>
                        <td>{{ line.print_label_snapshot }}</td>
                        <td>{{ line.borne_by === 'EMPLOYEE' ? 'Employee' : 'Company' }}</td>
                        <td class="mono r">{{ formatMoney(line.computed_amount_monthly) }}</td>
                        <td>
                          @if (line.per_employee_opt_out_allowed_snapshot && canEditApplicability()) {
                            <span class="toggle" [class.on]="line.is_applicable" (click)="toggleLine(c, line)">
                              <span class="track"></span>
                            </span>
                          } @else {
                            {{ line.is_applicable ? 'Yes' : 'No' }}
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="hint" style="margin-bottom: 18px;">No statutory deductions or contributions are configured. Add them in Masters → Taxes.</p>
            }

            <div class="grid g-2">
              <div><div class="cell-sub">Gross Monthly</div><div class="cell-strong">{{ formatMoney(c.gross_monthly) }}</div></div>
              <div><div class="cell-sub">Insurance — Employee Contribution</div><div>&minus; {{ formatMoney(c.insurance_employee_contribution_monthly) }}</div></div>
              <div><div class="cell-sub">Statutory (employee-borne)</div><div>&minus; {{ formatMoney(c.total_employee_statutory_monthly) }}</div></div>
              <div><div class="cell-sub">Net Monthly (before income tax)</div><div class="cell-strong">{{ formatMoney(c.net_monthly) }}</div></div>
              <div><div class="cell-sub">Annual CTC</div><div class="cell-strong">{{ formatMoney(c.annual_ctc) }}</div></div>
              <div>
                <div class="cell-sub">Wage Code Compliance</div>
                <div>
                  @if (c.is_wage_code_compliant) {
                    <span class="badge-s b-success">Compliant ({{ c.basic_plus_da_share_pct }}% Basic+DA)</span>
                  } @else {
                    <span class="badge-s b-warning" [title]="c.wage_code_override_reason ?? ''">Override ({{ c.basic_plus_da_share_pct }}%)</span>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      } @else {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-body">
            <p class="hint" style="margin: 0 0 12px;">No Salary Structure has been created for this employee yet.</p>
            @if (canEditFull()) {
              <button class="btn sm primary" type="button" (click)="startNewRevision()">+ Create Salary Structure</button>
            }
          </div>
        </div>
      }

      @if (showForm()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>New Revision</h3></div>
          <div class="card-body">
            @if (formError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
            }
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div>
                <div class="cell-sub">Effective From</div>
                <input class="input" type="date" [(ngModel)]="form['effective_from']" />
              </div>
              <div>
                <div class="cell-sub">Basic Salary (Monthly)</div>
                <input class="input" type="number" [(ngModel)]="form['basic_salary_monthly']" />
              </div>
              <div>
                <div class="cell-sub">Dearness Allowance (Monthly)</div>
                <input class="input" type="number" [(ngModel)]="form['dearness_allowance_monthly']" />
              </div>
              <div>
                <div class="cell-sub">HRA (Monthly)</div>
                <input class="input" type="number" [(ngModel)]="form['hra_monthly']" />
              </div>
              <div>
                <div class="cell-sub">LTA Amount</div>
                <input class="input" type="number" [(ngModel)]="form['lta_amount']" />
              </div>
              <div>
                <div class="cell-sub">LTA Payout Basis</div>
                <select class="input" [(ngModel)]="form['lta_payout_basis']">
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
              </div>
              <div>
                <div class="cell-sub">Special Allowance (Monthly)</div>
                <input class="input" type="number" [(ngModel)]="form['special_allowance_monthly']" />
              </div>
              <div>
                <div class="cell-sub">Other Earnings (Monthly)</div>
                <input class="input" type="number" [(ngModel)]="form['other_earnings_monthly']" />
              </div>
              <div>
                <div class="cell-sub">Variable / Performance Pay</div>
                <input class="input" type="number" [(ngModel)]="form['variable_pay_amount']" />
              </div>
              <div>
                <div class="cell-sub">Variable Pay Frequency</div>
                <select class="input" [(ngModel)]="form['variable_pay_frequency']">
                  <option value="ANNUAL">Annual</option>
                  <option value="QUARTERLY">Quarterly</option>
                </select>
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Wage Code Override Reason</div>
                <input class="input" [(ngModel)]="form['wage_code_override_reason']" placeholder="Only required if Basic + DA falls under 50% of CTC" />
                <div class="hint">Code on Wages, 2019 requires Basic + DA to be at least 50% of Annual CTC. Leave blank unless the save is rejected for this reason.</div>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="showForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="saveRevision()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      }

      @if (history().length > 1) {
        <div class="card">
          <div class="card-head"><h3>Structure Change History</h3></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Effective From</th>
                  <th>Effective To</th>
                  <th class="r">Basic Salary</th>
                  <th class="r">Gross Monthly</th>
                  <th class="r">Annual CTC</th>
                </tr>
              </thead>
              <tbody>
                @for (h of history(); track h.id) {
                  <tr>
                    <td class="mono">{{ h.effective_from }}</td>
                    <td class="mono">{{ h.effective_to ?? '—' }}</td>
                    <td class="mono r">{{ formatMoney(h.basic_salary_monthly) }}</td>
                    <td class="mono r">{{ formatMoney(h.gross_monthly) }}</td>
                    <td class="mono r">{{ formatMoney(h.annual_ctc) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    }
  `,
})
export class EmpSalaryStructureComponent implements OnInit {
  readonly employeeId = input.required<string>();
  /** True when this tab is hosted on My Profile, i.e. the record IS the signed-in
   * user's own. The admin sub-resource routes are gated on the screens that exist
   * to view OTHER people (employee.master_record / .salary_structure / .insurance),
   * correctly 'none' for Employee and Manager — so a person opening their own
   * profile got a bare RBAC 404 here. Self-service reads live under /employees/me,
   * gated on employee.my_profile, which every role holds. Writes are unaffected:
   * canEdit() still asks the admin screen, so no approval step is removed. */
  readonly selfService = input(false);

  /** Base path for this tab's sub-resource — /employees/me/... on My Profile,
   * /employees/{id}/... on the admin record screen. */
  protected basePath(): string {
    return this.selfService()
      ? `${environment.apiBaseUrl}/employees/me/salary-structures`
      : `${this.basePath()}`;
  }


  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  protected readonly formatMoney = formatMoney;

  protected readonly isLoading = signal(true);
  protected readonly current = signal<SalaryStructureRow | null>(null);
  protected readonly history = signal<readonly SalaryStructureRow[]>([]);
  protected readonly toggleError = signal<string | null>(null);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
  }

  protected canEditFull(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected canEditApplicability(): boolean {
    return this.policy.can(SCREEN, 'edit') || this.policy.can(SCREEN, 'edit_applicability');
  }

  private load(): void {
    const base = `${this.basePath()}`;
    this.isLoading.set(true);
    this.http.get<SalaryStructureRow[]>(base).subscribe({
      next: (rows) => {
        this.history.set(rows);
        this.current.set(rows.find((r) => !r.effective_to) ?? null);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startNewRevision(): void {
    const c = this.current();
    this.form = {
      effective_from: '',
      basic_salary_monthly: c ? Number(c.basic_salary_monthly) : 0,
      dearness_allowance_monthly: c ? Number(c.dearness_allowance_monthly) : 0,
      hra_monthly: c ? Number(c.hra_monthly) : 0,
      lta_amount: c ? Number(c.lta_amount) : 0,
      lta_payout_basis: c?.lta_payout_basis ?? 'MONTHLY',
      special_allowance_monthly: c ? Number(c.special_allowance_monthly) : 0,
      other_earnings_monthly: c ? Number(c.other_earnings_monthly) : 0,
      variable_pay_amount: c ? Number(c.variable_pay_amount) : 0,
      variable_pay_frequency: c?.variable_pay_frequency ?? 'ANNUAL',
      wage_code_override_reason: null,
    };
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected saveRevision(): void {
    if (!this.form['effective_from']) {
      this.formError.set('Effective From is required.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    const body = { ...this.form, wage_code_override_reason: this.form['wage_code_override_reason'] || null };
    this.http.post<SalaryStructureRow>(`${this.basePath()}`, body).subscribe({
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

  protected toggleLine(structure: SalaryStructureRow, line: StatutoryLineRow): void {
    this.toggleError.set(null);
    const url = `${this.basePath()}/${structure.id}/lines/${line.id}/applicability`;
    this.http.put(url, { is_applicable: !line.is_applicable }).subscribe({
      next: () => this.load(),
      error: (err) => this.toggleError.set(err?.error?.detail ?? 'Failed to update.'),
    });
  }
}
