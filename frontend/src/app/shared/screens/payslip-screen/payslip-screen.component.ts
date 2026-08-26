import { HttpClient, HttpResponse } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { BreadcrumbService } from '../../../core/navigation/breadcrumb.service';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { badgeClass, formatMoney } from '../cell-format';
import { PayslipLineItem, PayslipReissueRow, PayslipScreenConfig } from '../screen.types';

/** The prototype's document shape (R.payslip, app-screens2.js:1031) — NOT a
 * generic record. An identity header (employee, pay period, credit date), an
 * Earnings card and a Deductions card, a Reissue History card, and three
 * page-head actions: Download PDF, Download Salary Certificate, Reissue.
 *
 * §6 "no tax may be named in code": the backend already keeps every deduction
 * row generic — PayslipOut.statutory_lines carries one row per applicable tax
 * head with its own print_label_snapshot, and PayslipOut.adjustment_lines
 * carries ad-hoc additions/deductions with their own label_snapshot
 * (backend/app/schemas/payroll.py:135-169). This component never prints a
 * literal row label itself: every `<div class="pr">` comes out of
 * `config().earningLines(row)` / `deductionLines(row)` / `adhocLines(row)`,
 * so a payslip with three configured tax heads shows three rows and one with
 * none shows none — the same rule the prototype's own payroll-run preview
 * states out loud ("This module contains no knowledge of any specific
 * deduction", app-screens2.js:1023).
 */
@Component({
  selector: 'app-payslip-screen',
  standalone: true,
  imports: [IconComponent],
  template: `
    <!-- embedded = hosted as a tab body inside a TabbedScreenConfig, same
         convention as ListScreenComponent/SingletonFormComponent: the title
         block is suppressed, the action buttons are not (they act on this
         payslip regardless of who owns the surrounding chrome). -->
    <div class="page-head" [class.embedded]="embedded()">
      @if (!embedded()) {
        <div>
          <h1 class="page-title">
            {{ config().title }}
            @if (config().specRef) {
              <span class="spec-ref">{{ config().specRef }}</span>
            }
            @if (policy.isReadOnly(config().id)) {
              <span class="badge-s b-warn" title="You have view-only access to this screen — no changes can be made here.">Read-only</span>
            }
          </h1>
          @if (config().description) {
            <p class="page-sub">{{ config().description }}</p>
          }
        </div>
      }
      @if (row(); as r) {
        <div class="page-actions">
          @if (config().pdfEndpoint; as pdfFn) {
            <button class="btn primary" type="button" [disabled]="!!downloading()" (click)="downloadPdf(pdfFn(r))">
              <app-icon name="download" [size]="14" />{{ downloading() === 'pdf' ? 'Downloading…' : 'Download PDF' }}
            </button>
          }
          @if (config().salaryCertificate; as cert) {
            <button class="btn" type="button" [disabled]="!!downloading()" (click)="requestCertificate(cert, r)">
              <app-icon name="doc" [size]="14" />{{ downloading() === 'certificate' ? 'Requesting…' : 'Download Salary Certificate' }}
            </button>
          }
          @if (config().reissue; as re) {
            @if (policy.can(config().id, re.screenAction ?? 'reissue')) {
              <button class="btn" type="button" (click)="goReissue(re.route(r))">Reissue</button>
            }
          }
        </div>
      }
    </div>

    @if (actionError()) {
      <div class="form-error" style="margin: 0 0 12px;">{{ actionError() }}</div>
    }

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this payslip</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (row(); as r) {
      <div class="rec-head">
        <div class="rec-avatar">{{ config().header.avatar?.(r) || initials(config().header.employeeName(r)) }}</div>
        <div style="min-width: 0;">
          <div class="rec-id">{{ config().header.recId(r) }}</div>
          <div class="rec-name">{{ config().header.employeeName(r) }}</div>
          <div class="rec-meta">
            @for (m of metaItems(r); track $index) {
              @if ($index) {
                <span class="dot"></span>
              }
              <span>{{ m }}</span>
            }
            @if (config().header.badge(r); as b) {
              @if (metaItems(r).length) {
                <span class="dot"></span>
              }
              <span class="badge-s {{ badgeCls(b) }}">{{ b }}</span>
            }
          </div>
          @if (config().header.subline?.(r); as sub) {
            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">{{ sub }}</div>
          }
          @if (config().header.reissueSummary?.(r); as rs) {
            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">{{ rs }}</div>
          }
        </div>
        <div class="rec-summary">
          <div class="s">
            <div class="l">Gross</div>
            <div class="v num">{{ money(config().summary.gross(r)) }}</div>
          </div>
          <div class="s">
            <div class="l">Deductions</div>
            <div class="v num">{{ money(config().summary.deductions(r)) }}</div>
          </div>
          <div class="s">
            <div class="l">Net Pay</div>
            <div class="v num">{{ money(config().summary.netPay(r)) }}</div>
          </div>
        </div>
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head">
            <h3>Earnings</h3>
          </div>
          <div class="card-body flush">
            <div class="payslip-rows">
              @for (line of earningLines(r); track line.label) {
                <div class="pr">
                  <span>
                    {{ line.label }}
                    @if (line.tag) {
                      <span class="badge-s b-accent" style="height: 16px; font-size: 10px;">{{ line.tag }}</span>
                    }
                  </span>
                  <b>{{ money(line.amount) }}</b>
                </div>
              }
              @for (line of adhocLines(r); track line.label) {
                <div class="pr">
                  <span>
                    {{ line.label }}
                    <span class="badge-s b-accent" style="height: 16px; font-size: 10px;">{{ line.tag ?? 'Ad-hoc' }}</span>
                  </span>
                  <b style="color: var(--success);">+ {{ money(line.amount) }}</b>
                </div>
              }
              <div class="pr tot">
                <span>Gross Earnings</span>
                <b>{{ money(config().summary.gross(r)) }}</b>
              </div>
            </div>
          </div>
          @if (config().earningsNote; as note) {
            <div class="card-foot">
              <span style="font-size: 11px; color: var(--text-tertiary);">{{ note }}</span>
            </div>
          }
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Deductions</h3>
            <span class="sub">One line per applicable head</span>
          </div>
          <div class="card-body flush">
            <div class="payslip-rows">
              @for (line of deductionLines(r); track line.label) {
                <div class="pr ded">
                  <span>
                    {{ line.label }}
                    @if (line.tag) {
                      <span class="badge-s b-accent" style="height: 16px; font-size: 10px;">{{ line.tag }}</span>
                    }
                  </span>
                  <b>− {{ money(line.amount) }}</b>
                </div>
              }
              <div class="pr tot">
                <span>Total Deductions</span>
                <b>− {{ money(config().summary.deductions(r)) }}</b>
              </div>
              <div class="pr tot" style="border-top-width: 2px;">
                <span>Net Pay</span>
                <b>{{ money(config().summary.netPay(r)) }}</b>
              </div>
            </div>
          </div>
          @if (config().deductionsNote; as note) {
            <div class="card-foot">
              <span style="font-size: 11px; color: var(--text-tertiary);">{{ note }}</span>
            </div>
          }
        </div>
      </div>

      <!-- No GET /payroll/payslips/{id}/reissues endpoint exists yet
           (payslips.py has only the POST at :281), so this card renders only
           once a screen registration supplies reissueHistoryEndpoint — never
           a fabricated empty table in the meantime. -->
      @if (config().reissueHistoryEndpoint) {
        <div style="height: 12px;"></div>
        <div class="card">
          <div class="card-head">
            <h3>Reissue History</h3>
            <span class="sub">Recorded on the payslip itself, for audit</span>
          </div>
          <div class="card-body flush">
            @if (reissueRows() === null) {
              <div class="empty">
                <p>Loading…</p>
              </div>
            } @else if (reissueRows()!.length === 0) {
              <div class="empty">
                <p>No reissues recorded for this payslip.</p>
              </div>
            } @else {
              <!-- Every cell in the reissue log is plain read-only text, so
                   this horizontally scrolling wrap (components.css:242) holds
                   nothing a keyboard can land on and its right-hand columns —
                   the old-vs-new figures, the whole point of the audit trail —
                   are unreachable without a mouse. tabindex="0" plus a named
                   role="region" makes it a focusable, arrow-scrollable stop
                   (axe scrollable-region-focusable, WCAG 2.1.1/2.1.3). -->
              <div class="table-wrap" tabindex="0" role="region" aria-label="Reissue history">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reissued By</th>
                      <th>Reason</th>
                      <th class="r">Old Figures</th>
                      <th class="r">New Figures</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (rr of reissueRows()!; track $index) {
                      <tr>
                        <td class="mono">{{ rr.date }}</td>
                        <td class="cell-strong">{{ rr.by }}</td>
                        <td>{{ rr.reason }}</td>
                        <td class="r num">{{ money(rr.oldNet) }}</td>
                        <td class="r num">{{ money(rr.newNet) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      }
      }
    }
  `,
})
export class PayslipScreenComponent<T = any> {
  readonly config = input.required<PayslipScreenConfig<T>>();
  /** True when rendered as a tab body — suppresses this component's own page
   * title/description, matching ListScreenComponent's `embedded` input. */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly policy = inject(PolicyStore);

  protected readonly row = signal<T | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly downloading = signal<'pdf' | 'certificate' | null>(null);
  protected readonly reissueRows = signal<readonly PayslipReissueRow[] | null>(null);

  constructor() {
    // Keyed off config() only, same as RecordScreenComponent — this shape is
    // always reached via a route with an :id segment, and a config swap (a
    // different screen registration, not a param change within one) is the
    // only time a re-fetch is warranted.
    effect(() => {
      const cfg = this.config();
      const id = this.route.snapshot.paramMap.get('id');
      this.reissueRows.set(null);
      if (!id) {
        this.loadError.set('No payslip id in the route.');
        this.isLoading.set(false);
        return;
      }
      this.isLoading.set(true);
      this.loadError.set(null);
      this.http.get<T>(`${environment.apiBaseUrl}${cfg.loadEndpoint(id)}`).subscribe({
        next: (data) => {
          this.row.set(data);
          this.isLoading.set(false);
          this.breadcrumbs.setRecordLabel(cfg.header.recId(data));
          const historyFn = cfg.reissueHistoryEndpoint;
          if (historyFn) {
            this.http.get<PayslipReissueRow[]>(`${environment.apiBaseUrl}${historyFn(data)}`).subscribe({
              next: (rows) => this.reissueRows.set(rows ?? []),
              error: () => this.reissueRows.set([]),
            });
          }
        },
        error: (err) => {
          this.loadError.set(err?.error?.detail ?? 'Failed to load this payslip.');
          this.isLoading.set(false);
        },
      });
    });
    this.destroyRef.onDestroy(() => this.breadcrumbs.setRecordLabel(null));
  }

  // ---- line-item sections -------------------------------------------------
  // Every one of these hands back exactly what the config's accessor
  // returns — no row is ever invented, filtered, or relabeled here.

  protected earningLines(row: T): readonly PayslipLineItem[] {
    return this.config().earningLines(row);
  }

  protected deductionLines(row: T): readonly PayslipLineItem[] {
    return this.config().deductionLines(row);
  }

  protected adhocLines(row: T): readonly PayslipLineItem[] {
    return this.config().adhocLines?.(row) ?? [];
  }

  protected metaItems(row: T): string[] {
    return this.config().header.meta(row).filter((m) => !!m && m !== '—');
  }

  // ---- formatting -----------------------------------------------------

  protected money(n: number): string {
    return formatMoney(n);
  }

  /** Prototype's initials(n) (app-core.js:74) — first letter of up to the
   * first two words, upper-cased. Used only as the avatar fallback when the
   * config doesn't supply one. */
  protected initials(name: string): string {
    return String(name || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  // ---- actions ----------------------------------------------------------

  protected goReissue(route: readonly unknown[]): void {
    this.router.navigate(route as any[]);
  }

  // Auth is Bearer-header-only (auth.interceptor.ts) — a plain <a href> would
  // hit the API unauthenticated, so this downloads via HttpClient as a blob
  // and saves it through a synthetic click, same pattern as ListScreenComponent's
  // exportAs().
  protected downloadPdf(endpoint: string): void {
    if (this.downloading()) return;
    this.downloading.set('pdf');
    this.actionError.set(null);
    this.http.get(`${environment.apiBaseUrl}${endpoint}`, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => this.saveBlob(res, 'payslip.pdf'),
      error: async (err) => {
        this.downloading.set(null);
        this.actionError.set(await this.resolveBlobError(err));
      },
    });
  }

  // Two-step: POST the request (payslips.py:456) — optionally after prompting
  // for Purpose, per the prototype's "with an optional Purpose field (e.g.
  // visa or loan application)" — then, if the response carries a
  // pdf_file_id, download it through the generic /files/{id} endpoint
  // (files.py:111). The request always succeeds or fails as a whole; a
  // response with no pdf_file_id still counts as success (the certificate was
  // recorded, just not immediately downloadable).
  protected requestCertificate(cert: NonNullable<PayslipScreenConfig<T>['salaryCertificate']>, row: T): void {
    if (this.downloading()) return;
    let purpose: string | null = null;
    if (cert.promptForPurpose) {
      purpose = window.prompt('Purpose for this Salary Certificate (optional):', '');
      if (purpose === null) return; // user cancelled the prompt
    }
    this.downloading.set('certificate');
    this.actionError.set(null);
    // Admin view supplies employeeId(row) so the certificate is generated for
    // the PAYSLIP'S OWNER, not the logged-in Accountant/HR/Super Admin caller
    // — sent as a query param since request_salary_certificate (payslips.py)
    // reads it off the query string, not the JSON body.
    const employeeId = cert.employeeId?.(row);
    const url = employeeId ? `${environment.apiBaseUrl}${cert.requestEndpoint}?employee_id=${encodeURIComponent(employeeId)}` : `${environment.apiBaseUrl}${cert.requestEndpoint}`;
    this.http.post<{ pdf_file_id?: string | null }>(url, { purpose: purpose || undefined }).subscribe({
      next: (created) => {
        if (!created?.pdf_file_id) {
          this.downloading.set(null);
          return;
        }
        this.http.get(`${environment.apiBaseUrl}/files/${created.pdf_file_id}`, { responseType: 'blob', observe: 'response' }).subscribe({
          next: (res) => this.saveBlob(res, 'salary-certificate.pdf'),
          error: async (err) => {
            this.downloading.set(null);
            this.actionError.set(await this.resolveBlobError(err));
          },
        });
      },
      error: async (err) => {
        this.downloading.set(null);
        this.actionError.set(await this.resolveBlobError(err));
      },
    });
  }

  private saveBlob(res: HttpResponse<Blob>, fallbackFilename: string): void {
    this.downloading.set(null);
    const blob = res.body;
    if (!blob) return;
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match?.[1] ?? fallbackFilename;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  // With responseType: 'blob', HttpClient blob-wraps error bodies too — a
  // failed download's JSON {detail: "..."} arrives as err.error being a Blob,
  // not the parsed object err?.error?.detail reads elsewhere. Same fix as
  // ListScreenComponent.resolveBlobError().
  private async resolveBlobError(err: unknown): Promise<string> {
    const blob = (err as any)?.error;
    if (blob instanceof Blob) {
      try {
        const parsed = JSON.parse(await blob.text());
        if (typeof parsed?.detail === 'string') return parsed.detail;
      } catch {
        // not JSON — fall through to the generic message below
      }
    }
    return 'That download failed.';
  }
}
