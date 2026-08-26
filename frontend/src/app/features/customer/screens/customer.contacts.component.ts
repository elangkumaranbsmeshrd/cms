import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';

const SCREEN = 'customer.directory';

interface CustomerContactRow {
  readonly id: string;
  readonly name: string;
  readonly designation: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly is_primary: boolean;
}

/** §2.3 Customer 360, Tab: Contacts — GET/POST /customers/{id}/contacts,
 * PUT/DELETE .../contacts/{contact_id}. Bespoke inline add/edit-row table,
 * same house pattern as emp.emergency-contacts.component.ts (a 5-field
 * repeatable row list has no dedicated page worth routing to).
 */
@Component({
  selector: 'app-customer-contacts',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Contacts</h3>
          <div style="display: flex; gap: 8px; align-items: center;">
            <select class="fselect" title="Primary" [(ngModel)]="primaryFilter" (ngModelChange)="load()">
              <option value="">Primary — Any</option>
              <option value="true">Primary Only</option>
              <option value="false">Non-Primary Only</option>
            </select>
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportContacts('pdf')">
              {{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
            </button>
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportContacts('excel')">
              {{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
            </button>
            @if (canEdit() && !editingId() && !addingNew()) {
              <button class="btn sm ghost" type="button" (click)="startAdd()">+ Add Contact</button>
            }
          </div>
        </div>
        @if (exportError()) {
          <div class="form-error" style="margin: 14px;">{{ exportError() }}</div>
        }
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Designation</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Primary</th>
                @if (canEdit()) {
                  <th></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (c of contacts(); track c.id) {
                @if (editingId() === c.id) {
                  <tr>
                    <td><input class="input" [(ngModel)]="form['name']" /></td>
                    <td><input class="input" [(ngModel)]="form['designation']" /></td>
                    <td><input class="input" [(ngModel)]="form['email']" /></td>
                    <td><input class="input" [(ngModel)]="form['phone']" /></td>
                    <td><span class="toggle" [class.on]="form['is_primary']" (click)="form['is_primary'] = !form['is_primary']"><span class="track"></span></span></td>
                    <td style="white-space: nowrap;">
                      <button class="btn sm primary" type="button" [disabled]="saving()" (click)="save(c.id)">Save</button>
                      <button class="btn sm ghost" type="button" [disabled]="saving()" (click)="cancelEdit()">Cancel</button>
                    </td>
                  </tr>
                } @else {
                  <tr>
                    <td>{{ c.name }}</td>
                    <td>{{ c.designation ?? '—' }}</td>
                    <td>{{ c.email ?? '—' }}</td>
                    <td class="mono">{{ c.phone ?? '—' }}</td>
                    <td>@if (c.is_primary) { <span class="badge-s b-success">Primary</span> }</td>
                    @if (canEdit()) {
                      <td style="white-space: nowrap;">
                        <button class="btn sm ghost" type="button" (click)="startEdit(c)">Edit</button>
                        <button class="btn sm ghost" type="button" (click)="remove(c)">Delete</button>
                      </td>
                    }
                  </tr>
                }
              }
              @if (addingNew()) {
                <tr>
                  <td><input class="input" [(ngModel)]="form['name']" placeholder="Name" /></td>
                  <td><input class="input" [(ngModel)]="form['designation']" placeholder="e.g. Procurement Manager" /></td>
                  <td><input class="input" [(ngModel)]="form['email']" placeholder="Email" /></td>
                  <td><input class="input" [(ngModel)]="form['phone']" placeholder="10-digit mobile" /></td>
                  <td><span class="toggle" [class.on]="form['is_primary']" (click)="form['is_primary'] = !form['is_primary']"><span class="track"></span></span></td>
                  <td style="white-space: nowrap;">
                    <button class="btn sm primary" type="button" [disabled]="saving()" (click)="save(null)">Save</button>
                    <button class="btn sm ghost" type="button" [disabled]="saving()" (click)="cancelEdit()">Cancel</button>
                  </td>
                </tr>
              }
              @if (!contacts().length && !addingNew()) {
                <tr><td [attr.colspan]="canEdit() ? 6 : 5" class="cell-sub">No contacts added yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class CustomerContactsComponent implements OnInit {
  readonly customerId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly contacts = signal<readonly CustomerContactRow[]>([]);
  protected readonly editingId = signal<string | null>(null);
  protected readonly addingNew = signal(false);
  protected readonly saving = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  // §5's deferred "Contacts primary/non-primary filter and export" — now
  // real on GET /customers/{id}/contacts (list_contacts).
  protected primaryFilter = '';
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected load(): void {
    this.isLoading.set(true);
    const qs = this.primaryFilter ? `?is_primary=${this.primaryFilter}` : '';
    this.http.get<CustomerContactRow[]>(`${environment.apiBaseUrl}/customers/${this.customerId()}/contacts${qs}`).subscribe({
      next: (rows) => {
        this.contacts.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected exportContacts(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = new URLSearchParams();
    if (this.primaryFilter) params.set('is_primary', this.primaryFilter);
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/customers/${this.customerId()}/contacts?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Customer Contacts.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: () => {
        this.exporting.set(null);
        this.exportError.set('Failed to export.');
      },
    });
  }

  protected startAdd(): void {
    this.form = { name: '', designation: '', email: '', phone: '', is_primary: this.contacts().length === 0 };
    this.editingId.set(null);
    this.addingNew.set(true);
    this.actionError.set(null);
  }

  protected startEdit(c: CustomerContactRow): void {
    this.form = { name: c.name, designation: c.designation, email: c.email, phone: c.phone, is_primary: c.is_primary };
    this.addingNew.set(false);
    this.editingId.set(c.id);
    this.actionError.set(null);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.addingNew.set(false);
  }

  protected save(id: string | null): void {
    if (!this.form['name']) {
      this.actionError.set('Name is required.');
      return;
    }
    this.saving.set(true);
    this.actionError.set(null);
    const base = `${environment.apiBaseUrl}/customers/${this.customerId()}/contacts`;
    const req$ = id ? this.http.put(`${base}/${id}`, this.form) : this.http.post(base, this.form);
    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.editingId.set(null);
        this.addingNew.set(false);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.actionError.set(err?.error?.detail ?? 'Failed to save this contact.');
      },
    });
  }

  protected remove(c: CustomerContactRow): void {
    if (!window.confirm(`Delete ${c.name} as a contact?`)) return;
    this.actionError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/customers/${this.customerId()}/contacts/${c.id}`).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to delete this contact.'),
    });
  }
}
