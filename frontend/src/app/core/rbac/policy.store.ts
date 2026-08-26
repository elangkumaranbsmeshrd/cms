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
/**
 * Verbs that need no per-action grant: reading, printing and navigating are
 * implied by being able to open a screen at all.
 *
 * ANCHORED, and deliberately. This was `/^(...)/i` with no `$`, so it matched
 * any granted action merely STARTING with one of these verbs — which silently
 * handed out `view_financial_summary` (seeded SUPER_ADMIN-only on invoice.list)
 * to everyone who could open the screen.
 *
 * `close` and `cancel` are gone from the list for a different reason: both are
 * REAL action names in the server's own vocabulary, not just navigation words.
 * `close` on ticket.list is seeded to SUPER_ADMIN/MANAGER, and `cancel` on
 * leave.my_leave is a genuine grant (currently held by all five roles, so
 * harmless today — and exactly the kind of latent hole that opens the moment
 * someone narrows it). Two ticket components already worked around the `close`
 * half by reading screen(id)?.actions directly instead of calling can(), which
 * is the tell that the list, not the call sites, was wrong.
 *
 * Before adding a verb here, check it is not also a granted action name:
 *   grep '"<verb>":' backend/app/seed.py
 *
 * The server re-checks every action regardless, so the old behaviour leaked a
 * CONTROL rather than data — a button offered to someone the API would then
 * refuse. That is still the failure this project's own spec calls out.
 */
const ALWAYS_ALLOWED = /^(view|open|export|download|preview|print|back|clear)$/i;

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
