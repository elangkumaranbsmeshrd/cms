import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { formatDate, humanizeEnum } from '../../../shared/screens/cell-format';
import { TaxHeadRow } from '../masters.api';
import { SCOPE_OPTIONS, TAX_TYPE_OPTIONS } from './taxes.form.config';

/** POST /masters/taxes/calculate's response (TaxCalculationResponse,
 * app/schemas/masters.py). Decimals arrive as JSON strings, hence `unknown`
 * on every figure and one `money()` at the point of display. */
interface CalculationResult {
  readonly tax_head_id: string;
  readonly label: string;
  readonly base_amount: unknown;
  readonly gross_amount: unknown;
  readonly computed_amount: unknown;
  readonly components: readonly { component_name: string; amount: unknown }[];
  readonly slab_breakdown: readonly { sequence_no: number; base_in_band: unknown; amount: unknown }[];
  readonly reliefs_applied: readonly { relief_name: string; relief_applied: unknown }[];
}

// QUEUED / NOT DEPLOYMENT-CONFIGURABLE — the '₹' and 'en-IN' below are
// literals, the same app-wide currency gap already documented in full at
// cell-format.ts (formatMoney's own header) and taxes.list.config.ts. The
// shared formatMoney() is deliberately NOT used here even though it exists:
// it rounds to whole rupees, which is right for a column of figures being
// scanned and wrong for a calculator whose entire purpose is to show that a
// rate produces the number the person expected — ₹2.50 must not read ₹3.
// When a currency setting exists on Company Profile and formatMoney() reads
// from it, this helper should follow it too, keeping the decimals.
function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function optionLabel(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? humanizeEnum(value);
}

/**
 * Masters §3.2's "live worked example", which the Screen Design puts beside
 * the Add Tax form: "Enter a test base figure and the screen shows what this
 * head would deduct or charge on it, including slab-by-slab working, split
 * components, ceilings, and relief. This is deliberately prominent: the
 * person entering a tax is being asked to describe a calculation in the
 * abstract, and the fastest way to catch a wrong ceiling, an inverted slab,
 * or a mis-set Borne By is to see one number come out wrong before it
 * reaches a payslip."
 *
 * `POST /masters/taxes/calculate` has existed since the engine was built
 * (masters_taxes.py, whose own docstring names this screen as what it
 * drives) and nothing in the frontend called it — the worked example was the
 * one part of §3.2's Screen Design with no UI at all.
 *
 * Why it is a screen of its own rather than a panel inside the Add form: the
 * endpoint takes a `tax_head_id`, so it can only ever calculate a head that
 * has been SAVED. A panel beside the create form would have nothing to send
 * until the first save. Reached instead from a button on an existing head —
 * the same §6a pattern Slab Bands / Split Components / Relief Rules already
 * use (see tax-head-child-screen.component.ts), and the same page a rate
 * change is checked from.
 *
 * Read-only, and deliberately available to every role that can open Taxes at
 * all: the endpoint's own guard is plain `require_screen(SCREEN)` with no
 * action, and §3.0's stated reason for Accountant's view here is exactly
 * this — "so payroll and invoice figures can be sanity-checked against the
 * tax heads that produced them".
 */
@Component({
  selector: 'app-tax-head-worked-example',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Worked Example</h1>
        <p class="page-sub">
          @if (headRow(); as h) {
            What "{{ h.tax_name }}" ({{ typeLabel(h) }}, {{ scopeLabel(h) }}) would charge or deduct on a test figure.
            Nothing here is saved.
          } @else {
            What this tax head would charge or deduct on a test figure. Nothing here is saved.
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
      <div class="card">
        <div class="card-head">
          <h3>Test a base figure</h3>
          <span class="sub">Recalculates as you type.</span>
        </div>
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <label for="we-base">Base Amount</label>
              <input
                id="we-base"
                class="input"
                type="number"
                aria-label="Base Amount"
                placeholder="0.00"
                [(ngModel)]="baseAmount"
                (ngModelChange)="scheduleCalculate()"
              />
              <div class="hint">
                The figure this head is applied to — an invoice line's value, or the pay component a deduction is taken
                from.
              </div>
            </div>
            <div class="field">
              <label for="we-asof">As Of</label>
              <input
                id="we-asof"
                class="input"
                type="date"
                aria-label="As Of"
                [(ngModel)]="asOf"
                (ngModelChange)="scheduleCalculate()"
              />
              <div class="hint">
                Optional. Set it to check a date against this head's Applies From / Applies Until window
                @if (headRow(); as h) {
                  ({{ formatDate(h.applies_from) }} to {{ h.applies_until ? formatDate(h.applies_until) : 'open-ended' }})
                }
                — a date outside it is refused here exactly as it would be on a real document.
              </div>
            </div>
          </div>
          @if (calcError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ calcError() }}</div>
          }
          @if (result(); as r) {
            <div class="form-section-head">
              <h4>{{ r.label }}</h4>
              <span class="note">{{ calculating() ? 'Recalculating…' : 'Read-only — nothing is saved' }}</span>
            </div>
            <div class="totals" style="margin-bottom: 18px;">
              <div class="tr"><span>Base Amount</span><b>{{ money(r.base_amount) }}</b></div>
              <!-- Gross is what the rate produces before any relief; computed is
                   what would actually be charged or deducted. They differ only
                   on a head carrying relief rules, which is precisely the case
                   §3.2 wants visible rather than inferred. -->
              <div class="tr"><span>Gross Tax</span><b>{{ money(r.gross_amount) }}</b></div>
              <div class="tr emph"><span>Computed Tax</span><b>{{ money(r.computed_amount) }}</b></div>
            </div>

            @if (r.slab_breakdown.length) {
              <div class="form-section-head"><h4>Slab-by-slab working</h4></div>
              <div class="table-wrap" style="margin-bottom: 18px;">
                <table>
                  <thead>
                    <tr><th>Band</th><th>Base Falling In This Band</th><th>Tax From This Band</th></tr>
                  </thead>
                  <tbody>
                    @for (band of r.slab_breakdown; track band.sequence_no) {
                      <tr>
                        <td class="mono">{{ band.sequence_no }}</td>
                        <td class="mono">{{ money(band.base_in_band) }}</td>
                        <td class="mono">{{ money(band.amount) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            @if (r.components.length) {
              <div class="form-section-head"><h4>Split components</h4></div>
              <div class="table-wrap" style="margin-bottom: 18px;">
                <table>
                  <thead>
                    <tr><th>Component</th><th>Amount</th></tr>
                  </thead>
                  <tbody>
                    @for (c of r.components; track c.component_name) {
                      <tr>
                        <td class="cell-strong">{{ c.component_name }}</td>
                        <td class="mono">{{ money(c.amount) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            @if (r.reliefs_applied.length) {
              <div class="form-section-head"><h4>Relief applied</h4></div>
              <div class="table-wrap" style="margin-bottom: 18px;">
                <table>
                  <thead>
                    <tr><th>Relief</th><th>Reduced The Tax By</th></tr>
                  </thead>
                  <tbody>
                    @for (relief of r.reliefs_applied; track relief.relief_name) {
                      <tr>
                        <td class="cell-strong">{{ relief.relief_name }}</td>
                        <td class="mono">{{ money(relief.relief_applied) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else if (!calcError()) {
            <div class="empty">
              <div class="ico">%</div>
              <p>Enter a base amount to see what this head would charge or deduct on it.</p>
            </div>
          }
        </div>
        <div class="card-foot">
          <span class="hint" style="margin-right: auto;">
            A preview only — this changes nothing and records nothing.
          </span>
          <button class="btn ghost" type="button" (click)="close()">Close</button>
          <button class="btn primary" type="button" [disabled]="calculating() || !hasBase()" (click)="calculate()">
            {{ calculating() ? 'Calculating…' : 'Calculate' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class TaxHeadWorkedExampleComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly headRow = signal<TaxHeadRow | null>(null);
  protected readonly calculating = signal(false);
  protected readonly calcError = signal<string | null>(null);
  protected readonly result = signal<CalculationResult | null>(null);

  protected baseAmount: number | null = null;
  protected asOf: string | null = null;

  /** Template helpers — re-exported so the markup can stay declarative. */
  protected readonly money = money;
  protected readonly formatDate = formatDate;

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loadError.set('No Tax Head id in the URL.');
      this.isLoading.set(false);
      return;
    }
    // Same load as tax-head-child-screen.component.ts, and for the same
    // reason: masters_taxes.py has no GET-by-id at all, so an existing head
    // is found in the list every other screen here already fetches.
    this.http.get<TaxHeadRow[]>(`${environment.apiBaseUrl}/masters/taxes`).subscribe({
      next: (rows) => {
        const row = rows.find((r) => r.id === id);
        if (!row) this.loadError.set('This Tax Head could not be found.');
        else this.headRow.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this record.');
        this.isLoading.set(false);
      },
    });
  }

  protected typeLabel(row: TaxHeadRow): string {
    return optionLabel(TAX_TYPE_OPTIONS, row.tax_type);
  }

  protected scopeLabel(row: TaxHeadRow): string {
    return optionLabel(SCOPE_OPTIONS, row.scope);
  }

  protected hasBase(): boolean {
    return this.baseAmount !== null && this.baseAmount !== undefined && Number.isFinite(Number(this.baseAmount));
  }

  /** "Live", per §3.2 — but not one request per keystroke: a base figure is
   * typed digit by digit, and each intermediate value is a real calculation
   * the server would have to run. */
  protected scheduleCalculate(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (!this.hasBase()) {
      this.result.set(null);
      this.calcError.set(null);
      return;
    }
    this.debounce = setTimeout(() => this.calculate(), 350);
  }

  protected calculate(): void {
    const head = this.headRow();
    if (!head || !this.hasBase()) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.calculating.set(true);
    this.calcError.set(null);
    this.http
      .post<CalculationResult>(`${environment.apiBaseUrl}/masters/taxes/calculate`, {
        tax_head_id: head.id,
        base_amount: this.baseAmount,
        // Omitted rather than sent as null when blank: the endpoint treats a
        // missing as_of as "ignore the in-force window", which is what keeps
        // a head being previewed mid-setup previewable.
        ...(this.asOf ? { as_of: this.asOf } : {}),
      })
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.calculating.set(false);
        },
        error: (err) => {
          const detail = err?.error?.detail;
          this.calcError.set(
            typeof detail === 'string'
              ? detail
              : Array.isArray(detail)
                ? detail.map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d)).join('; ')
                : 'This head could not be calculated. Check that the figures its Tax Type needs are all set.',
          );
          this.result.set(null);
          this.calculating.set(false);
        },
      });
  }

  protected close(): void {
    const head = this.headRow();
    this.router.navigate(head ? ['/masters/taxes', head.id, 'edit'] : ['/masters/taxes']);
  }
}
