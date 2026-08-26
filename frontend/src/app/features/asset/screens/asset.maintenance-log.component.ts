import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { badgeClass, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { AssetMaintenanceRow } from '../asset.api';

const VENDOR_REF = { endpoint: '/vendors/options', labelKey: 'label' };
const SCREEN = 'asset.maintenance';

/** §2 Tab: Maintenance & Service Log — per-asset (asset.directory record,
 * bespoke). Gated on asset.maintenance, NOT asset.directory — a genuinely
 * cross-module tab reusing that screen's own team-scope check off the host
 * asset, the same pattern Employee Master Record's Documents tab reuses
 * employee.documents for. GET/POST /assets/{id}/maintenance both require
 * require_screen(MAINTENANCE_SCREEN, ...) server-side — a role without
 * asset.maintenance at all sees this tab render (RecordScreenComponent has
 * no per-tab RBAC filtering, per emp.record.config.ts's own documented
 * tradeoff on its Onboarding tab) but the fetch 403s, shown as a load error
 * rather than a blank table.
 *
 * §2.4's own disclosed gap ("add and edit entries" was only ever half-built)
 * is now closed: PUT /assets/{id}/maintenance/{log_id} exists (assets.py),
 * same edit-action guard as the add form below. Still no delete endpoint —
 * §2.4 only ever asked for "add and edit," an append-only-minus-deletion
 * service history is the correct reading, not a remaining gap.
 */
@Component({
  selector: 'app-asset-maintenance-log',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load the maintenance log</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Maintenance &amp; Service Log</h3>
          @if (canAdd() && !showForm()) {
            <button class="btn sm ghost" type="button" (click)="startAdd()">+ Add Maintenance Entry</button>
          }
        </div>

        @if (showForm()) {
          <div class="card-body">
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div><div class="cell-sub">Service Date</div><input class="input" type="date" [(ngModel)]="form['log_date']" /></div>
              <div><div class="cell-sub">Cost</div><input class="input" type="number" step="0.01" [(ngModel)]="form['cost']" /></div>
              <div style="grid-column: span 2;"><div class="cell-sub">Description</div><textarea class="input" rows="2" [(ngModel)]="form['description']"></textarea></div>
              <div><div class="cell-sub">Next Due Date</div><input class="input" type="date" [(ngModel)]="form['next_due_date']" /></div>
              <div>
                <div class="cell-sub">Serviced By (Vendor)</div>
                <select class="input" [(ngModel)]="form['serviced_by_vendor_id']">
                  <option [ngValue]="null">—</option>
                  @for (o of refData.options(VENDOR_REF) ?? []; track o.id) {
                    <option [ngValue]="o.id">{{ o.label }}</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">Source</div>
                <div>Manual entry</div>
                <div class="cell-sub" style="margin-top: 4px;">Reads "System-generated" when an entry is auto-created by an approved Repair / Damage request.</div>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submitting()" (click)="showForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submit()">{{ submitting() ? 'Saving…' : editingId() ? 'Save Changes' : 'Save' }}</button>
          </div>
        }

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th class="r">Cost</th>
                <th>Next Due</th>
                <th>Status</th>
                <th>Serviced By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (m of entries(); track m.id) {
                <tr>
                  <td class="mono">{{ m.log_date }}</td>
                  <td>
                    {{ m.description }}
                    @if (m.is_system_generated) {
                      <span class="badge-s b-outline" title="Auto-created from an approved Repair/Damage request">System-generated</span>
                    }
                  </td>
                  <td class="mono r">{{ m.cost ? formatMoney(m.cost) : '—' }}</td>
                  <td class="mono">{{ m.next_due_date ?? '—' }}</td>
                  <td>
                    @if (m.maintenance_status) {
                      <span class="badge-s {{ badgeClass(m.maintenance_status) }}">{{ humanizeEnum(m.maintenance_status) }}</span>
                    } @else {
                      —
                    }
                  </td>
                  <td>{{ m.serviced_by_vendor_id ? refData.label(VENDOR_REF, m.serviced_by_vendor_id) : '—' }}</td>
                  <td>
                    @if (canAdd() && !showForm()) {
                      <a class="link" (click)="startEdit(m)">Edit</a>
                    }
                  </td>
                </tr>
              }
              @if (!entries().length) {
                <tr><td colspan="7" class="cell-sub">No maintenance entries yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class AssetMaintenanceLogComponent implements OnInit {
  readonly assetId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly VENDOR_REF = VENDOR_REF;
  protected readonly formatMoney = formatMoney;
  protected readonly humanizeEnum = humanizeEnum;
  protected readonly badgeClass = badgeClass;

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly entries = signal<readonly AssetMaintenanceRow[]>([]);

  protected readonly showForm = signal(false);
  protected readonly submitting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
  }

  protected canAdd(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  private load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<AssetMaintenanceRow[]>(`${environment.apiBaseUrl}/assets/${this.assetId()}/maintenance`).subscribe({
      next: (rows) => {
        this.entries.set(rows);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load the maintenance log.');
        this.isLoading.set(false);
      },
    });
  }

  protected startAdd(): void {
    this.editingId.set(null);
    this.form = { log_date: '', description: '', cost: null, next_due_date: null, serviced_by_vendor_id: null };
    this.actionError.set(null);
    this.showForm.set(true);
  }

  protected startEdit(row: AssetMaintenanceRow): void {
    this.editingId.set(row.id);
    this.form = {
      log_date: row.log_date, description: row.description, cost: row.cost,
      next_due_date: row.next_due_date, serviced_by_vendor_id: row.serviced_by_vendor_id,
    };
    this.actionError.set(null);
    this.showForm.set(true);
  }

  protected submit(): void {
    if (!this.form['log_date'] || !this.form['description']) {
      this.actionError.set('Service Date and Description are both required.');
      return;
    }
    this.submitting.set(true);
    this.actionError.set(null);
    const body = {
      log_date: this.form['log_date'],
      description: this.form['description'],
      cost: this.form['cost'] || null,
      next_due_date: this.form['next_due_date'] || null,
      serviced_by_vendor_id: this.form['serviced_by_vendor_id'] || null,
    };
    const id = this.editingId();
    const req = id
      ? this.http.put(`${environment.apiBaseUrl}/assets/${this.assetId()}/maintenance/${id}`, body)
      : this.http.post(`${environment.apiBaseUrl}/assets/${this.assetId()}/maintenance`, body);
    req.subscribe({
      next: () => {
        this.submitting.set(false);
        this.showForm.set(false);
        this.editingId.set(null);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        const detail = err?.error?.detail;
        this.actionError.set(
          typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to save this entry.',
        );
      },
    });
  }
}
