import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { ASSET_STATUS_OPTIONS } from '../../asset/asset.api';

interface AssignedAssetRow {
  readonly id: string;
  readonly asset_tag: string;
  readonly name: string;
  readonly category_id: string;
  // §2.10 wants a Status column (In Use / Under Repair) — a real AssetOut
  // field (AssetOut.status), just missing from this row shape until now.
  // Distinct from the record tab's read-only "Condition" label, which has
  // no backing column anywhere on Asset (see emp.record.config.ts's own
  // Assigned Assets tab, unaffected by this).
  readonly status: string;
}

interface AssetRequestRow {
  readonly id: string;
  readonly asset_id: string;
  readonly request_type: string;
  readonly description: string;
  readonly status: string;
  readonly approved_by: string | null;
  readonly rejection_reason: string | null;
}

const REQUEST_TYPE_OPTIONS = [
  { value: 'REPAIR', label: 'Repair' },
  { value: 'DAMAGE_REPORT', label: 'Damage Report' },
  { value: 'RETURN', label: 'Return' },
];

const CATEGORY_REF = { endpoint: '/masters/asset-categories/options', labelKey: 'label' };

/** §2.10 My Assets (employee.my_assets) — assigned-assets list (with
 * Category/Status filters, Status column) + Raise Request form + request
 * history. Both list endpoints are real /me aliases (assets.py), no
 * employee-id resolution needed. §2.10's own "Condition" column has no
 * backing column anywhere on Asset (Status — In Use/Under Repair — is the
 * real, closest field, shown here instead), and "Assigned Date" is
 * filterable server-side (assigned_date_from/to, joined against
 * AssetAssignmentHistory) but never returned as a plain row field to
 * display — both confirmed, pre-existing backend gaps (same ones
 * emp.assigned-assets.list.config.ts already documents), not something
 * this screen invents around.
 */
@Component({
  selector: 'app-my-assets',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Assets</h1>
        <p class="page-sub">Assets currently assigned to you.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      <div class="filterbar" style="margin-bottom: 12px;">
        <div class="filter-row">
          <select class="input" style="width: auto;" [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event)">
            <option [ngValue]="null">All Categories</option>
            @for (c of categories(); track c.id) {
              <option [value]="c.id">{{ c.label }}</option>
            }
          </select>
          <select class="input" style="width: auto;" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
            <option [ngValue]="null">All Statuses</option>
            @for (s of STATUS_OPTIONS; track s.value) {
              <option [value]="s.value">{{ s.label }}</option>
            }
          </select>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset Tag</th>
                <th>Asset Name</th>
                <th>Category</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (a of filteredAssets(); track a.id) {
                <tr>
                  <td class="mono">{{ a.asset_tag }}</td>
                  <td class="cell-strong">{{ a.name }}</td>
                  <td>{{ refData.label(CATEGORY_REF, a.category_id) }}</td>
                  <td><span class="badge-s" [class.b-ok]="a.status === 'IN_USE'" [class.b-warn]="a.status === 'UNDER_REPAIR'">{{ statusLabel(a.status) }}</span></td>
                  <td><button class="btn sm ghost" type="button" (click)="startRequest(a)">Raise Request</button></td>
                </tr>
              }
              @if (!filteredAssets().length) {
                <tr><td colspan="5" class="cell-sub">No assets are currently assigned to you.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      @if (showRequestForm(); as target) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Raise Request — {{ target.name }} ({{ target.asset_tag }})</h3></div>
          <div class="card-body">
            @if (requestError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ requestError() }}</div>
            }
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Request Type</div>
                <select class="input" [(ngModel)]="requestForm['request_type']">
                  @for (t of REQUEST_TYPE_OPTIONS; track t.value) {
                    <option [value]="t.value">{{ t.label }}</option>
                  }
                </select>
              </div>
              <div></div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Description</div>
                <textarea class="input" rows="3" [(ngModel)]="requestForm['description']"></textarea>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submittingRequest()" (click)="showRequestForm.set(null)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submittingRequest()" (click)="submitRequest()">
              {{ submittingRequest() ? 'Submitting…' : 'Submit Request' }}
            </button>
          </div>
        </div>
      }

      <div class="card">
        <div class="card-head"><h3>My Requests</h3></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Description</th>
                <th>Status</th>
                <th>Rejection Reason</th>
              </tr>
            </thead>
            <tbody>
              @for (r of requests(); track r.id) {
                <tr>
                  <td class="mono">{{ assetTag(r.asset_id) }}</td>
                  <td>{{ typeLabel(r.request_type) }}</td>
                  <td>{{ r.description }}</td>
                  <td>
                    <span class="badge-s" [class.b-warning]="r.status === 'PENDING'" [class.b-success]="r.status === 'APPROVED'" [class.b-danger]="r.status === 'REJECTED'">{{ r.status }}</span>
                  </td>
                  <td>{{ r.rejection_reason ?? '—' }}</td>
                </tr>
              }
              @if (!requests().length) {
                <tr><td colspan="5" class="cell-sub">No requests raised yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class MyAssetsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly refData = inject(RefDataService);

  protected readonly REQUEST_TYPE_OPTIONS = REQUEST_TYPE_OPTIONS;
  protected readonly STATUS_OPTIONS = ASSET_STATUS_OPTIONS;
  protected readonly CATEGORY_REF = CATEGORY_REF;

  protected readonly isLoading = signal(true);
  protected readonly assets = signal<readonly AssignedAssetRow[]>([]);
  protected readonly requests = signal<readonly AssetRequestRow[]>([]);

  // §2.10 filters: Category / Status. my_assets() (assets.py) takes a real
  // category_id query param, but no status= at all — client-side filtering
  // for Status keeps both filters on the same footing rather than one
  // round-tripping the server and the other silently only working locally.
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly statusFilter = signal<string | null>(null);
  protected readonly categories = computed(() => this.refData.options(CATEGORY_REF) ?? []);
  protected readonly filteredAssets = computed(() => {
    const category = this.categoryFilter();
    const status = this.statusFilter();
    return this.assets().filter((a) => (!category || a.category_id === category) && (!status || a.status === status));
  });

  protected readonly showRequestForm = signal<AssignedAssetRow | null>(null);
  protected readonly submittingRequest = signal(false);
  protected readonly requestError = signal<string | null>(null);
  protected requestForm: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
  }

  protected typeLabel(v: string): string {
    return REQUEST_TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
  }

  protected statusLabel(v: string): string {
    return ASSET_STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
  }

  protected assetTag(id: string): string {
    return this.assets().find((a) => a.id === id)?.asset_tag ?? id.slice(0, 8);
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<AssignedAssetRow[]>(`${environment.apiBaseUrl}/employees/me/assets`).subscribe({
      next: (rows) => {
        this.assets.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
    this.http.get<AssetRequestRow[]>(`${environment.apiBaseUrl}/employees/me/asset-requests`).subscribe({
      next: (rows) => this.requests.set(rows),
      error: () => this.requests.set([]),
    });
  }

  protected startRequest(asset: AssignedAssetRow): void {
    this.requestForm = { asset_id: asset.id, request_type: 'REPAIR', description: '' };
    this.requestError.set(null);
    this.showRequestForm.set(asset);
  }

  protected submitRequest(): void {
    if (!this.requestForm['description']) {
      this.requestError.set('Description is required.');
      return;
    }
    this.submittingRequest.set(true);
    this.requestError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/me/asset-requests`, this.requestForm).subscribe({
      next: () => {
        this.submittingRequest.set(false);
        this.showRequestForm.set(null);
        this.load();
      },
      error: (err) => {
        this.submittingRequest.set(false);
        const detail = err?.error?.detail;
        this.requestError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to submit.');
      },
    });
  }
}
