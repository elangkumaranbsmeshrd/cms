import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { EM_DASH, badgeClass, formatDate, formatMoney, isBlank } from '../../../shared/screens/cell-format';
import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FieldGridComponent } from '../../../shared/screens/field-grid/field-grid.component';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { FieldSection } from '../../../shared/screens/screen.types';
import { IconComponent } from '../../../shared/ui/icon.component';
import { OPPORTUNITY_CUSTOMER_REF, OPPORTUNITY_OWNER_REF, OPPORTUNITY_STAGE_OPTIONS, OpportunityRow } from '../opportunity.api';
import { OpportunityActivitiesComponent } from './opportunity.activities.component';
import { OpportunityFilesComponent } from './opportunity.files.component';

const SCREEN = 'opportunity.pipeline';

type TabKey = 'details' | 'activities' | 'files';

/** Opportunity Record — bespoke, route `opportunities/:id`. Neither the
 * 'record' nor 'tabbed' shape fits (verified by reading both components in
 * full):
 *
 * - RecordScreenConfig's page-actions block is hardcoded to exactly ONE
 *   behaviour: an in-place Edit/Save/Cancel toggle that PUTs the SAME
 *   screen's own tab fields back to `edit.saveEndpoint`
 *   (record-screen.component.ts's own startEdit()/save()). It cannot
 *   navigate to a separate route, and RecordActionDef only ever lives
 *   inside one FIELDS tab, never at the page level.
 * - TabbedScreenConfig's template has no page-actions block at all —
 *   nowhere to put an Edit button beside the tabs.
 *
 * This module needs exactly that: an Edit button that navigates to
 * `/opportunities/:id/edit` (the separate FormScreenConfig route), plus real
 * client-side tabs. Modeled on ticket.detail.component.ts for the page-head/
 * page-actions/rec-head shape (the established "bespoke record with its own
 * page actions" precedent), and on tabbed-screen.component.ts's own
 * `.rec-head`/`.tabs`/`.tab` markup for the identity card and tab bar, since
 * neither component itself could be reused directly here.
 *
 * "Export PDF" was considered and dropped — there is no per-record PDF
 * export endpoint on the backend for Opportunity at all. "Create Invoice"
 * (now that Invoice's own frontend exists) navigates to /invoices/new with
 * customer_id/reference on the query string — DocumentScreenConfig.emptyRow
 * now receives the create route's query params for exactly this handoff;
 * Invoice has no opportunity_id FK at all (confirmed against schemas/
 * finance.py), so `reference` (a plain text field) is the only real link
 * back to this opportunity, not a structural one.
 */
@Component({
  selector: 'app-opportunity-record',
  standalone: true,
  imports: [IconComponent, FieldGridComponent, OpportunityActivitiesComponent, OpportunityFilesComponent],
  template: `
    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this opportunity</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (opportunity(); as o) {
        <div class="page-head">
          <div>
            <h1 class="page-title">{{ o.title }}</h1>
            <p class="page-sub mono">{{ o.opportunity_code }}</p>
          </div>
          <div class="page-actions">
            @if (canEdit()) {
              <button class="btn ghost" type="button" (click)="openEdit()">
                <app-icon name="edit" [size]="14" />Edit
              </button>
            }
            @if (canCreateInvoice()) {
              <button class="btn ghost" type="button" (click)="createInvoice()">
                <app-icon name="invoice" [size]="14" />Create Invoice
              </button>
            }
          </div>
        </div>

        <div class="rec-head">
          <div class="rec-avatar">{{ initial() }}</div>
          <div style="min-width: 0;">
            <div class="rec-id">{{ o.opportunity_code }}</div>
            <div class="rec-name">{{ o.title }}</div>
            <div class="rec-meta">
              <span>{{ customerLabel() }}</span>
              <span class="dot"></span>
              <span>Owner: {{ ownerLabel() }}</span>
              <span class="dot"></span>
              <span>{{ closeDateDisplay() }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls(o.stage) }}">{{ stageLabel(o.stage) }}</span>
            </div>
          </div>
          <div class="rec-summary">
            <div class="s">
              <div class="l">Value</div>
              <div class="v">{{ valueDisplay() }}</div>
            </div>
            <div class="s">
              <div class="l">Probability</div>
              <div class="v">{{ probabilityDisplay() }}</div>
            </div>
            <div class="s">
              <div class="l">Expected Close</div>
              <div class="v">{{ closeDateDisplay() }}</div>
            </div>
          </div>
        </div>

        <div class="tabs">
          @for (t of TABS; track t.key) {
            <div class="tab" [class.on]="t.key === activeTab()" role="button" (click)="activeTab.set(t.key)">{{ t.label }}</div>
          }
        </div>

        @switch (activeTab()) {
          @case ('details') {
            <app-field-grid [row]="opportunityAsRecord()" [sections]="detailSections()" />
          }
          @case ('activities') {
            <app-opportunity-activities [opportunityId]="opportunityId" [customerId]="o.customer_id" />
          }
          @case ('files') {
            <app-opportunity-files [opportunityId]="opportunityId" />
          }
        }
      }
    }
  `,
})
export class OpportunityRecordComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected readonly EM_DASH = EM_DASH;
  protected readonly TABS: readonly { key: TabKey; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'activities', label: 'Activities' },
    { key: 'files', label: 'Files' },
  ];

  // Read once from the route snapshot — this component (like
  // ticket.detail.component.ts) is recreated per opportunity, a fresh :id is
  // a fresh route, never an in-place param change on the same instance.
  protected readonly opportunityId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly opportunity = signal<OpportunityRow | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly activeTab = signal<TabKey>('details');

  constructor() {
    if (!this.opportunityId) {
      this.loadError.set('No opportunity id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<OpportunityRow>(`${environment.apiBaseUrl}/opportunities/${this.opportunityId}`).subscribe({
      next: (row) => {
        this.opportunity.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this opportunity.');
        this.isLoading.set(false);
      },
    });
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected openEdit(): void {
    this.router.navigate(['/opportunities', this.opportunityId, 'edit']);
  }

  // invoice.list has no dedicated 'create' action — invoice.list.config.ts's
  // own createScreenAction is explicitly 'edit', so that's the real gate.
  protected canCreateInvoice(): boolean {
    return this.policy.can('invoice.list', 'edit');
  }

  protected createInvoice(): void {
    const o = this.opportunity();
    if (!o) return;
    this.router.navigate(['/invoices', 'new'], { queryParams: { customer_id: o.customer_id, reference: o.opportunity_code } });
  }

  protected initial(): string {
    const title = this.opportunity()?.title?.trim();
    return title ? title.charAt(0).toUpperCase() : 'O';
  }

  protected stageLabel(stage: string): string {
    return OPPORTUNITY_STAGE_OPTIONS.find((s) => s.value === stage)?.label ?? stage;
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  protected customerLabel(): string {
    const o = this.opportunity();
    if (!o) return EM_DASH;
    const label = this.refData.label(OPPORTUNITY_CUSTOMER_REF, o.customer_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected ownerLabel(): string {
    const o = this.opportunity();
    if (!o?.owner_id) return 'Unassigned';
    const label = this.refData.label(OPPORTUNITY_OWNER_REF, o.owner_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected valueDisplay(): string {
    const v = this.opportunity()?.value;
    return v === null || v === undefined ? EM_DASH : formatMoney(Number(v));
  }

  protected probabilityDisplay(): string {
    const p = this.opportunity()?.probability_pct;
    return p === null || p === undefined ? EM_DASH : `${Number(p)}%`;
  }

  protected closeDateDisplay(): string {
    const d = this.opportunity()?.expected_close_date;
    return d ? formatDate(d) : EM_DASH;
  }

  /** FieldGridComponent (shared/screens/field-grid) is the same read-only
   * label/value grid tabbed-screen.component.ts's own 'fields' tab kind
   * renders from — reused here rather than hand-rolling a second copy of it,
   * matching this shape's own established purpose ("a static read-only
   * field grid off data the host screen already has, no endpoint of its
   * own"). */
  protected opportunityAsRecord(): Record<string, unknown> | null {
    return this.opportunity() as unknown as Record<string, unknown> | null;
  }

  protected detailSections(): readonly FieldSection<Record<string, unknown>>[] {
    return [
      {
        // 'Deal' matches the prototype's own section title (app-screens2.js
        // RECORD.opportunity, Details tab: U.section('Deal', [...])). Field
        // order below mirrors that same field list exactly — Title,
        // Opportunity Code, Customer, Value, Stage, Probability, Expected
        // Close Date, Owner, Description — with Last Activity and Lost
        // Reason appended after: two real, backend-tracked fields the
        // prototype's single non-Lost demo row never had reason to show, not
        // fabricated additions (last_activity_at drives §2.1's own "stale"
        // filter; lost_reason is the one place this Record's read-only tab
        // can show why a Lost deal was lost, since — unlike the Add/Edit
        // form — this tab has no Stage-conditional visibility to hide it).
        title: 'Deal',
        fields: [
          { key: 'title', label: 'Title' },
          { key: 'opportunity_code', label: 'Opportunity Code' },
          { key: 'customer_id', label: 'Customer', ref: OPPORTUNITY_CUSTOMER_REF },
          {
            key: 'value',
            label: 'Value',
            compute: (row) => {
              const v = (row as Record<string, unknown>)['value'];
              return v === null || v === undefined ? null : formatMoney(Number(v));
            },
          },
          { key: 'stage', label: 'Stage', compute: (row) => this.stageLabel(String((row as Record<string, unknown>)['stage'] ?? '')) },
          {
            key: 'probability_pct',
            label: 'Probability',
            compute: (row) => {
              const p = (row as Record<string, unknown>)['probability_pct'];
              return p === null || p === undefined ? null : `${Number(p)}%`;
            },
          },
          {
            key: 'expected_close_date',
            label: 'Expected Close Date',
            compute: (row) => {
              const d = (row as Record<string, unknown>)['expected_close_date'];
              return d ? formatDate(String(d)) : null;
            },
          },
          { key: 'owner_id', label: 'Owner', ref: OPPORTUNITY_OWNER_REF },
          { key: 'description', label: 'Description', span: 2 },
          {
            key: 'last_activity_at',
            label: 'Last Activity',
            compute: (row) => {
              const d = (row as Record<string, unknown>)['last_activity_at'];
              return d ? formatDate(String(d)) : null;
            },
          },
          { key: 'lost_reason', label: 'Lost Reason', span: 2 },
        ],
      },
    ];
  }
}
