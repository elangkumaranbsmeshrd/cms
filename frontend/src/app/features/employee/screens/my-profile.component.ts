import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { EmpEmergencyContactsComponent } from './emp.emergency-contacts.component';
import { EmpInsuranceComponent } from './emp.insurance.component';
import { EmpSalaryStructureComponent } from './emp.salary-structure.component';

const SCREEN = 'employee.my_profile';

const DEPARTMENT_REF = { endpoint: '/masters/departments' };
const DESIGNATION_REF = { endpoint: '/masters/designations' };
const EMPLOYMENT_TYPE_REF = { endpoint: '/masters/employment-types' };

interface MyProfileRow {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly current_address: string | null;
  readonly date_of_birth: string | null;
  readonly gender: string | null;
  readonly pan_number: string | null;
  readonly aadhaar_number: string | null;
  readonly bank_name: string | null;
  readonly bank_account_number: string | null;
  readonly bank_ifsc_code: string | null;
  readonly department_id: string;
  readonly designation_id: string;
  readonly employment_type_id: string;
  readonly joining_date: string;
  readonly employment_status: string;
  readonly employee_code: string;
}

interface ChangeRequestRow {
  readonly id: string;
  readonly field_key: string;
  readonly old_value: string | null;
  readonly requested_value: string;
  readonly employee_note: string | null;
  readonly status: string;
  readonly decision_reason: string | null;
  readonly decided_at: string | null;
}

// field_key value on ProfileChangeRequestCreate/Out, one row per approval-
// required field per employees.py's PROFILE_CHANGE_REQUEST_FIELDS.
const APPROVAL_FIELDS: readonly { readonly key: string; readonly label: string; readonly rowKey: keyof MyProfileRow }[] = [
  { key: 'FIRST_NAME', label: 'First Name', rowKey: 'first_name' },
  { key: 'LAST_NAME', label: 'Last Name', rowKey: 'last_name' },
  { key: 'EMAIL', label: 'Email', rowKey: 'email' },
  { key: 'DATE_OF_BIRTH', label: 'Date of Birth', rowKey: 'date_of_birth' },
  { key: 'GENDER', label: 'Gender', rowKey: 'gender' },
  { key: 'BANK_NAME', label: 'Bank Name', rowKey: 'bank_name' },
  { key: 'BANK_ACCOUNT_NUMBER', label: 'Bank Account Number', rowKey: 'bank_account_number' },
  { key: 'BANK_IFSC_CODE', label: 'IFSC Code', rowKey: 'bank_ifsc_code' },
  { key: 'PAN_NUMBER', label: 'PAN', rowKey: 'pan_number' },
  { key: 'AADHAAR_NUMBER', label: 'Aadhaar Number', rowKey: 'aadhaar_number' },
];

/** §2.3 My Profile (employee.my_profile) — the same employee record as
 * §2.2's Master Record, opened by the logged-in person about themselves,
 * fields split into view-only / directly-editable / approval-required
 * buckets. Bespoke component: this is a genuinely different SCREEN (its
 * own RBAC key, its own /employees/me endpoints) from the Master Record,
 * not a role-gated view of RecordScreenComponent — none of the generic
 * shapes model "3 different edit disciplines on one page" either. Reuses
 * EmpEmergencyContactsComponent/EmpSalaryStructureComponent (both already
 * take a plain employeeId input) rather than re-implementing either — same
 * underlying endpoints, same RBAC-driven read/write gating, just a
 * different host page.
 */
@Component({
  selector: 'app-my-profile',
  standalone: true,
  imports: [FormsModule, EmpEmergencyContactsComponent, EmpSalaryStructureComponent, EmpInsuranceComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Profile</h1>
        <p class="page-sub">Your own employee record.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (!row()) {
      <div class="empty"><p>No employee record is linked to your login.</p></div>
    } @else {
    @if (row(); as r) {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Employment Details (view only)</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div><div class="cell-sub">Department</div><div>{{ refData.label(DEPARTMENT_REF, r.department_id) }}</div></div>
            <div><div class="cell-sub">Designation</div><div>{{ refData.label(DESIGNATION_REF, r.designation_id) }}</div></div>
            <div><div class="cell-sub">Joining Date</div><div class="mono">{{ r.joining_date }}</div></div>
            <div><div class="cell-sub">Employment Type</div><div>{{ refData.label(EMPLOYMENT_TYPE_REF, r.employment_type_id) }}</div></div>
            <div><div class="cell-sub">Status</div><div><span class="badge-s b-info">{{ r.employment_status }}</span></div></div>
            <div><div class="cell-sub">Employee Code</div><div class="mono">{{ r.employee_code }}</div></div>
          </div>
          <p class="hint" style="margin: 12px 0 0;">Changes to these need a direct HR action on your Employee Master Record — there is no request-a-change path for them here.</p>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Contact Details</h3>
          @if (!editingContact()) {
            <button class="btn sm ghost" type="button" (click)="startEditContact(r)">Edit</button>
          }
        </div>
        <div class="card-body">
          @if (editingContact()) {
            @if (contactError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ contactError() }}</div>
            }
            <div class="grid g-2">
              <div><div class="cell-sub">Phone</div><input class="input" [(ngModel)]="contactForm['phone']" /></div>
              <div style="grid-column: span 2;"><div class="cell-sub">Current Address</div><textarea class="input" rows="3" [(ngModel)]="contactForm['current_address']"></textarea></div>
            </div>
          } @else {
            <div class="grid g-2">
              <div><div class="cell-sub">Phone</div><div>{{ r.phone ?? '—' }}</div></div>
              <div style="grid-column: span 2;"><div class="cell-sub">Current Address</div><div>{{ r.current_address ?? '—' }}</div></div>
            </div>
          }
        </div>
        @if (editingContact()) {
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="savingContact()" (click)="editingContact.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="savingContact()" (click)="saveContact()">
              {{ savingContact() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        }
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Identity &amp; Bank Details</h3></div>
        <div class="card-body">
          @if (requestError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ requestError() }}</div>
          }
          <div class="grid g-2">
            @for (f of APPROVAL_FIELDS; track f.key) {
              <div>
                <div class="cell-sub">{{ f.label }}</div>
                <div>{{ (r[f.rowKey] ?? '—') }}</div>
                @if (pendingFor(f.key); as pending) {
                  <span class="badge-s b-warning" style="margin-top: 4px;" [title]="'Requested: ' + pending.requested_value">Pending Approval</span>
                } @else if (requestingField() === f.key) {
                  <div style="margin-top: 6px;">
                    <input class="input" placeholder="New value" [(ngModel)]="requestForm['requested_value']" />
                    <input class="input" style="margin-top: 4px;" placeholder="Note (optional)" [(ngModel)]="requestForm['employee_note']" />
                    <div style="margin-top: 4px;">
                      <button class="btn sm primary" type="button" [disabled]="submittingRequest()" (click)="submitRequest(f.key)">Submit</button>
                      <button class="btn sm ghost" type="button" [disabled]="submittingRequest()" (click)="requestingField.set(null)">Cancel</button>
                    </div>
                  </div>
                } @else {
                  <button class="btn sm ghost" type="button" style="margin-top: 4px;" (click)="startRequest(f.key)">Request Change</button>
                }
              </div>
            }
          </div>
        </div>
      </div>

      @if (changeRequests().length) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>My Change Requests</h3></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Old Value</th>
                  <th>Requested Value</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Reason (if rejected)</th>
                </tr>
              </thead>
              <tbody>
                @for (cr of changeRequests(); track cr.id) {
                  <tr>
                    <td>{{ fieldLabel(cr.field_key) }}</td>
                    <td>{{ cr.old_value ?? '—' }}</td>
                    <td>{{ cr.requested_value }}</td>
                    <td>
                      <span class="badge-s" [class.b-warning]="cr.status === 'PENDING'" [class.b-success]="cr.status === 'APPROVED'" [class.b-danger]="cr.status === 'REJECTED'">{{ cr.status }}</span>
                    </td>
                    <td class="mono">{{ cr.decided_at ?? '—' }}</td>
                    <td>{{ cr.decision_reason ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Emergency Contact</h3></div>
        <div class="card-body" style="padding: 0;">
          <app-emp-emergency-contacts [employeeId]="r.id" />
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Salary Structure (view only)</h3></div>
        <div class="card-body" style="padding: 0;">
          <app-emp-salary-structure [employeeId]="r.id" />
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>My Insurance</h3></div>
        <div class="card-body" style="padding: 0;">
          <!-- §2.3 My Insurance tab: "Read-only. Enrollment is HR/Super
               Admin-managed..." — EmpInsuranceComponent's own canEdit()
               already gates every Enroll/Add Dependent/Add Nominee/End
               button on policy.can('employee.insurance', 'edit'), so this
               naturally renders read-only for every role that tab is
               read-only for, with no separate prop needed here. -->
          <app-emp-insurance [employeeId]="r.id" />
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Resignation</h3>
          @if (!resignation() && !showResign()) {
            <button class="btn sm ghost" type="button" (click)="startResign()">Raise Resignation</button>
          }
        </div>
        <div class="card-body">
          @if (resignationError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ resignationError() }}</div>
          }
          @if (showResign()) {
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div><div class="cell-sub">Last Working Day</div><input class="input" type="date" [(ngModel)]="resignForm['last_working_day']" /></div>
              <div></div>
              <div style="grid-column: span 2;"><div class="cell-sub">Reason</div><textarea class="input" rows="3" [(ngModel)]="resignForm['reason']"></textarea></div>
            </div>
            <button class="btn ghost" type="button" [disabled]="submittingResign()" (click)="showResign.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submittingResign()" (click)="submitResign()">
              {{ submittingResign() ? 'Submitting…' : 'Submit' }}
            </button>
          } @else {
          @if (resignation(); as res) {
            <div class="grid g-2">
              <div><div class="cell-sub">Last Working Day</div><div>{{ res.last_working_day }}</div></div>
              <div><div class="cell-sub">Status</div><div><span class="badge-s b-info">{{ res.status }}</span></div></div>
            </div>
            @if (['SUBMITTED', 'MANAGER_ACKNOWLEDGED', 'HR_PROCESSING'].includes(res.status)) {
              <button class="btn sm ghost" type="button" style="margin-top: 10px;" (click)="withdrawResign(res)">Withdraw</button>
            }
          } @else {
            <p class="hint" style="margin: 0;">No resignation on file.</p>
          }
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Change Password</h3>
          @if (!editingPassword()) {
            <button class="btn sm ghost" type="button" (click)="startPassword()">Change Password</button>
          }
        </div>
        @if (editingPassword()) {
          <div class="card-body">
            @if (passwordError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ passwordError() }}</div>
            }
            <div class="grid g-2">
              <div><div class="cell-sub">Current Password</div><input class="input" type="password" [(ngModel)]="passwordForm['current_password']" /></div>
              <div></div>
              <div><div class="cell-sub">New Password</div><input class="input" type="password" [(ngModel)]="passwordForm['new_password']" /></div>
              <div><div class="cell-sub">Confirm New Password</div><input class="input" type="password" [(ngModel)]="passwordForm['confirm_password']" /></div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="savingPassword()" (click)="editingPassword.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="savingPassword()" (click)="savePassword()">
              {{ savingPassword() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        }
      </div>
    }
    }
  `,
})
export class MyProfileComponent {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly DEPARTMENT_REF = DEPARTMENT_REF;
  protected readonly DESIGNATION_REF = DESIGNATION_REF;
  protected readonly EMPLOYMENT_TYPE_REF = EMPLOYMENT_TYPE_REF;
  protected readonly APPROVAL_FIELDS = APPROVAL_FIELDS;

  protected readonly isLoading = signal(true);
  protected readonly row = signal<MyProfileRow | null>(null);
  protected readonly changeRequests = signal<readonly ChangeRequestRow[]>([]);

  protected readonly editingContact = signal(false);
  protected readonly savingContact = signal(false);
  protected readonly contactError = signal<string | null>(null);
  protected contactForm: Record<string, unknown> = {};

  protected readonly requestingField = signal<string | null>(null);
  protected readonly submittingRequest = signal(false);
  protected readonly requestError = signal<string | null>(null);
  protected requestForm: Record<string, unknown> = {};

  protected readonly editingPassword = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected passwordForm: Record<string, unknown> = {};

  protected readonly resignation = signal<{ id: string; last_working_day: string; status: string } | null>(null);
  protected readonly showResign = signal(false);
  protected readonly submittingResign = signal(false);
  protected readonly resignationError = signal<string | null>(null);
  protected resignForm: Record<string, unknown> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<MyProfileRow>(`${environment.apiBaseUrl}/employees/me`).subscribe({
      next: (r) => {
        this.row.set(r);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
    this.http.get<ChangeRequestRow[]>(`${environment.apiBaseUrl}/employees/me/change-requests`).subscribe({
      next: (rows) => this.changeRequests.set(rows),
      error: () => this.changeRequests.set([]),
    });
    // GET /resignations is own-scoped automatically for Employee/Manager —
    // no id needed. Most recent non-withdrawn one, if any, is "the" active
    // resignation this card shows.
    this.http.get<{ id: string; last_working_day: string; status: string }[]>(`${environment.apiBaseUrl}/resignations`).subscribe({
      next: (rows) => this.resignation.set(rows.find((r) => r.status !== 'WITHDRAWN') ?? null),
      error: () => this.resignation.set(null),
    });
  }

  protected fieldLabel(key: string): string {
    return APPROVAL_FIELDS.find((f) => f.key === key)?.label ?? key;
  }

  protected pendingFor(key: string): ChangeRequestRow | undefined {
    return this.changeRequests().find((cr) => cr.field_key === key && cr.status === 'PENDING');
  }

  protected startEditContact(r: MyProfileRow): void {
    this.contactForm = { phone: r.phone, current_address: r.current_address };
    this.contactError.set(null);
    this.editingContact.set(true);
  }

  protected saveContact(): void {
    this.savingContact.set(true);
    this.contactError.set(null);
    this.http.put<MyProfileRow>(`${environment.apiBaseUrl}/employees/me`, this.contactForm).subscribe({
      next: (r) => {
        this.row.set(r);
        this.savingContact.set(false);
        this.editingContact.set(false);
      },
      error: (err) => {
        this.savingContact.set(false);
        this.contactError.set(err?.error?.detail ?? 'Failed to save.');
      },
    });
  }

  protected startRequest(fieldKey: string): void {
    this.requestForm = { requested_value: '', employee_note: '' };
    this.requestError.set(null);
    this.requestingField.set(fieldKey);
  }

  protected submitRequest(fieldKey: string): void {
    if (!this.requestForm['requested_value']) {
      this.requestError.set('Enter the new value you are requesting.');
      return;
    }
    this.submittingRequest.set(true);
    this.requestError.set(null);
    const body = { field_key: fieldKey, requested_value: this.requestForm['requested_value'], employee_note: this.requestForm['employee_note'] || null };
    this.http.post(`${environment.apiBaseUrl}/employees/me/change-requests`, body).subscribe({
      next: () => {
        this.submittingRequest.set(false);
        this.requestingField.set(null);
        this.load();
      },
      error: (err) => {
        this.submittingRequest.set(false);
        this.requestError.set(err?.error?.detail ?? 'Failed to submit this request.');
      },
    });
  }

  protected startResign(): void {
    this.resignForm = { last_working_day: '', reason: '' };
    this.resignationError.set(null);
    this.showResign.set(true);
  }

  protected submitResign(): void {
    const id = this.row()?.id;
    if (!id || !this.resignForm['last_working_day']) {
      this.resignationError.set('Last Working Day is required.');
      return;
    }
    this.submittingResign.set(true);
    this.resignationError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${id}/resignations`, this.resignForm).subscribe({
      next: () => {
        this.submittingResign.set(false);
        this.showResign.set(false);
        this.load();
      },
      error: (err) => {
        this.submittingResign.set(false);
        this.resignationError.set(err?.error?.detail ?? 'Failed to submit.');
      },
    });
  }

  protected withdrawResign(res: { id: string }): void {
    if (!window.confirm('Withdraw your resignation?')) return;
    this.resignationError.set(null);
    this.http.post(`${environment.apiBaseUrl}/resignations/${res.id}/withdraw`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.resignationError.set(err?.error?.detail ?? 'Failed to withdraw.'),
    });
  }

  protected startPassword(): void {
    this.passwordForm = { current_password: '', new_password: '', confirm_password: '' };
    this.passwordError.set(null);
    this.editingPassword.set(true);
  }

  protected savePassword(): void {
    if (!this.passwordForm['current_password'] || !this.passwordForm['new_password']) {
      this.passwordError.set('All fields are required.');
      return;
    }
    if (this.passwordForm['new_password'] !== this.passwordForm['confirm_password']) {
      this.passwordError.set('New Password and Confirm New Password do not match.');
      return;
    }
    this.savingPassword.set(true);
    this.passwordError.set(null);
    const body = { current_password: this.passwordForm['current_password'], new_password: this.passwordForm['new_password'] };
    this.http.post(`${environment.apiBaseUrl}/auth/change-password`, body).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.editingPassword.set(false);
      },
      error: (err) => {
        this.savingPassword.set(false);
        this.passwordError.set(err?.error?.detail ?? 'Failed to change password.');
      },
    });
  }
}
