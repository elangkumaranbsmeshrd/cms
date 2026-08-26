import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';

const SCREEN = 'employee.master_record';

interface EmergencyContactRow {
  readonly id: string;
  readonly contact_name: string;
  readonly relationship: string | null;
  readonly contact_phone: string | null;
  readonly is_primary: boolean;
  readonly display_order: number;
}

/** §2.2 Emergency Contact tab — a small repeatable list scoped to one
 * employee (GET/POST/PUT/DELETE .../emergency-contacts[/{contact_id}],
 * employees.py), gated by the SAME employee.master_record screen the rest
 * of the record uses (that router's own comment: these rows share the
 * record's screen, not a separate RBAC key like Salary Structure/Insurance
 * do). Bespoke rather than the 'list' shape: no dedicated route/page makes
 * sense for a 3-field contact row, this is genuinely an inline add/edit-row
 * table.
 */
@Component({
  selector: 'app-emp-emergency-contacts',
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
          <h3>Emergency Contacts</h3>
          @if (canEdit() && !editingId()) {
            <button class="btn sm ghost" type="button" (click)="startAdd()">+ Add Contact</button>
          }
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact Name</th>
                <th>Relationship</th>
                <th>Contact Phone</th>
                @if (canEdit()) {
                  <th></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (c of contacts(); track c.id) {
                @if (editingId() === c.id) {
                  <tr>
                    <td><input class="input" [(ngModel)]="form['contact_name']" /></td>
                    <td>
                      <select class="input" [(ngModel)]="form['relationship']">
                        <option [value]="null">—</option>
                        @for (r of RELATIONSHIPS; track r) {
                          <option [value]="r">{{ r }}</option>
                        }
                      </select>
                    </td>
                    <td><input class="input" [(ngModel)]="form['contact_phone']" /></td>
                    <td style="white-space: nowrap;">
                      <button class="btn sm primary" type="button" [disabled]="saving()" (click)="save(c.id)">Save</button>
                      <button class="btn sm ghost" type="button" [disabled]="saving()" (click)="cancelEdit()">Cancel</button>
                    </td>
                  </tr>
                } @else {
                  <tr>
                    <td>{{ c.contact_name }}</td>
                    <td>{{ c.relationship ?? '—' }}</td>
                    <td class="mono">{{ c.contact_phone ?? '—' }}</td>
                    @if (canEdit()) {
                      <td style="white-space: nowrap;">
                        <button class="btn sm ghost" type="button" (click)="startEdit(c)">Edit</button>
                        <button class="btn sm ghost" type="button" (click)="remove(c)">Remove</button>
                      </td>
                    }
                  </tr>
                }
              }
              @if (addingNew()) {
                <tr>
                  <td><input class="input" [(ngModel)]="form['contact_name']" placeholder="Name" /></td>
                  <td>
                    <select class="input" [(ngModel)]="form['relationship']">
                      <option [value]="null">—</option>
                      @for (r of RELATIONSHIPS; track r) {
                        <option [value]="r">{{ r }}</option>
                      }
                    </select>
                  </td>
                  <td><input class="input" [(ngModel)]="form['contact_phone']" placeholder="10-digit mobile" /></td>
                  <td style="white-space: nowrap;">
                    <button class="btn sm primary" type="button" [disabled]="saving()" (click)="save(null)">Save</button>
                    <button class="btn sm ghost" type="button" [disabled]="saving()" (click)="cancelEdit()">Cancel</button>
                  </td>
                </tr>
              }
              @if (!contacts().length && !addingNew()) {
                <tr><td [attr.colspan]="canEdit() ? 4 : 3" class="cell-sub">No emergency contacts on file.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class EmpEmergencyContactsComponent implements OnInit {
  readonly employeeId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly RELATIONSHIPS = ['Spouse', 'Parent', 'Sibling', 'Friend', 'Other'];

  protected readonly isLoading = signal(true);
  protected readonly contacts = signal<readonly EmergencyContactRow[]>([]);
  protected readonly editingId = signal<string | null>(null);
  protected readonly addingNew = signal(false);
  protected readonly saving = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<EmergencyContactRow[]>(`${environment.apiBaseUrl}/employees/${this.employeeId()}/emergency-contacts`).subscribe({
      next: (rows) => {
        this.contacts.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startAdd(): void {
    this.form = { contact_name: '', relationship: null, contact_phone: '', is_primary: true, display_order: this.contacts().length + 1 };
    this.editingId.set(null);
    this.addingNew.set(true);
    this.actionError.set(null);
  }

  protected startEdit(c: EmergencyContactRow): void {
    this.form = { contact_name: c.contact_name, relationship: c.relationship, contact_phone: c.contact_phone, is_primary: c.is_primary, display_order: c.display_order };
    this.addingNew.set(false);
    this.editingId.set(c.id);
    this.actionError.set(null);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.addingNew.set(false);
  }

  protected save(id: string | null): void {
    if (!this.form['contact_name']) {
      this.actionError.set('Contact Name is required.');
      return;
    }
    this.saving.set(true);
    this.actionError.set(null);
    const base = `${environment.apiBaseUrl}/employees/${this.employeeId()}/emergency-contacts`;
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

  protected remove(c: EmergencyContactRow): void {
    if (!window.confirm(`Remove ${c.contact_name} as an emergency contact?`)) return;
    this.actionError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/employees/${this.employeeId()}/emergency-contacts/${c.id}`).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to remove this contact.'),
    });
  }
}
