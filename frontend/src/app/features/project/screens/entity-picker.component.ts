import { Component, computed, input, output, signal } from '@angular/core';

/** Reusable live, searchable multi-select checkbox list over a caller-supplied
 * option array — the same gap payroll.employee-picker.component.ts's own doc
 * comment identifies: FormScreenConfig's 'checkgroup' field type only renders
 * fixed, config-authored staticOptions, never a live-fetched list. Needed
 * three times in this module (Add/Edit Project's Team Members, Milestone's
 * Linked Tasks, Sprint's "Update Sprint" task assignment) with three
 * different option sources (employees, this project's tasks) — so unlike
 * PayrollEmployeePickerComponent (which owns its own employee fetch), this
 * one takes `options` from the HOST, which already has to fetch project- or
 * employee-scoped data anyway for other reasons on the same screen. Not
 * reused directly from features/payroll/ — modules stay in their own folders
 * per this build's own ground rules, so this is a deliberate, small
 * re-implementation of the same pattern rather than a cross-module import.
 *
 * Plain input()/output(), not model() two-way sugar — same reasoning as the
 * payroll picker's own doc comment: the host keeps selected ids in its own
 * typed field and folds them into the request body at submit time.
 */
@Component({
  selector: 'app-entity-picker',
  standalone: true,
  imports: [],
  template: `
    @if (searchable()) {
      <input class="input" type="search" [placeholder]="searchPlaceholder()" [value]="query()" (input)="query.set($any($event.target).value)" />
    }
    <div style="max-height: 240px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px; margin-top: 8px;">
      @if (!options().length) {
        <p class="cell-sub" style="padding: 8px;">{{ emptyText() }}</p>
      } @else if (!filtered().length) {
        <p class="cell-sub" style="padding: 8px;">No matches for this search.</p>
      } @else {
        @for (opt of filtered(); track opt.id) {
          <label style="display: flex; align-items: center; gap: 7px; padding: 5px 7px; border-radius: var(--r-sm); font-size: 12.5px; cursor: pointer;">
            <input type="checkbox" [checked]="isSelected(opt.id)" (change)="toggle(opt.id)" />
            <span>{{ opt.label }}</span>
          </label>
        }
      }
    </div>
    <div class="hint" style="margin-top: 6px;">{{ selectedIds().length }} of {{ options().length }} selected.</div>
  `,
})
export class EntityPickerComponent {
  /** The live-fetched option source — owned and fetched by the host. */
  readonly options = input.required<readonly { id: string; label: string }[]>();
  /** Current selection, owned by the host. */
  readonly selectedIds = input<readonly string[]>([]);
  readonly searchable = input(true);
  readonly searchPlaceholder = input('Search…');
  readonly emptyText = input('No options available.');
  /** Fired with the FULL next selection on every toggle — mirrors every
   * RowActionDef/SecondaryActionDef "hand back the whole next state" pattern
   * already used elsewhere, rather than emitting deltas. */
  readonly selectionChange = output<readonly string[]>();

  protected readonly query = signal('');

  protected readonly filtered = computed<readonly { id: string; label: string }[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.options();
    if (!q) return all;
    return all.filter((o) => o.label.toLowerCase().includes(q));
  });

  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected toggle(id: string): void {
    const cur = this.selectedIds();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.selectionChange.emit(next);
  }
}
