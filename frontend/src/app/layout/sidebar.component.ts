import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { SessionStore } from '../core/auth/session.store';
import { UiStore } from '../core/ui/ui.store';
import { AuthService } from '../core/auth/auth.service';
import { IconComponent } from '../shared/ui/icon.component';
import { NAV_MODULES, SUB_SCREEN_KEYS, VIEW_ONLY_SUB_SCREEN_KEYS, routeForScreen } from './nav-registry';
import { RoleButtonDirective } from '../shared/ui/role-button.directive';

interface SubItem {
  screenId: string;
  label: string;
  route: string[];
}
interface ModuleRow {
  id: string;
  label: string;
  icon: string;
  items: SubItem[];
}
interface NavGroupRow {
  label: string;
  modules: ModuleRow[];
}

/** The prototype's own sidebar shape (app-core.js's renderNav, data.js's
 * MODULES array): a collapsible MODULE header (icon + label + chevron) per
 * group, expanding to its own screens — not a flat "group label + every
 * screen underneath" list. Matched 1:1 including group names/order/icons
 * (see nav-registry.ts's own NAV_MODULES doc for why a screen's module can't
 * just be its key's own dot-prefix).
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, RoleButtonDirective],
  template: `
    <aside class="sidebar">
      <nav class="nav">
        <a class="nav-item" routerLink="/dashboard" routerLinkActive="active">
          <app-icon name="dash" [size]="16" />
          <span class="txt">Dashboard</span>
        </a>
        @for (group of groups(); track group.label) {
          <div class="nav-label">{{ group.label }}</div>
          @for (mod of group.modules; track mod.id) {
            <div
              class="nav-item"
              [class.open]="isOpen(mod.id)"
              [class.active]="moduleActive(mod)"
              role="button"
              (click)="toggle(mod.id)"
            >
              <app-icon [name]="mod.icon" [size]="16" />
              <span class="txt">{{ mod.label }}</span>
              <app-icon name="arrow" [size]="12" [width]="2.4" class="chev" />
            </div>
            @if (isOpen(mod.id)) {
              <div class="subnav">
                @for (item of mod.items; track item.screenId) {
                  <a class="sub-item" [routerLink]="item.route" routerLinkActive="active">
                    <span class="txt">{{ item.label }}</span>
                  </a>
                }
              </div>
            }
          }
        }
      </nav>
      <div class="nav-foot">
        <!-- Settings configures the SHELL (theme, accent, scale), not a module,
             so it has no RBAC screen key and can never appear in the policy-
             driven groups above — which is exactly why it was missing. The
             prototype puts it here in the foot for the same reason
             (app-core.js:422). Super Admin only, matching the page's own gate. -->
        @if (isSuperAdmin()) {
          <a class="nav-item" routerLink="/settings" routerLinkActive="active">
            <app-icon name="settings" [size]="16" />
            <span class="txt">Settings</span>
          </a>
        }
        <div class="nav-item" (click)="logout()">
          <app-icon name="logout" [size]="16" />
          <span class="txt">Log out</span>
        </div>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  private readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly ui = inject(UiStore);

  // Reactive current URL — router.url itself isn't a signal, so every place
  // that needs "is this route active right now" (moduleActive, the
  // auto-open-on-navigate behaviour below) reads this instead of the raw
  // router snapshot, which never changes.
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  // Modules the user has explicitly clicked open. A module containing the
  // active route is ALSO shown open (isOpen() below) without needing a click
  // — mirrors the prototype's own `S.open[m.id] || isActive` (app-core.js).
  private readonly manuallyOpen = signal<Set<string>>(new Set());

  readonly groups = computed<NavGroupRow[]>(() => {
    const screens = this.session.policy().screens;
    const rows: NavGroupRow[] = [];
    for (const mod of NAV_MODULES) {
      const items: SubItem[] = Object.entries(screens)
        .filter(
          ([id, screen]) =>
            mod.screenPrefixes.some((p) => id.startsWith(p)) &&
            !SUB_SCREEN_KEYS.has(id) &&
            !(VIEW_ONLY_SUB_SCREEN_KEYS.has(id) && screen.mode === 'view'),
        )
        .map(([screenId, screen]) => ({ screenId, label: screen.label, route: routeForScreen(screenId) }));
      if (!items.length) continue; // RBAC Layer 1: a module with nothing visible doesn't render at all
      let group = rows.find((g) => g.label === mod.group);
      if (!group) {
        group = { label: mod.group, modules: [] };
        rows.push(group);
      }
      group.modules.push({ id: mod.id, label: mod.label, icon: mod.icon, items });
    }
    return rows;
  });

  isOpen(moduleId: string): boolean {
    return this.manuallyOpen().has(moduleId) || this.groups().some((g) => g.modules.some((m) => m.id === moduleId && this.moduleActive(m)));
  }

  moduleActive(mod: ModuleRow): boolean {
    const url = this.currentUrl();
    return mod.items.some((item) => {
      const path = '/' + item.route.join('/').replace(/^\/+/, '');
      return url === path || url.startsWith(path + '/') || url.startsWith(path + '?');
    });
  }

  toggle(moduleId: string): void {
    const next = new Set(this.manuallyOpen());
    if (next.has(moduleId)) next.delete(moduleId);
    else next.add(moduleId);
    this.manuallyOpen.set(next);
  }

  /** Case-insensitive: the backend's role code is 'SUPER_ADMIN' (seed.py:25). */
  readonly isSuperAdmin = computed(() => (this.session.role() ?? '').toUpperCase() === 'SUPER_ADMIN');

  logout(): void {
    this.auth.logout();
  }
}
