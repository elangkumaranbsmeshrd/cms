/**
 * Layer 4 (COMPLETE-TEST-PROMPT.md §"Shared spine"): `policy.store` —
 * "canOpen / isReadOnly / can / fieldMode across all 6 modes; ALWAYS_ALLOWED
 * verbs permitted on a view-only screen".
 *
 * This store is the whole client-side RBAC surface — every screen route guard
 * (screen-access.guard.ts), every *ngIf on a button (can.directive.ts) and
 * every masked field reads through these four methods. The store's own doc
 * comment is right that the API is the authority (Invariant 2), so a wrong
 * answer here leaks a CONTROL rather than DATA — but "the server will 403 it
 * anyway" is not a reason to let a default drift open, so the closed-by-
 * default cases are asserted explicitly rather than assumed:
 *
 *   - no session yet / policy not loaded  -> everything false
 *   - screen absent from the policy       -> everything false
 *   - mode 'none'                         -> everything false
 *
 * The 'none' branch is defensive only in practice: the server never sends
 * mode:'none' at all — get_me() (backend/app/api/v1/auth.py) filters
 * `if perms.mode != "none"`, so an invisible screen is OMITTED from
 * policy.screens entirely. Absence, not 'none', is the real-world signal, and
 * both paths are covered below.
 */
import { TestBed } from '@angular/core/testing';

import { PolicyStore } from './policy.store';
import { SessionStore } from '../auth/session.store';
import { CurrentUser, FieldMode, PolicyScreen, ScreenMode } from '../auth/session.model';

const SCREEN = 'invoice.list';
const ABSENT = 'payroll.run';

/** Every verb in policy.store.ts's own ALWAYS_ALLOWED regex, in source order. */
const ALWAYS_ALLOWED_VERBS = [
  'view',
  'open',
  'export',
  'download',
  'preview',
  'print',
  'back',
  'clear',
  // 'cancel' and 'close' were here and have been REMOVED from the
  // implementation: both are real granted action names in seed.py
  // ('close' on ticket.list, restricted to SUPER_ADMIN/MANAGER;
  // 'cancel' on leave.my_leave), so treating them as free read verbs
  // handed out a control the API would then refuse.
] as const;

/** The full ScreenMode union — confirmed against session.model.ts, which in
 * turn mirrors the server's own VISIBLE_MODES/READONLY_MODES sets
 * (backend/app/rbac/resolver.py). Written as an exhaustive Record so the
 * BUILD fails, not just a test, if a seventh mode ever appears server-side. */
const MODE_UNION: Record<ScreenMode, true> = {
  none: true,
  full: true,
  view: true,
  view_team: true,
  own: true,
  team: true,
};
const ALL_MODES = Object.keys(MODE_UNION) as ScreenMode[];

interface ModeExpectation {
  readonly mode: ScreenMode;
  readonly opens: boolean;
  readonly readOnly: boolean;
  /** can() for an action the policy DID grant on this screen. */
  readonly grantedAction: boolean;
}

const MODE_TABLE: readonly ModeExpectation[] = [
  { mode: 'none', opens: false, readOnly: false, grantedAction: false },
  { mode: 'full', opens: true, readOnly: false, grantedAction: true },
  { mode: 'view', opens: true, readOnly: true, grantedAction: true },
  { mode: 'view_team', opens: true, readOnly: true, grantedAction: true },
  { mode: 'own', opens: true, readOnly: false, grantedAction: true },
  { mode: 'team', opens: true, readOnly: false, grantedAction: true },
];

function row(mode: ScreenMode, actions: string[] = [], fields: Record<string, FieldMode> = {}): PolicyScreen {
  return { label: 'Invoice', module: 'invoice', mode, actions, fields };
}

describe('PolicyStore', () => {
  let policy: PolicyStore;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    session = TestBed.inject(SessionStore);
    policy = TestBed.inject(PolicyStore);
  });

  /** Puts a resolved policy on the session, exactly as AuthService does after
   * GET /api/v1/me. */
  function load(screens: Record<string, PolicyScreen>): void {
    const user: CurrentUser = {
      id: 'u-1',
      email: 'tester@meshrd.in',
      fullName: 'Test User',
      role: 'EMPLOYEE',
      mustChangePassword: false,
      previewingAs: null,
      policy: { version: '2026-01-01T00:00:00', screens },
    };
    session.set(user);
  }

  // ---------------------------------------------------------------------
  // Closed by default — the security-relevant half of this file.
  // ---------------------------------------------------------------------

  describe('before the policy has loaded (no session at all)', () => {
    // SessionStore.policy() falls back to EMPTY_POLICY ({ screens: {} }) while
    // the app initializer is still in flight. Anything rendered in that window
    // must behave as if the user has nothing.

    it('has no screen row for anything', () => {
      expect(policy.screen(SCREEN)).toBeNull();
    });

    it('canOpen is false — it fails CLOSED, it does not optimistically open', () => {
      expect(policy.canOpen(SCREEN)).toBe(false);
    });

    it('isReadOnly is false (nothing to be read-only about — canOpen is the gate)', () => {
      expect(policy.isReadOnly(SCREEN)).toBe(false);
    });

    it('can() is false for a write action', () => {
      expect(policy.can(SCREEN, 'edit')).toBe(false);
      expect(policy.can(SCREEN, 'delete')).toBe(false);
    });

    it('can() is false for EVERY always-allowed verb — the shortcut still routes through canOpen', () => {
      // The one place a "read-only verbs are free" rule could plausibly have
      // failed open. It does not: ALWAYS_ALLOWED returns canOpen(), which is
      // false with no policy.
      for (const verb of ALWAYS_ALLOWED_VERBS) {
        expect(policy.can(SCREEN, verb)).withContext(`can('${verb}') with no policy`).toBe(false);
      }
    });

    it('fieldMode returns "show" — the default is open, but it is unreachable behind canOpen', () => {
      // Deliberately pinned rather than glossed over. fieldMode() is
      // `screen(id)?.fields[key] ?? 'show'`, so an unknown screen yields
      // 'show' for every field. That mirrors the server exactly
      // (PermissionSet.field_mode -> field_modes.get(key, "show")): fields are
      // declared only when RESTRICTED, so "not mentioned" legitimately means
      // visible. It is not a hole because no screen renders its fields until
      // canOpen() has already said yes, and canOpen() is false here.
      expect(policy.fieldMode(SCREEN, 'grand_total')).toBe('show');
    });
  });

  describe('a screen the policy does not mention', () => {
    beforeEach(() => load({ [SCREEN]: row('full', ['edit']) }));

    it('screen() is null', () => {
      expect(policy.screen(ABSENT)).toBeNull();
    });

    it('canOpen is false — absence is how the server says "invisible"', () => {
      expect(policy.canOpen(ABSENT)).toBe(false);
    });

    it('isReadOnly is false', () => {
      expect(policy.isReadOnly(ABSENT)).toBe(false);
    });

    it('can() is false for both write actions and always-allowed verbs', () => {
      expect(policy.can(ABSENT, 'run')).toBe(false);
      for (const verb of ALWAYS_ALLOWED_VERBS) {
        expect(policy.can(ABSENT, verb)).withContext(`can('${verb}') on an absent screen`).toBe(false);
      }
    });

    it('does not leak a neighbouring screen\'s grant', () => {
      expect(policy.can(ABSENT, 'edit')).toBe(false);
      expect(policy.can(SCREEN, 'edit')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // All six modes.
  // ---------------------------------------------------------------------

  describe('across all six screen modes', () => {
    it('the table below covers every member of the ScreenMode union', () => {
      // ALL_MODES comes from the type-checked MODE_UNION record, so this is a
      // real coverage assertion: a seventh mode added server-side breaks the
      // build at MODE_UNION and then fails here until the table grows.
      expect([...MODE_TABLE].map((m) => m.mode).sort()).toEqual([...ALL_MODES].sort());
    });

    for (const spec of MODE_TABLE) {
      describe(`mode '${spec.mode}'`, () => {
        beforeEach(() => {
          load({ [SCREEN]: row(spec.mode, ['edit', 'record_payment'], { grand_total: 'mask' }) });
        });

        it(`canOpen is ${spec.opens}`, () => {
          expect(policy.canOpen(SCREEN)).toBe(spec.opens);
        });

        it(`isReadOnly is ${spec.readOnly}`, () => {
          expect(policy.isReadOnly(SCREEN)).toBe(spec.readOnly);
        });

        it(`can('edit') (granted) is ${spec.grantedAction}`, () => {
          // Note for the two read-only modes: mode and actions are ORTHOGONAL
          // by design, here and on the server. PermissionSet.can() is
          // `visible and action_key in allowed_actions` — no read-only gate —
          // and resolver.py only empties allowed_actions when the mode is not
          // visible at all. So a 'view'/'view_team' screen that was genuinely
          // granted 'edit' can act on it; isReadOnly is a display hint (the
          // read-only badge), never the write gate.
          expect(policy.can(SCREEN, 'edit')).toBe(spec.grantedAction);
        });

        it('can() is false for an action that was not granted, in every mode', () => {
          expect(policy.can(SCREEN, 'delete')).toBe(false);
          expect(policy.can(SCREEN, 'send')).toBe(false);
        });

        it('fieldMode still reads the declared field mode, independent of screen mode', () => {
          expect(policy.fieldMode(SCREEN, 'grand_total')).toBe('mask');
          expect(policy.fieldMode(SCREEN, 'invoice_number')).toBe('show');
        });
      });
    }

    it("mode 'none' refuses everything even with a full action list and no field restrictions", () => {
      load({ [SCREEN]: row('none', ['edit', 'delete', 'send', 'record_payment']) });
      expect(policy.canOpen(SCREEN)).toBe(false);
      expect(policy.isReadOnly(SCREEN)).toBe(false);
      expect(policy.can(SCREEN, 'edit')).toBe(false);
      expect(policy.can(SCREEN, 'delete')).toBe(false);
      for (const verb of ALWAYS_ALLOWED_VERBS) {
        expect(policy.can(SCREEN, verb)).withContext(`can('${verb}') on mode 'none'`).toBe(false);
      }
    });

    it('exactly the five visible modes open, and exactly the two view modes are read-only', () => {
      for (const mode of ALL_MODES) {
        load({ [SCREEN]: row(mode) });
        expect(policy.canOpen(SCREEN)).withContext(`canOpen for '${mode}'`).toBe(mode !== 'none');
        expect(policy.isReadOnly(SCREEN))
          .withContext(`isReadOnly for '${mode}'`)
          .toBe(mode === 'view' || mode === 'view_team');
      }
    });
  });

  // ---------------------------------------------------------------------
  // ALWAYS_ALLOWED — the doc's named case.
  // ---------------------------------------------------------------------

  describe('ALWAYS_ALLOWED verbs on a view-only screen', () => {
    beforeEach(() => {
      // The pointed case: 'view' mode, and the policy grants NO actions at
      // all. Every allowance below therefore comes from the regex, not from a
      // row in the action list.
      load({ [SCREEN]: row('view', []) });
    });

    for (const verb of ALWAYS_ALLOWED_VERBS) {
      it(`permits '${verb}' with no matching action row`, () => {
        expect(policy.can(SCREEN, verb)).toBe(true);
      });
    }

    it('permits them despite isReadOnly being true', () => {
      expect(policy.isReadOnly(SCREEN)).toBe(true);
      expect(policy.can(SCREEN, 'export')).toBe(true);
      expect(policy.can(SCREEN, 'print')).toBe(true);
    });

    it('is case-insensitive, per the /i flag', () => {
      expect(policy.can(SCREEN, 'View')).toBe(true);
      expect(policy.can(SCREEN, 'EXPORT')).toBe(true);
    });

    it('still refuses a genuine write verb on the same screen', () => {
      expect(policy.can(SCREEN, 'edit')).toBe(false);
      expect(policy.can(SCREEN, 'delete')).toBe(false);
      expect(policy.can(SCREEN, 'record_payment')).toBe(false);
    });

    it('treats an empty action string as not-always-allowed and refuses it', () => {
      expect(policy.can(SCREEN, '')).toBe(false);
    });

    it('permits the same verbs on a scoped write mode too', () => {
      load({ [SCREEN]: row('own', []) });
      expect(policy.can(SCREEN, 'download')).toBe(true);
      expect(policy.can(SCREEN, 'edit')).toBe(false);
    });

    // FINDING — ALWAYS_ALLOWED is an UNANCHORED PREFIX match:
    //   /^(view|open|export|download|preview|print|cancel|back|close|clear)/i
    // There is no `$` and no word boundary, so it swallows any REAL, granted-
    // per-role action whose name merely STARTS with one of those ten verbs.
    // Two such actions exist in the server's own vocabulary
    // (backend/app/rbac/registry/screens.py):
    //
    //   'close'                  — ticket.list; seed.py restricts it to
    //                              SUPER_ADMIN/MANAGER.
    //   'view_financial_summary' — invoice.list; SUPER_ADMIN only, plus
    //                              ACCOUNTANT behind the "Give Accountant Read
    //                              Access to Customer Financial Summary"
    //                              toggle (rbac/toggles.py).
    //
    // can() currently returns TRUE for both for anyone who can merely OPEN the
    // screen. The codebase already knows about the 'close' half and works
    // around it at two call sites (ticket.detail.component.ts's canClose(),
    // ticket.close.component.ts) by reading `screen(id)?.actions.includes(...)`
    // directly instead of calling can(). 'view_financial_summary' has no
    // frontend caller yet, so the leak is latent there.
    //
    // Impact is a leaked CONTROL, not leaked data — the server re-checks both
    // (require_screen(action=...) / perms.can("close")) — but it is the exact
    // shape of Layer 5's own Test 4 ("Manager sees no salary amounts unless
    // the flag is on"), so it is a finding rather than a quirk. Anchoring the
    // regex with `$` fixes it and keeps every genuine read verb working.
    // Kept as xit: this asserts the CORRECT behaviour, and fails today.
    it('does not permit a granted action that merely starts with an always-allowed verb', () => {
      load({
        'ticket.list': row('view', []),
        'invoice.list': row('view', []),
      });
      expect(policy.can('ticket.list', 'close')).toBe(false);
      expect(policy.can('invoice.list', 'view_financial_summary')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // fieldMode.
  // ---------------------------------------------------------------------

  describe('fieldMode', () => {
    beforeEach(() => {
      load({
        [SCREEN]: row('full', ['edit'], { basic_salary_monthly: 'mask', bank_account_number: 'hide' }),
      });
    });

    it('returns "show" for a field with no declared mode', () => {
      expect(policy.fieldMode(SCREEN, 'invoice_number')).toBe('show');
    });

    it('returns "mask" for a masked field', () => {
      expect(policy.fieldMode(SCREEN, 'basic_salary_monthly')).toBe('mask');
    });

    it('returns "hide" for a hidden field', () => {
      expect(policy.fieldMode(SCREEN, 'bank_account_number')).toBe('hide');
    });

    it('returns "show" for an empty field key rather than undefined', () => {
      expect(policy.fieldMode(SCREEN, '')).toBe('show');
    });

    it('keeps the declared modes when the screen is read-only', () => {
      load({ [SCREEN]: row('view', [], { basic_salary_monthly: 'mask' }) });
      expect(policy.fieldMode(SCREEN, 'basic_salary_monthly')).toBe('mask');
    });

    it('never returns undefined for an unknown screen — always a valid FieldMode', () => {
      const mode: FieldMode = policy.fieldMode(ABSENT, 'anything');
      expect(mode).toBe('show');
      expect(['show', 'mask', 'hide']).toContain(mode);
    });
  });

  // ---------------------------------------------------------------------
  // Liveness — RBAC changes must take effect without a reload.
  // ---------------------------------------------------------------------

  describe('reacting to a policy change', () => {
    it('re-reads the session on every call, so a re-fetched policy takes effect immediately', () => {
      load({ [SCREEN]: row('view', []) });
      expect(policy.canOpen(SCREEN)).toBe(true);
      expect(policy.isReadOnly(SCREEN)).toBe(true);
      expect(policy.can(SCREEN, 'edit')).toBe(false);

      load({ [SCREEN]: row('full', ['edit']) });
      expect(policy.isReadOnly(SCREEN)).toBe(false);
      expect(policy.can(SCREEN, 'edit')).toBe(true);
    });

    it('closes back down when the session is cleared (logout)', () => {
      load({ [SCREEN]: row('full', ['edit']) });
      expect(policy.can(SCREEN, 'edit')).toBe(true);

      session.set(null);
      expect(policy.canOpen(SCREEN)).toBe(false);
      expect(policy.can(SCREEN, 'edit')).toBe(false);
      expect(policy.can(SCREEN, 'view')).toBe(false);
    });
  });
});
