import { test, expect, login, authenticate, type Role } from '../fixtures/auth';

/**
 * A view-only role must not be handed a working form.
 *
 * screenRoute()'s guard checks only VISIBILITY (PolicyStore.canOpen), so a role
 * with 'view' on a screen was correctly shown a list with no Add button and a
 * Read-only badge — and could still type the /new or /:id/edit URL and get a
 * fully editable form. Every field enabled, Save enabled. The server refused
 * the write with a 403, so the only feedback arrived after filling the form.
 *
 * The list screens were right and the forms behind them were not, which is
 * exactly the kind of gap a screen-level audit misses: nothing in the UI links
 * to those URLs, so nobody had opened them.
 *
 * Not a privilege escalation — the API always refused — but a promise the app
 * could not keep, and the same class of dishonesty as a button that does
 * nothing.
 *
 * Gated on screen MODE rather than an action verb, deliberately: ticket.list
 * declares no 'edit' action at all (create/reassign/close), so an action check
 * would report ITS form read-only for Super Admin. The last case below pins
 * that, so the fix cannot be "tightened" back into a regression.
 */
interface Case {
  role: Role;
  screen: string;
  path: string;
  title: RegExp;
}

/** Roles that hold 'view' on a Masters screen — each can open the list and must
 * not be able to edit through it. Verified against the live policy, not assumed. */
const VIEW_ONLY: Case[] = [
  { role: 'ACCOUNTANT', screen: 'masters.taxes', path: '/masters/taxes/new', title: /tax/i },
  { role: 'EMPLOYEE', screen: 'masters.leave_types', path: '/masters/leave-types/new', title: /leave type/i },
  { role: 'MANAGER', screen: 'masters.bank_accounts', path: '/masters/bank-accounts/new', title: /bank account/i },
  { role: 'HR', screen: 'masters.insurance_plans', path: '/masters/insurance-plans/new', title: /insurance/i },
  { role: 'EMPLOYEE', screen: 'masters.holidays', path: '/masters/holidays/new', title: /holiday/i },
];

test.describe('a view-only role cannot be handed a working form', () => {
  for (const { role, screen, path } of VIEW_ONLY) {
    test(`${role} on ${path}`, async ({ page, request }) => {
      test.setTimeout(90_000);

      const session = await login(request, role);

      // The premise: this role really does hold view-only on this screen. If
      // the policy changes, this test should say so rather than quietly pass
      // for the wrong reason.
      const policy = session.screens[screen];
      expect(policy, `${role} should be able to open ${screen}`).toBeTruthy();
      expect(['view', 'view_team'], `${role} should be view-only on ${screen}`).toContain(policy.mode);

      await authenticate(page, session);
      await page.goto(path);
      await page.locator('.page-title, .empty, h1').first().waitFor({ state: 'visible', timeout: 20_000 });

      // It must say plainly that this is not something the role can do...
      await expect(
        page.getByText(/view-only access/i),
        'a view-only role must be told why, not shown an empty form',
      ).toBeVisible({ timeout: 15_000 });

      // ...and must not offer a Save that the API will refuse.
      await expect(page.getByRole('button', { name: /^Save/ }), 'no Save on a form this role cannot submit').toHaveCount(
        0,
      );

      // No editable inputs at all — the whole point is that the form is not
      // filled in and then rejected.
      // Scoped to the page body, not the document: the app shell's own topbar
      // carries a global search box on every screen, which is not this form's.
      const editable = await page
        .locator('.canvas-inner')
        .locator('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
        .count();
      expect(editable, 'a view-only role should have nothing to type into').toBe(0);
    });
  }

  test('SUPER_ADMIN still gets a working form on a screen that declares no edit action', async ({ page, request }) => {
    test.setTimeout(90_000);

    // ticket.list's actions are create/reassign/close — there is no 'edit'
    // action to grant. Checking a bare can(id, 'edit') here would report the
    // form read-only for the one role that can definitely use it, which is why
    // canWrite() gates on mode instead.
    const session = await login(request, 'SUPER_ADMIN');
    expect(session.screens['ticket.list'].mode).toBe('full');

    await authenticate(page, session);
    await page.goto('/tickets/new');
    await page.locator('.page-title, .empty, h1').first().waitFor({ state: 'visible', timeout: 20_000 });

    await expect(page.getByText(/view-only access/i), 'Super Admin is not view-only here').toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Save/ }),
      'a screen with no declared edit action must still be writable by a full-mode role',
    ).toBeVisible({ timeout: 15_000 });
  });
});
