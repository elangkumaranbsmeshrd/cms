import { Component, inject, input } from '@angular/core';

import { FieldConfig, FieldSection } from '../screen.types';
import { RefDataService } from '../ref-data.service';

/** The read-only half of record-screen.component.ts's own 'fields' tab
 * rendering (title + a label/value grid, grouped into sections), pulled out
 * so TabbedScreenComponent's 'fields'/'static' tab kinds (§4,
 * MASTERS-COMPLETION-PROMPT.md) render identically rather than re-implementing
 * the same grid a second time. Read-only only — a tab using this shape has no
 * edit affordance at all, matching what Work Week's Daily Hours/Compensation
 * and Where Used actually are in the prototype (plain re-displays, no form).
 */
@Component({
  selector: 'app-field-grid',
  standalone: true,
  template: `
    <div class="card">
      <div class="card-body">
        @for (section of sections(); track section.title) {
          <h3 style="margin: 0 0 10px; font-size: 12.5px;">{{ section.title }}</h3>
          <div class="grid g-2" style="margin-bottom: 18px;">
            @for (field of section.fields; track field.key) {
              <div [style.grid-column]="field.span === 2 ? 'span 2' : null">
                <div class="cell-sub" style="margin-bottom: 2px;">{{ field.label }}</div>
                <div>{{ fieldValue(field) }}</div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class FieldGridComponent<T = Record<string, unknown>> {
  readonly row = input<T | null>(null);
  readonly sections = input.required<readonly FieldSection<T>[]>();
  private readonly refData = inject(RefDataService);

  protected fieldValue(field: FieldConfig<T>): unknown {
    const r = this.row();
    const value = field.compute ? field.compute(r as T) : r ? r[field.key] : undefined;
    if (field.ref) return this.refData.label(field.ref, value as string | null | undefined);
    return value === null || value === undefined || value === '' ? '—' : value;
  }
}
