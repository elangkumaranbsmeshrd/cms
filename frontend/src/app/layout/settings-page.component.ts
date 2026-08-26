import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SessionStore } from '../core/auth/session.store';
import { ACCENTS, AccentName, SCALES, UiStore } from '../core/ui/ui.store';
import { environment } from '../../environments/environment';

type SettingsTab = 'appearance' | 'regional' | 'system' | 'about';

/** Ported from prototype/app-screens2.js's R.settings — same 4 tabs, same
 * copy. Appearance is the one tab with real, live behavior (it's what
 * UiStore's own effects actually apply); Regional & Financial / System stay
 * decorative on purpose, exactly as they were in the prototype (no backend
 * concept of these preferences exists yet — "report what it would do," the
 * same convention the prototype itself documented for anything not backed
 * by real data). Super-Admin only, matching the prototype's own profile-menu
 * gate — there's no RBAC screen key for Settings (it configures the shell,
 * not a module), so this checks the role directly rather than PolicyStore.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (!isSuperAdmin()) {
      <div class="empty">
        <div class="ico">🔒</div>
        <p><b>Settings is Super Admin only</b></p>
        <p class="hint">Ask a Super Admin to make changes here.</p>
      </div>
    } @else {
      <div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">Appearance, regional defaults, and system-wide behaviour.</p>
        </div>
      </div>

      <div class="tabs">
        @for (t of tabDefs; track t.id) {
          <div class="tab" [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</div>
        }
      </div>

      @if (tab() === 'appearance') {
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Theme</h3>
              <div class="sub">Applies instantly across every screen, held in memory for this session only</div>
            </div>
          </div>
          <div class="card-body">
            <div class="theme-picker">
              <div class="theme-opt" [class.on]="ui.theme() === 'light'" (click)="ui.theme.set('light')">
                <div class="theme-prev" style="background: #ffffff;">
                  <div class="tp-side" style="background: #14171e;"></div>
                  <div class="tp-main">
                    <div class="tp-bar" style="background: #2a4bd7; width: 44%;"></div>
                    <div class="tp-bar" style="background: #e0e3e9;"></div>
                    <div class="tp-bar" style="background: #e0e3e9; width: 72%;"></div>
                  </div>
                </div>
                <div class="tn">☀ Light<span class="radio-dot"></span></div>
                <div class="td">Cool grey canvas, dark sidebar. The default.</div>
              </div>
              <div class="theme-opt" [class.on]="ui.theme() === 'dark'" (click)="ui.theme.set('dark')">
                <div class="theme-prev" style="background: #111419;">
                  <div class="tp-side" style="background: #0a0c11;"></div>
                  <div class="tp-main">
                    <div class="tp-bar" style="background: #7592ff; width: 44%;"></div>
                    <div class="tp-bar" style="background: #232830;"></div>
                    <div class="tp-bar" style="background: #232830; width: 72%;"></div>
                  </div>
                </div>
                <div class="tn">☾ Dark<span class="radio-dot"></span></div>
                <div class="td">Near-black canvas, lifted surfaces, softened accent.</div>
              </div>
              <div class="theme-opt" (click)="ui.theme.set(systemPrefersDark() ? 'dark' : 'light')">
                <div class="theme-prev" [style.background]="systemPrefersDark() ? '#111419' : '#ffffff'">
                  <div class="tp-side" [style.background]="systemPrefersDark() ? '#0a0c11' : '#14171e'"></div>
                  <div class="tp-main">
                    <div class="tp-bar" [style.background]="systemPrefersDark() ? '#7592ff' : '#2a4bd7'" style="width: 44%;"></div>
                    <div class="tp-bar" [style.background]="systemPrefersDark() ? '#232830' : '#e0e3e9'"></div>
                    <div class="tp-bar" [style.background]="systemPrefersDark() ? '#232830' : '#e0e3e9'" style="width: 72%;"></div>
                  </div>
                </div>
                <div class="tn">⚙ Match system<span class="radio-dot"></span></div>
                <div class="td">Follows the operating system setting.</div>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <span style="font-size: 11px; color: var(--text-tertiary);">
              Theme is held in memory for this session only — nothing is written to browser storage. A quick toggle also sits in the header.
            </span>
          </div>
        </div>

        <div style="height: 12px;"></div>

        <div class="card">
          <div class="card-head">
            <div>
              <h3>Accent Color</h3>
              <div class="sub">Changes live, across every screen, right now</div>
            </div>
          </div>
          <div class="card-body">
            <div style="display: flex; gap: 14px; flex-wrap: wrap; padding: 2px 0;">
              @for (name of accentNames; track name) {
                <div style="cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 70px;" (click)="ui.accent.set(name)">
                  <div
                    style="width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: #fff;"
                    [style.background]="swatchFor(name)"
                    [style.border]="'2px solid ' + (ui.accent() === name ? swatchFor(name) : 'transparent')"
                    [style.box-shadow]="ui.accent() === name ? '0 0 0 2px var(--surface), 0 0 0 3.5px ' + swatchFor(name) : '0 0 0 1px var(--border)'"
                  >
                    @if (ui.accent() === name) { ✓ }
                  </div>
                  <span
                    style="font-size: 11px; text-align: center;"
                    [style.color]="ui.accent() === name ? 'var(--text-primary)' : 'var(--text-tertiary)'"
                    [style.font-weight]="ui.accent() === name ? '600' : '400'"
                  >{{ accentLabel(name) }}</span>
                </div>
              }
              <div style="display: flex; flex-direction: column; align-items: center; gap: 6px; width: 70px;" title="Pick any colour">
                <label
                  style="cursor: pointer; position: relative; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
                    background: conic-gradient(#e11d48,#d97706,#facc15,#059669,#0d9488,#2a4bd7,#7c3aed,#e11d48);"
                  [style.border]="'2px solid ' + (ui.accent() === 'custom' ? ui.customAccent() : 'transparent')"
                  [style.box-shadow]="ui.accent() === 'custom' ? '0 0 0 2px var(--surface), 0 0 0 3.5px ' + ui.customAccent() : '0 0 0 1px var(--border)'"
                >
                  @if (ui.accent() === 'custom') {
                    <span style="width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff;" [style.background]="ui.customAccent()"></span>
                  }
                  <input
                    type="color"
                    [value]="ui.customAccent()"
                    style="position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;"
                    (input)="ui.setCustomAccent($any($event.target).value)"
                  />
                </label>
                <span
                  style="font-size: 11px; text-align: center;"
                  [style.color]="ui.accent() === 'custom' ? 'var(--text-primary)' : 'var(--text-tertiary)'"
                  [style.font-weight]="ui.accent() === 'custom' ? '600' : '400'"
                >Custom</span>
              </div>
            </div>
            @if (ui.accent() === 'custom') {
              <div style="margin-top: 12px; display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--text-secondary);">
                <span class="mono" style="padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-sunk);">
                  {{ ui.customAccent().toUpperCase() }}
                </span>
                <span>Hover, subtle-fill and hairline shades are derived from this one colour automatically, and re-derived for Dark.</span>
              </div>
            }
          </div>
          <div class="card-foot">
            <span style="font-size: 11px; color: var(--text-tertiary);">
              Recolors every accent-tinted element — primary buttons, active nav, links, focus rings — in both Light and Dark.
            </span>
          </div>
        </div>

        <div style="height: 12px;"></div>

        <div class="card">
          <div class="card-head">
            <div>
              <h3>Display Scale</h3>
              <div class="sub">Sizes the entire interface, live — currently {{ ui.scale() }}%</div>
            </div>
          </div>
          <div class="card-body">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              @for (n of scales; track n) {
                <button class="btn" [class.primary]="ui.scale() === n" type="button" (click)="ui.setScale(n)">{{ n }}%</button>
              }
              <span style="margin-left: 6px; font-size: 11.5px; color: var(--text-tertiary);">or drag</span>
              <input
                type="range"
                min="80"
                max="200"
                step="5"
                [value]="ui.scale()"
                style="flex: 1; min-width: 180px; accent-color: var(--accent);"
                (input)="ui.setScale($any($event.target).valueAsNumber)"
              />
            </div>
          </div>
          <div class="card-foot">
            <span style="font-size: 11px; color: var(--text-tertiary);">
              100% is the design baseline; <b>110% is the default</b>, the size this app was reviewed at.
            </span>
          </div>
        </div>

        <div style="height: 12px;"></div>

        <div class="card">
          <div class="card-head"><h3>Display</h3></div>
          <div class="card-body">
            <div class="set-row">
              <div>
                <div class="t">Dense tables</div>
                <div class="d">13px base type and 30px controls. Turning this off adds vertical breathing room at the cost of rows per screen.</div>
              </div>
              <div class="ctl"><span class="toggle" [class.on]="denseTables()" (click)="denseTables.set(!denseTables())"><span class="track"></span></span></div>
            </div>
            <div class="set-row">
              <div>
                <div class="t">Collapse sidebar by default</div>
                <div class="d">Starts every session with the icon-only rail instead of the full module tree.</div>
              </div>
              <div class="ctl">
                <span class="toggle" [class.on]="ui.sidebarCollapsed()" (click)="ui.sidebarCollapsed.set(!ui.sidebarCollapsed())"><span class="track"></span></span>
              </div>
            </div>
          </div>
        </div>
      }

      @if (tab() === 'regional') {
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Regional & Financial</h3>
              <div class="sub">Drawn from Masters where a master already owns the value</div>
            </div>
          </div>
          <div class="card-body">
            <div class="set-row">
              <div>
                <div class="t">Active Financial Year</div>
                <div class="d">Sourced from Masters → Financial Year — not editable here.</div>
              </div>
              <div class="ctl"><a class="link" routerLink="/masters/financial-years">Open Financial Year →</a></div>
            </div>
            <div class="set-row">
              <div>
                <div class="t">Date format</div>
                <div class="d">Used across every list, record and export in the CMS.</div>
              </div>
              <div class="ctl"><span class="badge-s b-neutral">dd-mm-yyyy</span></div>
            </div>
            <div class="set-row">
              <div>
                <div class="t">Payroll basis</div>
                <div class="d">Hour-Basis, live — required hours come from Masters → Work Week & Hours.</div>
              </div>
              <div class="ctl"><span class="badge-s b-ok">Hour-Basis</span></div>
            </div>
          </div>
        </div>
      }

      @if (tab() === 'system') {
        <div class="card">
          <div class="card-head">
            <div>
              <h3>System</h3>
              <div class="sub">Super Admin only</div>
            </div>
          </div>
          <div class="card-body">
            <div class="set-row">
              <div>
                <div class="t">Filter persistence</div>
                <div class="d">Applied filters persist for a user, on a screen, within a session — deliberately not across sessions.</div>
              </div>
              <div class="ctl"><span class="toggle on"><span class="track"></span><span class="tl">Within session</span></span></div>
            </div>
            <div class="set-row">
              <div>
                <div class="t">Export header block</div>
                <div class="d">Every exported file carries the filters that produced it, the result count, who exported it, and when.</div>
              </div>
              <div class="ctl"><span class="toggle on"><span class="track"></span><span class="tl">Always</span></span></div>
            </div>
            <div class="set-row">
              <div>
                <div class="t">Roles &amp; Access</div>
                <div class="d">Screen visibility, action permissions, field-level toggles and scope all live in their own module.</div>
              </div>
              <div class="ctl"><a class="link" routerLink="/rbac/matrix">Open Role Permission Matrix →</a></div>
            </div>
          </div>
        </div>
      }

      @if (tab() === 'about') {
        <div class="card">
          <div class="card-head"><h3>About this build</h3></div>
          <div class="card-body">
            <div class="set-row">
              <div>
                <div class="t">Meshrd CMS — Angular frontend</div>
                <div class="d">{{ visibleScreenCount() }} screens visible to your role right now, live from the real backend at {{ apiBase }}. No mock data.</div>
              </div>
            </div>
            <div class="grid g-3" style="margin: 0;">
              <div class="kpi">
                <div class="kpi-top"><div class="kpi-ico">📋</div><div class="kpi-label">Screens you can open</div></div>
                <div class="kpi-val">{{ visibleScreenCount() }}</div>
              </div>
              <div class="kpi">
                <div class="kpi-top"><div class="kpi-ico">🗂</div><div class="kpi-label">Modules</div></div>
                <div class="kpi-val">{{ moduleCount() }}</div>
              </div>
              <div class="kpi">
                <div class="kpi-top"><div class="kpi-ico">👤</div><div class="kpi-label">Your role</div></div>
                <div class="kpi-val" style="font-size: 18px;">{{ session.role() }}</div>
              </div>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class SettingsPageComponent {
  protected readonly session = inject(SessionStore);
  protected readonly ui = inject(UiStore);

  /** Case-insensitive, and the SAME test the sidebar's Settings link uses — an
   * exact-match check here would have disagreed with the link and shown a
   * locked page to the one role allowed to open it. */
  protected readonly isSuperAdmin = computed(() => (this.session.role() ?? '').toUpperCase() === 'SUPER_ADMIN');

  protected readonly tab = signal<SettingsTab>('appearance');
  protected readonly denseTables = signal(true);
  /** Read from the environment, never re-declared — a second literal here went
   * stale the moment the production build started swapping environment.ts, and
   * would have shown every deployed user a dev URL on the About tab. */
  protected readonly apiBase = environment.apiBaseUrl;

  protected readonly tabDefs: { id: SettingsTab; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'regional', label: 'Regional & Financial' },
    { id: 'system', label: 'System' },
    { id: 'about', label: 'About this build' },
  ];

  protected readonly scales = SCALES;
  protected readonly accentNames = Object.keys(ACCENTS) as AccentName[];

  protected accentLabel(name: AccentName): string {
    return ACCENTS[name].name.replace(' (default)', '');
  }

  protected swatchFor(name: AccentName): string {
    return ACCENTS[name][this.ui.theme() === 'dark' ? 'dark' : 'light'].accent;
  }

  protected systemPrefersDark(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  }

  protected visibleScreenCount(): number {
    const screens = this.session.policy().screens;
    return Object.values(screens).filter((s) => s.mode !== 'none').length;
  }

  protected moduleCount(): number {
    const screens = this.session.policy().screens;
    const modules = new Set(Object.values(screens).filter((s) => s.mode !== 'none').map((s) => s.module));
    return modules.size;
  }
}
