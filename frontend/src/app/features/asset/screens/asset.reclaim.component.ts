import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { AssetAssignmentHistoryRow, AssetRow } from '../asset.api';

const CATEGORY_REF = { endpoint: '/masters/asset-categories' };
const SCREEN = 'asset.reclaim';

interface EmployeeNameRow {
  readonly first_name: string;
  readonly last_name: string | null;
}

/** §2.8 Reclaim on Exit (asset.reclaim) — standalone route
 * assets/reclaim/:employeeId, reached from the Employee module's own Exit
 * Checklist link (resignation.exit-checklist.config.ts's RETURN_ALL_ASSETS
 * step). GET /employees/{employee_id}/reclaim-assets has has_scope=False and
 * no team-scoping at all (HR/SA only) — lists the exiting employee's IN_USE
 * assets, returning the SAME shape as every other Asset endpoint
 * (_load_asset_out), so this reads AssetRow directly rather than a
 * Reclaim-specific row type.
 *
 * "Assigned Date" (§2.8's own column list) isn't on that response at all —
 * derived instead, one GET /assets/{id}/assignment-history per row (the same
 * real endpoint asset.assignment-history.component.ts's own Assignment
 * History tab already uses), taking the OPEN row (to_date null) for this
 * employee. Fired in parallel via forkJoin (same pattern as project.sprint-
 * tasks.component.ts's own multi-fetch), each wrapped in catchError so one
 * asset with no readable history doesn't blank the whole column.
 *
 * A plain top-level ROUTED component (loadComponent on the Route, not a
 * RecordComponentTab), so the id comes from ActivatedRoute like every other
 * top-level bespoke route in this app (rbac.matrix.component.ts's own
 * :roleCode), not an input().
 */
@Component({
  selector: 'app-asset-reclaim',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Reclaim Assets on Exit</h1>
        <p class="page-sub">{{ employeeName() ? 'Assets currently assigned to ' + employeeName() + '.' : 'Assets currently assigned to this employee.' }}</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this list</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset Tag</th>
                <th>Name</th>
                <th>Category</th>
                <th>Assigned Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (a of assets(); track a.id) {
                <tr>
                  <td class="mono">{{ a.asset_tag }}</td>
                  <td class="cell-strong">{{ a.name }}</td>
                  <td>{{ refData.label(CATEGORY_REF, a.category_id) }}</td>
                  <td class="mono">{{ assignedDates().get(a.id) ?? '—' }}</td>
                  <td style="white-space: nowrap;">
                    @if (canMarkReturned() && markingId() !== a.id) {
                      <button class="btn sm ghost" type="button" (click)="startMark(a)">Mark Returned</button>
                    }
                  </td>
                </tr>
                @if (markingId() === a.id) {
                  <tr>
                    <td colspan="5">
                      <div class="card" style="margin: 8px 0;">
                        <div class="card-body">
                          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                              <input type="radio" name="condition-{{ a.id }}" [checked]="markForm['working_condition'] === true" (change)="setCondition(true)" />
                              Returned, working condition
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                              <input type="radio" name="condition-{{ a.id }}" [checked]="markForm['working_condition'] === false" (change)="setCondition(false)" />
                              Not working / damaged
                            </label>
                          </div>
                          @if (markForm['working_condition'] === false) {
                            <div>
                              <div class="cell-sub">Reason (required)</div>
                              <textarea class="input" rows="2" [(ngModel)]="markForm['reason']"></textarea>
                              <div class="cell-sub" style="margin-top: 4px;">Retired Date will be recorded as today automatically.</div>
                            </div>
                          }
                        </div>
                        <div class="card-foot">
                          <button class="btn ghost" type="button" [disabled]="submitting()" (click)="markingId.set(null)">Cancel</button>
                          <button class="btn primary" type="button" [disabled]="submitting()" (click)="submitMark(a)">
                            {{ submitting() ? 'Submitting…' : 'Confirm' }}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                }
              }
              @if (!assets().length) {
                <tr><td colspan="5" class="cell-sub">This employee has no assets currently assigned.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class AssetReclaimComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly CATEGORY_REF = CATEGORY_REF;

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly assets = signal<readonly AssetRow[]>([]);
  protected readonly employeeName = signal<string | null>(null);
  // asset id -> from_date of this employee's still-open assignment-history
  // row (to_date null). Populated after the asset list loads; a missing key
  // (fetch failed, or genuinely no open row) renders as '—', never blocks
  // the rest of the screen. A Map, not a Record — Map.get() is correctly
  // typed as `string | undefined` for a possibly-absent key regardless of
  // this project's tsconfig noUncheckedIndexedAccess setting, unlike a plain
  // indexed Record lookup (was flagged NG8102 "?? has no effect" by the
  // template checker, since it trusted the Record's value type alone rather
  // than the real possibly-missing-key runtime behaviour).
  protected readonly assignedDates = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly markingId = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected markForm: Record<string, unknown> = {};

  private employeeId(): string {
    return this.route.snapshot.paramMap.get('employeeId') ?? '';
  }

  ngOnInit(): void {
    this.load();
    // Display-only, best-effort — the employee's name is not part of the
    // reclaim-assets response itself (that endpoint returns raw AssetRow
    // objects), and a failed fetch here degrades to the generic subtitle
    // rather than blocking the whole screen.
    this.http.get<EmployeeNameRow>(`${environment.apiBaseUrl}/employees/${this.employeeId()}`).subscribe({
      next: (row) => this.employeeName.set(`${row.first_name} ${row.last_name ?? ''}`.trim()),
      error: () => this.employeeName.set(null),
    });
  }

  protected canMarkReturned(): boolean {
    return this.policy.can(SCREEN, 'mark_returned');
  }

  private load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<AssetRow[]>(`${environment.apiBaseUrl}/employees/${this.employeeId()}/reclaim-assets`).subscribe({
      next: (rows) => {
        this.assets.set(rows);
        this.isLoading.set(false);
        this.loadAssignedDates(rows);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this list.');
        this.isLoading.set(false);
      },
    });
  }

  // §2.8's own "Assigned Date" column — not on AssetRow, derived from each
  // asset's real assignment-history (GET /assets/{id}/assignment-history,
  // the same endpoint the Assignment History tab uses), taking the OPEN row
  // (to_date null) for the employee being exited.
  private loadAssignedDates(rows: readonly AssetRow[]): void {
    if (!rows.length) return;
    const empId = this.employeeId();
    forkJoin(
      rows.map((a) =>
        this.http.get<AssetAssignmentHistoryRow[]>(`${environment.apiBaseUrl}/assets/${a.id}/assignment-history`).pipe(catchError(() => of([] as AssetAssignmentHistoryRow[]))),
      ),
    ).subscribe((histories) => {
      const dates = new Map<string, string>();
      rows.forEach((a, i) => {
        const open = histories[i]?.find((h) => h.employee_id === empId && h.to_date === null);
        if (open) dates.set(a.id, open.from_date);
      });
      this.assignedDates.set(dates);
    });
  }

  protected startMark(asset: AssetRow): void {
    this.markForm = { working_condition: true, reason: '' };
    this.actionError.set(null);
    this.markingId.set(asset.id);
  }

  protected setCondition(working: boolean): void {
    this.markForm['working_condition'] = working;
  }

  protected submitMark(asset: AssetRow): void {
    const working = this.markForm['working_condition'] === true;
    if (!working && !String(this.markForm['reason'] ?? '').trim()) {
      this.actionError.set('A reason is required when marking an asset Not Working / Damaged.');
      return;
    }
    this.submitting.set(true);
    this.actionError.set(null);
    const body = { working_condition: working, reason: working ? null : this.markForm['reason'] };
    this.http.post(`${environment.apiBaseUrl}/assets/${asset.id}/reclaim`, body).subscribe({
      next: () => {
        this.submitting.set(false);
        this.markingId.set(null);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.actionError.set(err?.error?.detail ?? 'Failed to record this.');
      },
    });
  }
}
