import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { badgeClass, humanizeEnum } from '../../../shared/screens/cell-format';
import { AssetAssignmentHistoryRow, AssetRow } from '../asset.api';

const EMPLOYEE_REF = { endpoint: '/employees', labelKey: 'first_name' };
// performed_by is a raw platform User id, distinct from employee_id above —
// resolved via the cross-cutting GET /users.
const USER_REF = { endpoint: '/users', labelKey: 'name' };
const LOCATION_REF = { endpoint: '/masters/company-profile/addresses/options', labelKey: 'label' };
const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const SCREEN = 'asset.directory';

/** §2 Tab: Assignment History (asset.directory record, bespoke — a
 * RecordComponentTab only ever receives the host asset's own id
 * (screen.types.ts's idInputName contract), never the full loaded row, so
 * this independently re-fetches the asset itself (needed to know its
 * current Status — which of Assign/Transfer/Unassign applies — and its
 * current Location/Department), the same "own HttpClient fetch, not
 * RefDataService for the host record itself" rule every other bespoke tab in
 * this codebase follows (e.g. customer.files.component.ts).
 *
 * Assign/Transfer/Unassign and the Location & Department editor are all
 * gated on the 'assign' action (Super Admin + HR) — NOT 'edit' (Accountant),
 * per AssetLocationWrite's own backend docstring: "edited only through this
 * 2.3-family action... never through the general Details-tab edit action,
 * which Accountant also holds and must not be able to use to relocate an
 * asset." Accountant therefore sees this whole tab (view is unconditional)
 * but every control on it stays disabled/hidden.
 */
@Component({
  selector: 'app-asset-assignment-history',
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
          <h3>Assignment</h3>
          @if (canAssign() && !showAssignForm() && !showTransferForm()) {
            <div class="filter-row">
              @if (asset()?.status === 'IN_STORE') {
                <button class="btn sm ghost" type="button" (click)="startAssign()">Assign</button>
              }
              @if (asset()?.status === 'IN_USE') {
                <button class="btn sm ghost" type="button" (click)="startTransfer()">Transfer</button>
                <button class="btn sm ghost" type="button" [disabled]="submitting()" (click)="unassign()">Unassign</button>
              }
            </div>
          }
        </div>

        @if (showAssignForm()) {
          <div class="card-body">
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div>
                <div class="cell-sub">Employee</div>
                <select class="input" [(ngModel)]="assignForm['employee_id']">
                  <option [ngValue]="null">—</option>
                  @for (o of refData.options(EMPLOYEE_REF) ?? []; track o.id) {
                    <option [ngValue]="o.id">{{ o.label }}</option>
                  }
                </select>
              </div>
              <div><div class="cell-sub">Effective Date</div><input class="input" type="date" [(ngModel)]="assignForm['effective_date']" /></div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submitting()" (click)="showAssignForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submitAssign()">{{ submitting() ? 'Submitting…' : 'Assign' }}</button>
          </div>
        }

        @if (showTransferForm()) {
          <div class="card-body">
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div>
                <div class="cell-sub">New Employee</div>
                <select class="input" [(ngModel)]="transferForm['employee_id']">
                  <option [ngValue]="null">—</option>
                  @for (o of refData.options(EMPLOYEE_REF) ?? []; track o.id) {
                    <option [ngValue]="o.id">{{ o.label }}</option>
                  }
                </select>
              </div>
              <div><div class="cell-sub">Effective Date</div><input class="input" type="date" [(ngModel)]="transferForm['effective_date']" /></div>
              <div style="grid-column: span 2;"><div class="cell-sub">Reason</div><textarea class="input" rows="2" [(ngModel)]="transferForm['reason']"></textarea></div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submitting()" (click)="showTransferForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submitTransfer()">{{ submitting() ? 'Submitting…' : 'Transfer' }}</button>
          </div>
        }
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Location &amp; Department</h3>
          @if (canAssign() && !editingLocation()) {
            <button class="btn sm ghost" type="button" (click)="startLocationEdit()">Edit</button>
          }
        </div>
        <div class="card-body">
          @if (editingLocation()) {
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Location</div>
                <select class="input" [(ngModel)]="locationForm['location_address_id']">
                  <option [ngValue]="null">—</option>
                  @for (o of refData.options(LOCATION_REF) ?? []; track o.id) {
                    <option [ngValue]="o.id">{{ o.label }}</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">Department</div>
                <select class="input" [(ngModel)]="locationForm['department_id']">
                  <option [ngValue]="null">—</option>
                  @for (o of refData.options(DEPARTMENT_REF) ?? []; track o.id) {
                    <option [ngValue]="o.id">{{ o.label }}</option>
                  }
                </select>
              </div>
            </div>
          } @else {
            <div class="grid g-2">
              <div><div class="cell-sub">Location</div><div>{{ refData.label(LOCATION_REF, asset()?.location_address_id) }}</div></div>
              <div><div class="cell-sub">Department</div><div>{{ refData.label(DEPARTMENT_REF, asset()?.department_id) }}</div></div>
            </div>
          }
        </div>
        @if (editingLocation()) {
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submitting()" (click)="editingLocation.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="saveLocation()">{{ submitting() ? 'Saving…' : 'Save' }}</button>
          </div>
        }
      </div>

      <div class="card">
        <div class="card-head"><h3>Assignment History</h3></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>From</th>
                <th>To</th>
                <th>Action</th>
                <th>Performed By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              @for (h of history(); track h.id) {
                <tr>
                  <td>{{ refData.label(EMPLOYEE_REF, h.employee_id) }}</td>
                  <td class="mono">{{ h.from_date }}</td>
                  <td class="mono">{{ h.to_date ?? '—' }}</td>
                  <td><span class="badge-s {{ badgeClass(h.action) }}">{{ humanizeEnum(h.action) }}</span></td>
                  <td class="mono">{{ refData.label(USER_REF, h.performed_by) }}</td>
                  <td>{{ h.reason ?? '—' }}</td>
                </tr>
              }
              @if (!history().length) {
                <tr><td colspan="6" class="cell-sub">No assignment history yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class AssetAssignmentHistoryComponent implements OnInit {
  readonly assetId = input.required<string>();

  private readonly http = inject(HttpClient);
  protected readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly EMPLOYEE_REF = EMPLOYEE_REF;
  protected readonly LOCATION_REF = LOCATION_REF;
  protected readonly DEPARTMENT_REF = DEPARTMENT_REF;
  protected readonly USER_REF = USER_REF;
  protected readonly humanizeEnum = humanizeEnum;
  protected readonly badgeClass = badgeClass;

  protected readonly isLoading = signal(true);
  protected readonly asset = signal<AssetRow | null>(null);
  protected readonly history = signal<readonly AssetAssignmentHistoryRow[]>([]);
  protected readonly actionError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly showAssignForm = signal(false);
  protected readonly showTransferForm = signal(false);
  protected assignForm: Record<string, unknown> = {};
  protected transferForm: Record<string, unknown> = {};

  protected readonly editingLocation = signal(false);
  protected locationForm: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
  }

  protected canAssign(): boolean {
    return this.policy.can(SCREEN, 'assign');
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<AssetRow>(`${environment.apiBaseUrl}/assets/${this.assetId()}`).subscribe({
      next: (row) => {
        this.asset.set(row);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
    this.http.get<AssetAssignmentHistoryRow[]>(`${environment.apiBaseUrl}/assets/${this.assetId()}/assignment-history`).subscribe({
      next: (rows) => this.history.set(rows),
      error: () => this.history.set([]),
    });
  }

  private reloadAfterAction(): void {
    this.submitting.set(false);
    this.showAssignForm.set(false);
    this.showTransferForm.set(false);
    this.editingLocation.set(false);
    this.load();
  }

  // ---- Assign -------------------------------------------------------------
  protected startAssign(): void {
    this.assignForm = { employee_id: null, effective_date: '' };
    this.actionError.set(null);
    this.showAssignForm.set(true);
  }

  protected submitAssign(): void {
    if (!this.assignForm['employee_id']) {
      this.actionError.set('Employee is required.');
      return;
    }
    this.submitting.set(true);
    this.actionError.set(null);
    const body = { employee_id: this.assignForm['employee_id'], effective_date: this.assignForm['effective_date'] || null };
    this.http.post(`${environment.apiBaseUrl}/assets/${this.assetId()}/assign`, body).subscribe({
      next: () => this.reloadAfterAction(),
      error: (err) => {
        this.submitting.set(false);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  // ---- Transfer -------------------------------------------------------------
  protected startTransfer(): void {
    this.transferForm = { employee_id: null, effective_date: '', reason: '' };
    this.actionError.set(null);
    this.showTransferForm.set(true);
  }

  protected submitTransfer(): void {
    if (!this.transferForm['employee_id'] || !this.transferForm['reason']) {
      this.actionError.set('Employee and Reason are both required.');
      return;
    }
    this.submitting.set(true);
    this.actionError.set(null);
    const body = {
      employee_id: this.transferForm['employee_id'],
      effective_date: this.transferForm['effective_date'] || null,
      reason: this.transferForm['reason'],
    };
    this.http.post(`${environment.apiBaseUrl}/assets/${this.assetId()}/transfer`, body).subscribe({
      next: () => this.reloadAfterAction(),
      error: (err) => {
        this.submitting.set(false);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  // ---- Unassign -------------------------------------------------------------
  protected unassign(): void {
    if (!window.confirm('Unassign this asset? It will return to In Store.')) return;
    this.submitting.set(true);
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/assets/${this.assetId()}/unassign`, {}).subscribe({
      next: () => this.reloadAfterAction(),
      error: (err) => {
        this.submitting.set(false);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  // ---- Location & Department ----------------------------------------------
  protected startLocationEdit(): void {
    const a = this.asset();
    this.locationForm = { location_address_id: a?.location_address_id ?? null, department_id: a?.department_id ?? null };
    this.actionError.set(null);
    this.editingLocation.set(true);
  }

  protected saveLocation(): void {
    this.submitting.set(true);
    this.actionError.set(null);
    const body = {
      location_address_id: this.locationForm['location_address_id'] || null,
      department_id: this.locationForm['department_id'] || null,
    };
    this.http.put(`${environment.apiBaseUrl}/assets/${this.assetId()}/location`, body).subscribe({
      next: () => this.reloadAfterAction(),
      error: (err) => {
        this.submitting.set(false);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown): string {
    const detail = (err as any)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    return 'That action failed.';
  }
}
