import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { EmployeePickerRow } from '../payroll.api';

/** Reusable live, searchable multi-select of employees — Run Payroll's
 * "Specific Employees" mode and Ad-hoc Adjustments' "Multiple Employees" mode
 * both need exactly this control, and there is no existing precedent for it
 * anywhere in this codebase: FormScreenConfig's 'checkgroup' field type only
 * renders fixed, config-authored `staticOptions`, never a live-fetched list
 * (see screen.types.ts's own FieldType doc). Built once here and used in
 * both places rather than written twice.
 *
 * Backed by GET /employees?employment_status=ACTIVE, labelled first_name/
 * last_name — same convention as every other Employee ref in this module.
 *
 * Deliberately plain input()/output(), not Angular's model() two-way sugar:
 * no component anywhere in this codebase yet uses model()/output() (grepped
 * — every existing input()-taking component is one-way, host-owns-the-data),
 * and the two call sites here would each bind this against one key of a
 * loosely-typed `Record<string, unknown>` form bag, which strictTemplates
 * cannot reconcile against a strict `readonly string[]` two-way model target
 * without an unsafe cast. A plain `(selectionChange)="onIdsChange($event)"`
 * listener sidesteps that entirely — the host keeps selected ids in their
 * own dedicated typed field (mirroring leave.comp-hours-apply.component.ts's
 * `shortfallId` sitting beside its own loose `form` bag) and folds them into
 * the POST body only at submit time.
 */
@Component({
  selector: 'app-payroll-employee-picker',
  standalone: true,
  imports: [],
  template: `
    <input
      class="input"
      type="search"
      placeholder="Search employees by name or code…"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
    />
    <div style="max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px; margin-top: 8px;">
      @if (isLoading()) {
        <p class="cell-sub" style="padding: 8px;">Loading active employees…</p>
      } @else if (loadError()) {
        <p class="cell-sub" style="padding: 8px; color: var(--danger);">{{ loadError() }}</p>
      } @else if (!filtered().length) {
        <p class="cell-sub" style="padding: 8px;">No active employees match this search.</p>
      } @else {
        @for (emp of filtered(); track emp.id) {
          <label style="display: flex; align-items: center; gap: 7px; padding: 5px 7px; border-radius: var(--r-sm); font-size: 12.5px; cursor: pointer;">
            <input type="checkbox" [checked]="isSelected(emp.id)" (change)="toggle(emp.id)" />
            <span>{{ emp.first_name }} {{ emp.last_name ?? '' }}</span>
            <span class="cell-sub" style="margin-left: auto;">{{ emp.employee_code }}</span>
          </label>
        }
      }
    </div>
    <div class="hint" style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
      <span>{{ selectedIds().length }} of {{ employees().length }} active employee(s) selected.</span>
      <span style="display: flex; gap: 12px;">
        <span class="link" role="button" (click)="selectAllFiltered()">Select all filtered</span>
        <span class="link" role="button" (click)="clearSelection()">Clear</span>
      </span>
    </div>
  `,
})
export class PayrollEmployeePickerComponent implements OnInit {
  /** Current selection, owned by the host. */
  readonly selectedIds = input<readonly string[]>([]);
  /** Fired with the FULL next selection on every toggle/select-all/clear —
   * the host just assigns this straight over its own field, mirroring every
   * RowActionDef/SecondaryActionDef "hand back the whole next state" pattern
   * already used elsewhere in this codebase rather than emitting deltas. */
  readonly selectionChange = output<readonly string[]>();

  private readonly http = inject(HttpClient);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly employees = signal<readonly EmployeePickerRow[]>([]);
  protected readonly query = signal('');

  protected readonly filtered = computed<readonly EmployeePickerRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.employees();
    if (!q) return all;
    return all.filter((e) => `${e.first_name} ${e.last_name ?? ''} ${e.employee_code}`.toLowerCase().includes(q));
  });

  ngOnInit(): void {
    this.http.get<EmployeePickerRow[]>(`${environment.apiBaseUrl}/employees`, { params: { employment_status: 'ACTIVE' } }).subscribe({
      next: (rows) => {
        this.employees.set(rows);
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set('Could not load the employee list.');
        this.isLoading.set(false);
      },
    });
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected toggle(id: string): void {
    const cur = this.selectedIds();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.selectionChange.emit(next);
  }

  protected selectAllFiltered(): void {
    const ids = new Set(this.selectedIds());
    for (const e of this.filtered()) ids.add(e.id);
    this.selectionChange.emit([...ids]);
  }

  protected clearSelection(): void {
    this.selectionChange.emit([]);
  }
}
