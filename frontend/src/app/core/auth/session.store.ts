import { Injectable, computed, signal } from '@angular/core';

import { CurrentUser, EMPTY_POLICY } from './session.model';

/** Who you are — one of the three root stores (ARCH-3 §2). */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly _user = signal<CurrentUser | null>(null);
  readonly user = this._user.asReadonly();
  readonly role = computed(() => this._user()?.role ?? null);
  readonly isAuthed = computed(() => this._user() !== null);
  readonly mustChangePassword = computed(() => this._user()?.mustChangePassword ?? false);
  readonly policy = computed(() => this._user()?.policy ?? EMPTY_POLICY);
  // RBAC §4.2 — set only while previewing another role; `role` above is
  // ALWAYS the real authenticated role, never the previewed one.
  readonly previewingAs = computed(() => this._user()?.previewingAs ?? null);

  set(user: CurrentUser | null): void {
    this._user.set(user);
  }
}
