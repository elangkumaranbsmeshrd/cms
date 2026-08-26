import { test, expect } from '../fixtures/auth';
import { login, authenticate } from '../fixtures/auth';

/**
 * APPENDIX-A A112 approves RBAC §4.2's "Preview as this role" — and attaches a
 * condition to that approval: the feature "MUST be unmistakably marked as
 * preview mode (persistent banner or border)". APPENDIX-B-business-rules.md:156
 * repeats it in the same words.
 *
 * The switcher shipped; the marking did not. For a long time the only
 * indication was a small topbar pill reading "Previewing", styled identically
 * to the passive "Viewing as" label it replaced.
 *
 * That is worth a permanent test because preview genuinely changes server-side
 * authority — the X-Preview-Role header is honoured by require_screen, so
 * screens really do disappear and rows really do vanish. A Super Admin who has
 * forgotten they are previewing sees an application that looks broken rather
 * than restricted.
 *
 * (Preview can only NARROW, and only for a caller whose JWT role is genuinely
 * SUPER_ADMIN — backend/app/rbac/deps.py checks the real role first. This test
 * is about honesty of the UI, not about an escalation path.)
 */
test.describe('preview mode is unmistakably marked', () => {
  test('banner and shell border appear only while previewing, and can be exited', async ({ page, request }) => {
    test.setTimeout(90_000);

    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);
    await page.goto('/dashboard');
    await page.locator('.app').waitFor({ state: 'visible', timeout: 20_000 });

    // Baseline: a Super Admin using their own access sees neither marker.
    await expect(page.locator('.preview-banner'), 'no banner when not previewing').toHaveCount(0);
    await expect(page.locator('.app.previewing'), 'no shell border when not previewing').toHaveCount(0);

    // Enter preview through the real topbar control, not by poking state.
    await page.locator('.role-switch').click();
    await page.locator('.menu-item').filter({ hasText: /^\s*Employee\s*$/ }).first().click();

    // Both forms A112 allows must be present.
    await expect(page.locator('.preview-banner'), 'persistent banner while previewing').toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.preview-banner')).toContainText(/previewing as/i);
    await expect(page.locator('.preview-banner'), 'banner names the previewed role').toContainText(/EMPLOYEE/i);
    await expect(page.locator('.app.previewing'), 'shell border while previewing').toHaveCount(1);

    // The banner must offer its own way out — a user who reaches for the
    // marker to escape the mode should not have to hunt for the topbar menu.
    await page.locator('.preview-exit').click();
    await expect(page.locator('.preview-banner'), 'banner clears on exit').toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.app.previewing'), 'border clears on exit').toHaveCount(0);
  });
});
