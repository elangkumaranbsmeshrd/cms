import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatMoney, isBlank } from '../../../shared/screens/cell-format';
import { FieldGridComponent } from '../../../shared/screens/field-grid/field-grid.component';
import { ListScreenComponent } from '../../../shared/screens/list-screen/list-screen.component';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { FieldSection } from '../../../shared/screens/screen.types';
import { IconComponent } from '../../../shared/ui/icon.component';
import { CUSTOMER_OWNER_REF, CUSTOMER_SOURCE_REF, CUSTOMER_STATUS_REF, CustomerRow } from '../customer.api';
import { CustomerActivitiesComponent } from './customer.activities.component';
import { CustomerContactsComponent } from './customer.contacts.component';
import { CustomerFilesComponent } from './customer.files.component';
import { buildCustomerInvoicesListConfig } from './customer.invoices.list.config';
import { buildCustomerOpportunitiesListConfig } from './customer.opportunities.list.config';
import { buildCustomerProjectsListConfig } from './customer.projects.list.config';
import { buildCustomerTicketsListConfig } from './customer.tickets.list.config';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

const SCREEN = 'customer.directory';

type TabKey = 'overview' | 'contacts' | 'activities' | 'opportunities' | 'projects' | 'invoices' | 'tickets' | 'files';

interface TabMeta {
  readonly key: TabKey;
  readonly label: string;
}

// §2.3's own 8 tabs, in the prototype's own declared order
// (app-screens2.js:297-349) — Overview, Contacts, Activities, Opportunities,
// Projects, Invoices, Tickets, Files.
const TABS: readonly TabMeta[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'activities', label: 'Activities' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'projects', label: 'Projects' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'files', label: 'Files' },
];

/**
 * §2.3 Customer 360 — bespoke, route `customers/:id`. Neither the 'record'
 * nor 'tabbed' shape fits, the same two reasons opportunity.record.component.ts's
 * own header comment already establishes for that sibling module:
 *
 * - RecordScreenConfig's page-actions block is hardcoded to ONE behaviour
 *   (an in-place Edit/Save/Cancel toggle PUTting the SAME screen's own tab
 *   fields back to `edit.saveEndpoint`). §2.3's own Edit action navigates to
 *   a SEPARATE route (customers/:id/edit, customer.form.config.ts) instead —
 *   RecordScreenConfig has no way to express that, and the previous
 *   customer.record.config.ts (deleted) papered over the mismatch by making
 *   every field `editable: true` and losing the dedicated Add/Edit Customer
 *   form (and its "+ Add Customer" route) entirely.
 * - RecordHeaderConfig (the 'record' shape's own header type) has no
 *   `summary` slot at all — only RecordHeaderDef (the 'tabbed' shape) does —
 *   but §2.3's own persistent header needs exactly that: "keeps Total
 *   Invoiced / Received / Outstanding in view no matter which tab is open."
 *   TabbedScreenConfig's template has no page-actions block for the Edit
 *   button either.
 *
 * Modeled on opportunity.record.component.ts (rec-head/rec-summary/page-
 * actions shape) and project.record.component.ts (embedding
 * <app-list-screen> directly for the Opportunities/Projects/Invoices/
 * Tickets tabs — each served by that OTHER module's own list endpoint
 * filtered to this customer's id, exactly project.record.component.ts's own
 * "compose the same components ScreenHostComponent/RecordScreenComponent
 * themselves already render, just wired up by hand" reasoning, since
 * RecordScreenConfig's 'embed' tab kind is only reachable through
 * RecordScreenComponent itself, not from a bespoke component).
 *
 * "Export PDF" (the prototype's third page action, app-screens2.js:350) was
 * considered and dropped — there is no per-customer PDF export endpoint on
 * the backend at all (api/v1/customers.py's full route list: GET/POST
 * /customers, GET/PUT /{id}, contacts/activities/files — nothing PDF-shaped,
 * unlike Asset's real "Download Asset Card"). Flagged as a backend gap
 * rather than faked with a button that 404s.
 */
@Component({
  selector: 'app-customer-record',
  standalone: true,
  imports: [IconComponent, FieldGridComponent, ListScreenComponent, CustomerContactsComponent, CustomerActivitiesComponent, CustomerFilesComponent, RoleButtonDirective],
  template: `
    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this customer</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (customer(); as c) {
        <div class="page-head">
          <div>
            <h1 class="page-title">{{ c.company_name }}</h1>
            <p class="page-sub mono">{{ c.customer_code }}</p>
          </div>
          <div class="page-actions">
            @if (canEdit()) {
              <button class="btn primary" type="button" (click)="openEdit()">
                <app-icon name="edit" [size]="14" />Edit
              </button>
            }
            @if (canCreateInvoice()) {
              <button class="btn ghost" type="button" (click)="createInvoice()">
                <app-icon name="invoice" [size]="14" />New Invoice
              </button>
            }
          </div>
        </div>

        <div class="rec-head">
          <div class="rec-avatar">{{ initial() }}</div>
          <div style="min-width: 0;">
            <div class="rec-id">{{ c.customer_code }}</div>
            <div class="rec-name">{{ c.company_name }}</div>
            <div class="rec-meta">
              <span>{{ sourceLabel() }}</span>
              <span class="dot"></span>
              <span>Owner: {{ ownerLabel() }}</span>
              <span class="dot"></span>
              <span class="badge-s {{ badgeCls() }}">{{ statusLabel() }}</span>
            </div>
          </div>
          <div class="rec-summary">
            <div class="s">
              <div class="l">Total Invoiced</div>
              <div class="v">{{ money(c.total_invoiced) }}</div>
            </div>
            <div class="s">
              <div class="l">Received</div>
              <div class="v">{{ money(c.received) }}</div>
            </div>
            <div class="s">
              <div class="l">Outstanding</div>
              <div class="v">{{ money(c.outstanding) }}</div>
            </div>
          </div>
        </div>

        <div class="tabs">
          @for (t of TABS; track t.key) {
            <div class="tab" [class.on]="t.key === activeTabKey()" role="button" (click)="selectTab(t.key)">
              {{ t.label }}
              @if (counts()[t.key]; as n) {
                <span class="cnt">{{ n }}</span>
              }
            </div>
          }
        </div>

        @switch (activeTabKey()) {
          @case ('overview') {
            <!-- app-screens2.js:306: "The money summary sits in the persistent
                 header above, so it is not repeated here." -->
            <p class="hint" style="margin: 0 0 10px;">The money summary above (Total Invoiced / Received / Outstanding) is not repeated here.</p>
            <app-field-grid [row]="customerAsRecord()" [sections]="overviewSections()" />
          }
          @case ('contacts') {
            <app-customer-contacts [customerId]="id" />
          }
          @case ('activities') {
            <app-customer-activities [customerId]="id" />
          }
          @case ('opportunities') {
            <app-list-screen [config]="opportunitiesConfig" [embedded]="true" />
          }
          @case ('projects') {
            <app-list-screen [config]="projectsConfig" [embedded]="true" />
          }
          @case ('invoices') {
            <app-list-screen [config]="invoicesConfig" [embedded]="true" />
          }
          @case ('tickets') {
            <app-list-screen [config]="ticketsConfig" [embedded]="true" />
          }
          @case ('files') {
            <app-customer-files [customerId]="id" />
          }
        }
      }
    }
  `,
})
export class CustomerRecordComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly TABS = TABS;
  protected readonly EM_DASH = EM_DASH;

  // Read once from the route snapshot — this component (like
  // opportunity.record.component.ts/project.record.component.ts) is
  // recreated per customer, a fresh :id is a fresh route, never an in-place
  // param change on the same instance.
  protected readonly id: string = this.route.snapshot.paramMap.get('id') ?? '';

  // Built once per component instance, each closing over this customer's own
  // id — same "fixed identity, no manual reload nudge needed" reasoning
  // project.record.component.ts's own board/report/timesheet configs document.
  protected readonly opportunitiesConfig = buildCustomerOpportunitiesListConfig(this.id);
  protected readonly projectsConfig = buildCustomerProjectsListConfig(this.id);
  protected readonly invoicesConfig = buildCustomerInvoicesListConfig(this.id);
  protected readonly ticketsConfig = buildCustomerTicketsListConfig(this.id);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly customer = signal<CustomerRow | null>(null);
  protected readonly counts = signal<Record<string, number>>({});
  private readonly selectedTab = signal<TabKey | null>(null);

  ngOnInit(): void {
    if (!this.id) {
      this.loadError.set('No customer id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.load();
    // §2.3's own tab count badges (n: D.contacts.length, etc.,
    // app-screens2.js:309-343) — one small GET per tab, exactly
    // project.record.component.ts's own fetchCount() pattern.
    this.fetchCount('contacts', `/customers/${this.id}/contacts`);
    this.fetchCount('activities', `/customers/${this.id}/activities`);
    this.fetchCount('opportunities', `/opportunities?customer_id=${this.id}`);
    this.fetchCount('projects', `/projects?customer_id=${this.id}`);
    this.fetchCount('invoices', `/invoices?customer_id=${this.id}`);
    this.fetchCount('tickets', `/tickets?customer_id=${this.id}`);
    this.fetchCount('files', `/customers/${this.id}/files`);
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<CustomerRow>(`${environment.apiBaseUrl}/customers/${this.id}`).subscribe({
      next: (row) => {
        this.customer.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this customer.');
        this.isLoading.set(false);
      },
    });
  }

  private fetchCount(key: string, path: string): void {
    this.http.get<readonly unknown[]>(`${environment.apiBaseUrl}${path}`).subscribe({
      next: (rows) => this.counts.update((c) => ({ ...c, [key]: Array.isArray(rows) ? rows.length : 0 })),
      // No badge rather than a broken tab — matches TabbedScreenComponent's/
      // project.record.component.ts's own count-fetch error handling exactly.
      error: () => undefined,
    });
  }

  protected activeTabKey(): TabKey {
    const chosen = this.selectedTab();
    if (chosen) return chosen;
    const fromUrl = this.route.snapshot.queryParamMap.get('tab');
    if (fromUrl && TABS.some((t) => t.key === fromUrl)) return fromUrl as TabKey;
    return 'overview';
  }

  protected selectTab(key: TabKey): void {
    this.selectedTab.set(key);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: key }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected openEdit(): void {
    this.router.navigate(['/customers', this.id, 'edit']);
  }

  // invoice.list has no dedicated 'create' action — invoice.list.config.ts's
  // own createScreenAction is explicitly 'edit', so that's the real gate
  // (same reasoning opportunity.record.component.ts's own canCreateInvoice
  // already documents).
  protected canCreateInvoice(): boolean {
    return this.policy.can('invoice.list', 'edit');
  }

  protected createInvoice(): void {
    const c = this.customer();
    if (!c) return;
    this.router.navigate(['/invoices', 'new'], { queryParams: { customer_id: c.id } });
  }

  protected initial(): string {
    const name = this.customer()?.company_name?.trim();
    return name ? name.charAt(0).toUpperCase() : 'C';
  }

  protected sourceLabel(): string {
    const c = this.customer();
    if (!c?.source_id) return EM_DASH;
    const label = this.refData.label(CUSTOMER_SOURCE_REF, c.source_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected ownerLabel(): string {
    const c = this.customer();
    if (!c?.owner_id) return 'Unassigned';
    const label = this.refData.label(CUSTOMER_OWNER_REF, c.owner_id);
    return isBlank(label) ? EM_DASH : label;
  }

  protected statusLabel(): string {
    const c = this.customer();
    return c ? this.refData.label(CUSTOMER_STATUS_REF, c.status_id) : EM_DASH;
  }

  protected badgeCls(): string {
    return badgeClass(this.statusLabel());
  }

  protected money(v: unknown): string {
    return formatMoney(v);
  }

  /** FieldGridComponent (shared/screens/field-grid) is the same read-only
   * label/value grid opportunity.record.component.ts's own Details tab
   * reuses — a static read-only display off data this component already
   * has, no endpoint of its own. */
  protected customerAsRecord(): Record<string, unknown> | null {
    return this.customer() as unknown as Record<string, unknown> | null;
  }

  protected overviewSections(): readonly FieldSection<Record<string, unknown>>[] {
    return [
      {
        // app-screens2.js:299: U.section('Master Record', [...]) — one flat
        // section, every field read-only (editing happens on the separate
        // Edit form only), in the prototype's own declared field order.
        title: 'Master Record',
        fields: [
          { key: 'company_name', label: 'Company Name' },
          { key: 'display_name', label: 'Display Name' },
          { key: 'customer_code', label: 'Customer Code' },
          { key: 'gstin', label: 'GSTIN' },
          { key: 'pan', label: 'PAN' },
          { key: 'status_id', label: 'Status', ref: CUSTOMER_STATUS_REF },
          { key: 'source_id', label: 'Source', ref: CUSTOMER_SOURCE_REF },
          { key: 'owner_id', label: 'Owner', ref: CUSTOMER_OWNER_REF },
          { key: 'website', label: 'Website' },
          { key: 'mobile_number', label: 'Mobile Number' },
          { key: 'email', label: 'Email' },
          { key: 'address', label: 'Address', span: 2 },
          { key: 'notes', label: 'Notes', span: 2 },
        ],
      },
      // Real, genuinely-writable CustomerWrite fields (see
      // customer.form.config.ts's own header comment) with no equivalent
      // section in the prototype's own Overview (app-screens2.js:299-306) —
      // that mock predates bank_account_name/bank_name/bank_account_number
      // being added to the schema (2026-07-31). Shown here so what the Edit
      // form can set is also visible somewhere, matching the Directory's
      // own "Customer Bank Account Name"/"Account Number" columns.
      {
        title: 'Bank Details',
        fields: [
          { key: 'bank_account_name', label: 'Bank Account Name' },
          { key: 'bank_name', label: 'Bank' },
          { key: 'bank_account_number', label: 'Account Number' },
        ],
      },
    ];
  }
}
