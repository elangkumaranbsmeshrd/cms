import { HttpClient } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { ArrayFieldConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';
import { taxHeadWriteBody } from './taxes.list.config';

/** §6a — the standalone Slab Bands / Split Components / Relief Rules
 * screens (masters.taxes.slab / .split / .relief in the prototype),
 * reached from a button on an EXISTING Tax Head's edit page
 * (taxes.form.config.ts's `recordActions`). One component, not three,
 * driven by a per-screen ArrayFieldConfig<TaxHeadRow> (taxes.slab-bands.
 * config.ts etc.) supplied via route resolver — see masters.routes.ts,
 * where these are wired as manual routes rather than screenRoute(), the
 * same "none of the 14 generic shapes fit" reasoning holidays-import.
 * component.ts's own doc comment gives.
 *
 * Why this still round-trips the WHOLE Tax Head on save, not just one
 * array: masters_taxes.py has no independent CRUD for a single slab band —
 * update_tax_head only ever deletes-and-reinserts an entire child
 * collection as part of PUTting the full head (see that router's own
 * docstring), because the arithmetic-lock gate and the whole-set
 * contiguous-band validation both need to see every row at once, not one
 * at a time. Rebuilding that as real per-row endpoints would mean
 * relocating validated, previously-bug-fixed business logic — a much
 * larger, riskier change than what this screen actually needs to do
 * (present the SAME data on its own page instead of an inline table on a
 * 26-field form). So: load the parent row the same way FormScreenComponent's
 * own edit mode already does (GET the list, find by id), edit ONE array,
 * PUT the full reconstructed body (taxHeadWriteBody) back unchanged except
 * for that one array — functionally identical to editing it inline, just a
 * different page.
 */
/** The one column on these three screens whose editable value is NOT the
 * column the API stores. Split Components' Condition is a `condition_rule`
 * JSON object server-side ({description: '…'} — §3.2c's "simple comparison,
 * not a rule builder"), and ArrayColumnConfig can only bind a plain scalar,
 * so taxes.split-components.config.ts binds `condition_text` and this
 * component mirrors the two around the request. Named here rather than
 * hardcoded at each use so the pairing is stated once. */
const CONDITION_TEXT_COLUMN = 'condition_text';
const CONDITION_RULE_COLUMN = 'condition_rule';

@Component({
  selector: 'app-tax-head-child-screen',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ config().label.split(' — ')[0] }}</h1>
        <p class="page-sub">
          @if (headRow(); as h) {
            For "{{ h.tax_name }}". {{ config().label.split(' — ')[1] }}
          } @else {
            {{ config().label.split(' — ')[1] }}
          }
        </p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this record</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>{{ config().label.split(' — ')[0] }}</h3>
          @if (canEdit()) {
            <button class="btn sm ghost" type="button" (click)="addRow()">+ Add Row</button>
          }
        </div>
        <div class="card-body table-wrap">
          <table>
            <thead>
              <tr>
                @for (col of config().columns; track col.key) {
                  <th>{{ col.label }}</th>
                }
                @if (canEdit()) {
                  <th></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track $index) {
                <tr>
                  @for (col of config().columns; track col.key) {
                    <td>
                      @if (!canEdit()) {
                        {{ item[col.key] ?? '—' }}
                      } @else if (col.type === 'select') {
                        <select class="input" [(ngModel)]="item[col.key]">
                          <option [value]="null">—</option>
                          @for (opt of col.staticOptions ?? []; track opt.value) {
                            <option [value]="opt.value">{{ opt.label }}</option>
                          }
                        </select>
                      } @else if (col.type === 'checkbox') {
                        <span class="toggle" [class.on]="!!item[col.key]" (click)="item[col.key] = !item[col.key]">
                          <span class="track"></span>
                        </span>
                      } @else {
                        <input
                          class="input"
                          [type]="col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'"
                          [(ngModel)]="item[col.key]"
                        />
                      }
                    </td>
                  }
                  @if (canEdit()) {
                    <td><button class="btn sm ghost" type="button" (click)="removeRow($index)">Remove</button></td>
                  }
                </tr>
              }
              @if (items().length === 0) {
                <tr><td [attr.colspan]="config().columns.length + 1" class="cell-sub">No rows yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="card-foot">
          @if (!canEdit()) {
            <span class="hint" style="margin-right: auto;">You don't have access to edit this screen.</span>
            <button class="btn ghost" type="button" (click)="cancel()">Close</button>
          } @else {
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class TaxHeadChildScreenComponent {
  readonly config = input.required<ArrayFieldConfig<TaxHeadRow>>();

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly headRow = signal<TaxHeadRow | null>(null);
  protected readonly items = signal<Record<string, unknown>[]>([]);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loadError.set('No Tax Head id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<TaxHeadRow[]>(`${environment.apiBaseUrl}/masters/taxes`).subscribe({
      next: (rows) => {
        const row = rows.find((r) => r.id === id);
        if (!row) {
          this.loadError.set('This Tax Head could not be found.');
        } else {
          this.headRow.set(row);
          // This component is only ever routed to with a config keyed on one
          // of the three object-row arrays (slab_bands/split_components/
          // relief_rules) — never withholding_directions (a string[], the
          // one other array TaxHeadRow carries) — but `keyof TaxHeadRow`
          // itself doesn't encode that narrower guarantee, hence the cast.
          const arr = (row as unknown as Record<string, unknown>)[this.config().key] as Record<string, unknown>[] | undefined;
          this.items.set(Array.isArray(arr) ? structuredClone(arr).map((item) => this.hydrate(item)) : []);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this record.');
        this.isLoading.set(false);
      },
    });
  }

  protected canEdit(): boolean {
    return this.policy.can('masters.taxes', 'edit');
  }

  /** Loaded row -> what the table edits: unwrap condition_rule's description
   * into the bound `condition_text` cell. Without this an existing
   * conditional split component showed an EMPTY Condition, since the server
   * never sends a condition_text at all. No-op on the two screens whose
   * config declares no such column. */
  private hydrate(item: Record<string, unknown>): Record<string, unknown> {
    if (!this.hasConditionColumn()) return item;
    const rule = item[CONDITION_RULE_COLUMN] as { description?: unknown } | null | undefined;
    return { ...item, [CONDITION_TEXT_COLUMN]: rule?.description == null ? '' : String(rule.description) };
  }

  /** The reverse, applied to every row on the way out: what was typed into
   * the Condition cell becomes the condition_rule the API stores. Rebuilt
   * from the text on EVERY save (not only on rows added this session), which
   * is what makes editing an existing condition actually persist. */
  private dehydrate(item: Record<string, unknown>): Record<string, unknown> {
    if (!this.hasConditionColumn()) return item;
    const text = String(item[CONDITION_TEXT_COLUMN] ?? '').trim();
    return { ...item, [CONDITION_RULE_COLUMN]: text ? { description: text } : null };
  }

  private hasConditionColumn(): boolean {
    return this.config().columns.some((c) => c.key === CONDITION_TEXT_COLUMN);
  }

  protected addRow(): void {
    this.items.update((rows) => [...rows, this.config().emptyItem()]);
  }

  protected removeRow(index: number): void {
    this.items.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected save(): void {
    const head = this.headRow();
    if (!head) return;
    this.saving.set(true);
    this.saveError.set(null);
    const body = { ...taxHeadWriteBody(head), [this.config().key]: this.items().map((item) => this.dehydrate(item)) };
    this.http.put(`${environment.apiBaseUrl}/masters/taxes/${head.id}`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/masters/taxes', head.id, 'edit']);
      },
      error: (err) => {
        this.saving.set(false);
        const detail = err?.error?.detail;
        this.saveError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to save changes.');
      },
    });
  }

  protected cancel(): void {
    const head = this.headRow();
    this.router.navigate(head ? ['/masters/taxes', head.id, 'edit'] : ['/masters/taxes']);
  }
}
