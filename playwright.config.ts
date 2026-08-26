import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Meshrd CMS (build-docs/E2E-HARDENING-PROMPT.md).
 *
 * Replaces the `npm init playwright` scaffold, whose example spec pointed at
 * playwright.dev and tested nothing in this repo.
 */
export default defineConfig({
  testDir: './tests',

  /**
   * NOT fullyParallel, and this is deliberate (§2 of the prompt).
   *
   * Every spec here drives ONE shared MySQL database. Two workers creating a
   * Department at the same time, or one reading Masters while another mutates
   * it, produce failures that look exactly like product bugs and waste far
   * more time than the parallelism saves. Read-only suites opt back in
   * per-file with `test.describe.configure({ mode: 'parallel' })`.
   */
  fullyParallel: false,
  workers: 1,

  /**
   * Zero retries, everywhere — including CI.
   *
   * A test that passes on retry is hiding either a race in the test or a real
   * bug in the app. Retries would convert both into silence, which is the
   * opposite of why this suite exists.
   */
  retries: 0,

  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // These are local dev servers; a slow first compile should not read as a
    // product failure.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Chromium locally for fast triage; the full matrix runs in CI, where the
  // cost is paid by the machine rather than by the person waiting.
  projects: process.env.CI
    ? [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      ]
    : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Both servers. `reuseExistingServer` matters a lot in local dev here: the
   * backend must NOT be started with --reload on this machine (it can serve
   * stale code from a process that looks freshly started), and the dev servers
   * are usually already up.
   */
  webServer: [
    {
      command: 'npm start',
      cwd: 'frontend',
      url: 'http://localhost:4200',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: '.venv/Scripts/python.exe -m uvicorn app.main:app --port 8001',
      cwd: 'backend',
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
