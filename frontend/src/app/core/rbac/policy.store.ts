import { Injectable, inject } from '@angular/core';

import { SessionStore } from '../auth/session.store';
import { FieldMode, PolicyScreen } from '../auth/session.model';

const VISIBLE_MODES = new Set(['full', 'view', 'view_team', 'own', 'team']);
const READONLY_MODES = new Set(['view', 'view_team']);
// Read-only verbs are always allowed once a screen is visible at all — same
// list ARCH-3 §4 specifies (view/open/export/download/preview/print/cancel/
// back/close/clear) — these aren't real RolePermissionAction rows server-side
// (Layer 2 only exists for genuine WRITE actions), so there's nothing to
// look up; a visible screen can always be looked at, exported, printed.
const ALWAYS_ALLOWED = /^(view|open|export|download|preview|print|cancel|back|close|clear)/i;

/** Client-side RBAC is UX only — the API is the authority (Invariant 2).
 * This store exists to hide/disable controls a request would 403/404 on
 * anyway, never to enforce anything by itself.
 */
@Injectable({ providedIn: 'root' })
export class PolicyStore {
  private readonly session = inject(SessionStore);

  screen(screenId: string): PolicyScreen | null {
    return this.session.policy().screens[screenId] ?? null;
  }

  canOpen(screenId: string): boolean {
    const s = this.screen(screenId);
    return !!s && VISIBLE_MODES.has(s.mode);
  }

  isReadOnly(screenId: string): boolean {
    const s = this.screen(screenId);
    return !!s && READONLY_MODES.has(s.mode);
  }

  can(screenId: string, action: string): boolean {
    if (ALWAYS_ALLOWED.test(action)) return this.canOpen(screenId);
    const s = this.screen(screenId);
    return !!s && VISIBLE_MODES.has(s.mode) && s.actions.includes(action);
  }

  fieldMode(screenId: string, fieldKey: string): FieldMode {
    return this.screen(screenId)?.fields[fieldKey] ?? 'show';
  }
}
