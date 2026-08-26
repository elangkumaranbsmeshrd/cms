import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';

import { environment } from '../../environments/environment';
import { SessionStore } from '../core/auth/session.store';
import { UiStore } from '../core/ui/ui.store';
import { AuthService } from '../core/auth/auth.service';
import { IconComponent } from '../shared/ui/icon.component';
import { BreadcrumbsComponent } from './breadcrumbs.component';
import { NAV_MODULES, SUB_SCREEN_KEYS, routeForScreen } from './nav-registry';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

interface FinancialYearRow {
  readonly id: string;
  readonly label: string;
  readonly is_current: boolean;
}

interface NotificationRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly deep_link_path: string | null;
  readonly is_read: boolean;
}

interface AnnouncementRow {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly published_at: string | null;
}

interface SearchHit {
  readonly screenId: string;
  readonly label: string;
  readonly moduleLabel: string;
  readonly route: string[];
}

// GET /search's own response shape (backend/app/api/v1/search.py) — a real
// cross-entity search (Employee/Customer/Vendor/Invoice/Ticket/Purchase
// Bill), not just a screen-name match. `route` is derived client-side since
// the endpoint returns plain record ids, not app routes.
interface EntitySearchHit {
  readonly type: string;
  readonly id: string;
  readonly label: string;
  readonly sublabel: string | null;
}

const ENTITY_ROUTE_BASE: Record<string, string> = {
  Employee: '/employees',
  Customer: '/customers',
  Vendor: '/vendors',
  Invoice: '/invoices',
  Ticket: '/tickets',
  'Purchase Bill': '/purchase-bills',
};

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink, IconComponent, BreadcrumbsComponent],
  template: `
    <header class="topbar">
      <div class="brand">
        <!-- QUEUED / NOT BUILT — §6 "nothing hardcoded": company name/initial/
        product tag are literal strings here instead of read from Company
        Profile. Confirmed genuine gap, not fixed inline, because no broadly
        readable source exists yet: GET /masters/company-profile is RBAC-gated
        to SUPER_ADMIN full / MANAGER view only (backend/app/seed.py:64-66) —
        ACCOUNTANT, HR and EMPLOYEE all resolve "none" on the
        masters.company_profile screen, so require_screen() (backend/app/rbac/
        deps.py:32-34) 404s the call for those three roles. This topbar
        renders for every authenticated role on every screen, so it cannot
        call that endpoint directly without breaking 3 of 5 roles. Needs a new
        backend surface first: a minimal branding read (legal_name + logo
        only, no financial/registration fields, no screen-level RBAC gate) —
        then this component, and login-page.component.ts /
        forgot-password-page.component.ts (same hardcoded "Meshrd" pre-auth,
        where even a gated endpoint would be unreachable), can all read from
        it instead of the literals below. -->
        <div class="brand-mark">M</div>
        <div class="brand-text">
          <b>Meshrd</b>
          <span>CMS</span>
        </div>
      </div>
      <div class="tb-left">
        <!-- The title attribute alone is NOT an accessible name: it's a tooltip that only
             appears on hover, so an icon-only button reads as just "button" to
             a screen reader and is unreachable by voice control. aria-label is
             the name; title stays for the sighted hover hint. -->
        <button
          class="icon-btn"
          type="button"
          (click)="ui.sidebarCollapsed.set(!ui.sidebarCollapsed())"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          [attr.aria-expanded]="!ui.sidebarCollapsed()"
        >
          <app-icon name="menu" [size]="16" />
        </button>
        <!-- Back + trail live here, once, for every screen in the app. -->
        <app-breadcrumbs />
      </div>
      <div class="tb-spacer"></div>

      <!-- Ctrl+K-labelled quick screen navigator — filters the same nav a
      person could otherwise only reach by expanding the sidebar tree. NOT a
      cross-entity data search (employees/invoices/tickets by content): no
      such endpoint exists in this backend today, only per-entity list
      endpoints — building one is a separate, larger backend feature. This
      is a real, working search over screens, not a decorative placeholder. -->
      <div class="searchbox" style="position: relative;">
        <span class="s-icon"><app-icon name="search" [size]="14" /></span>
        <input
          type="text"
          placeholder="Search employees, invoices, tickets…"
          aria-label="Search"
          [value]="searchQuery()"
          (input)="onSearchInput($event)"
          (focus)="searchFocused.set(true)"
          (blur)="onSearchBlur()"
          (keydown.enter)="goToFirstHit()"
          (keydown.escape)="clearSearch()"
        />
        @if (searchFocused() && searchQuery().trim()) {
          <div class="pop" style="position: absolute; top: 34px; right: auto; left: 0; width: 320px;">
            <div class="pop-list">
              @if (searchHits().length) {
                @for (hit of searchHits(); track hit.screenId) {
                  <div class="menu-item" (mousedown)="goTo(hit.route)">
                    <app-icon name="grid" [size]="13" />
                    <span style="flex: 1;">{{ hit.label }}</span>
                    <span class="cell-sub" style="font-size: 10.5px;">{{ hit.moduleLabel }}</span>
                  </div>
                }
              }
              @if (entitySearching()) {
                <div class="menu-item" style="cursor: default; color: var(--text-tertiary);">Searching records…</div>
              } @else {
                @for (hit of entityHits(); track hit.type + hit.id) {
                  <div class="menu-item" (mousedown)="goToEntity(hit)">
                    <span style="flex: 1;">
                      {{ hit.label }}
                      @if (hit.sublabel) {
                        <span class="cell-sub" style="margin-left: 4px;">{{ hit.sublabel }}</span>
                      }
                    </span>
                    <span class="cell-sub" style="font-size: 10.5px;">{{ hit.type }}</span>
                  </div>
                }
              }
              @if (!searchHits().length && !entitySearching() && !entityHits().length) {
                <div class="menu-item" style="cursor: default;">No matches.</div>
              }
            </div>
          </div>
        }
      </div>

      <button class="fy-pill" type="button" routerLink="/masters/financial-years" title="Masters → Financial Year">
        <app-icon name="doc" [size]="13" />
        FY <b>{{ currentFyLabel() }}</b>
      </button>

      <div style="position: relative;">
        <!-- Same fix as the sidebar toggle above. The unread count is part of
             the name here, not a separate announcement — the badge is a bare
             number that reads as "5" out of context otherwise. -->
        <button
          class="icon-btn bell"
          type="button"
          (click)="toggleNotifPop()"
          title="Notifications"
          [attr.aria-label]="unreadCount() > 0 ? 'Notifications, ' + unreadCount() + ' unread' : 'Notifications'"
          [attr.aria-expanded]="notifPopOpen()"
        >
          <app-icon name="bell" [size]="17" />
          @if (unreadCount() > 0) {
            <!-- aria-hidden: the count is already inside the button's own
                 aria-label above, so without this it is announced twice, the
                 second time as a bare number. -->
            <span class="dot" aria-hidden="true">{{ unreadCount() > 99 ? '99+' : unreadCount() }}</span>
          }
        </button>
        @if (notifPopOpen()) {
          <div class="scrim" (click)="notifPopOpen.set(false)"></div>
          <div class="pop">
            <div class="pop-head">
              <h4>Inbox</h4>
              <span class="link right" (click)="markAllRead()">Mark all as read</span>
            </div>
            <div class="pop-tabs">
              <div class="pop-tab" [class.on]="notifTab() === 'notif'" (click)="notifTab.set('notif')">My Notifications</div>
              <div class="pop-tab" [class.on]="notifTab() === 'ann'" (click)="notifTab.set('ann')">Announcements</div>
            </div>
            <div class="pop-list feed">
              @if (notifTab() === 'notif') {
                @for (n of notifications(); track n.id) {
                  <div class="feed-item" (click)="openNotification(n)">
                    <div class="feed-ico"><app-icon name="bell" [size]="13" /></div>
                    <div class="feed-body">
                      <div class="feed-title"><b [style.font-weight]="n.is_read ? 400 : 650">{{ n.title }}</b></div>
                      <div class="feed-meta">{{ n.body }}</div>
                    </div>
                  </div>
                }
                @if (!notifications().length) {
                  <div class="feed-item"><div class="feed-body cell-sub">No notifications yet.</div></div>
                }
              } @else {
                @for (a of announcements(); track a.id) {
                  <div class="feed-item">
                    <div class="feed-ico"><app-icon name="mail" [size]="13" /></div>
                    <div class="feed-body">
                      <div class="feed-title"><b>{{ a.title }}</b></div>
                      <div class="feed-meta">{{ a.message }}</div>
                    </div>
                  </div>
                }
                @if (!announcements().length) {
                  <div class="feed-item"><div class="feed-body cell-sub">No announcements right now.</div></div>
                }
              }
            </div>
            <div class="pop-foot">
              <span class="link" routerLink="/announcements" (click)="notifPopOpen.set(false)">Open Announcements &amp; Notifications →</span>
            </div>
          </div>
        }
      </div>

      <!-- Third icon-only button with the same title-as-only-name defect. -->
      <button class="icon-btn" type="button" (click)="toggleTheme()" title="Toggle theme" aria-label="Toggle theme">
        {{ ui.theme() === 'dark' ? '☀' : '☾' }}
      </button>

      <!-- RBAC §4.2 "Preview as this role" — Super Admin only. session.role()
      never changes here; only the resolved policy does. Exists because
      seeing the app change shape live, not just reading a permission
      matrix, is the whole point of RBAC being demonstrable — same
      reasoning the prototype's own role switcher gives. 2026-08-11: Layer 4
      (scope) is now part of this too — every request carries an
      X-Preview-Role header (auth.interceptor.ts) that backend/app/rbac/
      deps.py's require_screen resolves the previewed role's OWN mode
      against, the same PermissionSet apply_scope() already reads — so an
      'own'/'team'-scoped screen narrows the way it would for that role.
      Real Super Admin has no linked Employee row, so that narrowing lands
      on zero rows, never a specific other person's data (resolver.py's own
      doc on resolve_permission explains why that's still not genuine
      impersonation). The menu's own footnote below says this plainly. -->
      @if (session.role() === 'SUPER_ADMIN') {
        <div style="position: relative;">
          <button class="role-switch" type="button" (click)="roleMenuOpen.set(!roleMenuOpen())" title="Preview as this role">
            <span class="role-dot"></span>
            <span class="lbl">{{ session.previewingAs() ? 'Previewing' : 'Viewing as' }}</span>
            <span class="val">{{ roleLabel(session.previewingAs() ?? session.role()) }}</span>
            <app-icon name="arrow" [size]="12" [width]="2.4" style="transform: rotate(90deg);" />
          </button>
          @if (roleMenuOpen()) {
            <div class="scrim" (click)="roleMenuOpen.set(false)"></div>
            <div class="menu" style="right: 12px; left: auto;">
              <div class="menu-cap">Preview the CMS as</div>
              @for (r of ROLE_OPTIONS; track r.value) {
                <div class="menu-item" (click)="selectPreviewRole(r.value)">
                  @if (roleLabel(session.previewingAs() ?? session.role()) === r.label) {
                    <app-icon name="check" [size]="13" />
                  }
                  {{ r.label }}
                </div>
              }
              @if (session.previewingAs()) {
                <div class="menu-sep"></div>
                <div class="menu-item" (click)="exitPreview()">Exit preview — back to my own role</div>
              }
              <div class="menu-sep"></div>
              <div style="padding: 6px 9px 7px; font-size: 11px; color: var(--text-tertiary); line-height: 1.45;">
                Redraws navigation, actions, fields, and which records you see for that role — since you hold no Employee record yourself, an "own"/"team"-scoped screen shows empty rather than a specific real person's data. Still not a real switch of identity: no login change, no session change.
              </div>
            </div>
          }
        </div>
      }

      <div style="position: relative;">
        <div class="avatar" (click)="menuOpen.set(!menuOpen())">{{ userInitials() }}</div>
        @if (menuOpen()) {
          <div class="scrim" (click)="menuOpen.set(false)"></div>
          <div class="menu" style="right: 12px; left: auto;">
            <div class="menu-cap">{{ session.user()?.fullName }} &middot; {{ session.role() }}</div>
            <div class="menu-sep"></div>
            @if (session.role() === 'SUPER_ADMIN') {
              <div class="menu-item" routerLink="/settings" (click)="menuOpen.set(false)">⚙ Settings</div>
              <div class="menu-sep"></div>
            }
            <div class="menu-item danger" (click)="logout()">Log out</div>
          </div>
        }
      </div>
    </header>
  `,
})
export class TopbarComponent implements OnInit {
  readonly session = inject(SessionStore);
  readonly ui = inject(UiStore);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly menuOpen = signal(false);
  readonly userInitials = () => initials(this.session.user()?.fullName ?? '?');

  // ---- RBAC §4.2 "Preview as this role" -------------------------------
  readonly roleMenuOpen = signal(false);
  // Matches the prototype's own hardcoded 5-role list (app-core.js) — the
  // same small, stable set every ROLE_CODES-style constant elsewhere in this
  // app already hardcodes rather than fetching, since it mirrors a DB CHECK
  // constraint (roles.code), not editable data.
  readonly ROLE_OPTIONS: readonly { value: string; label: string }[] = [
    { value: 'SUPER_ADMIN', label: 'Super Admin' },
    { value: 'MANAGER', label: 'Manager' },
    { value: 'ACCOUNTANT', label: 'Accountant' },
    { value: 'HR', label: 'HR' },
    { value: 'EMPLOYEE', label: 'Employee' },
  ];

  protected roleLabel(code: string | null): string {
    return this.ROLE_OPTIONS.find((r) => r.value === code)?.label ?? code ?? '';
  }

  protected selectPreviewRole(roleCode: string): void {
    this.roleMenuOpen.set(false);
    const request = roleCode === 'SUPER_ADMIN' ? this.auth.exitPreview() : this.auth.previewAsRole(roleCode);
    request.subscribe({
      // A screen visible under the OLD role may not exist under the new
      // one — Dashboard is the one destination every role can always open.
      next: () => this.router.navigate(['/dashboard']),
    });
  }

  protected exitPreview(): void {
    this.roleMenuOpen.set(false);
    this.auth.exitPreview().subscribe({ next: () => this.router.navigate(['/dashboard']) });
  }

  // ---- Financial Year pill --------------------------------------------
  private readonly financialYears = signal<readonly FinancialYearRow[]>([]);
  readonly currentFyLabel = computed(() => this.financialYears().find((fy) => fy.is_current)?.label ?? '—');

  // ---- Notifications -----------------------------------------------------
  readonly notifPopOpen = signal(false);
  readonly notifTab = signal<'notif' | 'ann'>('notif');
  readonly notifications = signal<readonly NotificationRow[]>([]);
  readonly announcements = signal<readonly AnnouncementRow[]>([]);
  readonly unreadCount = signal(0);

  // ---- Search --------------------------------------------------------
  readonly searchQuery = signal('');
  readonly searchFocused = signal(false);
  // Every RBAC-visible screen, flattened once per policy change — the exact
  // same source the sidebar builds its tree from, minus sub-screen-only keys
  // (nothing to usefully "jump to" for a tab-only screen with no route).
  private readonly allScreens = computed<SearchHit[]>(() => {
    const screens = this.session.policy().screens;
    const out: SearchHit[] = [];
    for (const mod of NAV_MODULES) {
      for (const [screenId, screen] of Object.entries(screens)) {
        if (SUB_SCREEN_KEYS.has(screenId)) continue;
        if (!mod.screenPrefixes.some((p) => screenId.startsWith(p))) continue;
        out.push({ screenId, label: screen.label, moduleLabel: mod.label, route: routeForScreen(screenId) });
      }
    }
    return out;
  });
  readonly searchHits = computed<SearchHit[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return [];
    return this.allScreens()
      .filter((s) => s.label.toLowerCase().includes(q))
      .slice(0, 8);
  });

  // Real record search (GET /search) — debounced separately from the
  // instant, client-side screen-name match above, since this one is a
  // network call. A stale in-flight request never overwrites a newer one:
  // switchMap cancels it outright the moment another query comes in.
  readonly entityHits = signal<readonly EntitySearchHit[]>([]);
  readonly entitySearching = signal(false);
  private readonly entityQuery$ = new Subject<string>();

  ngOnInit(): void {
    this.entityQuery$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) {
            this.entitySearching.set(false);
            return of<EntitySearchHit[]>([]);
          }
          this.entitySearching.set(true);
          return this.http.get<EntitySearchHit[]>(`${environment.apiBaseUrl}/search`, { params: { q } }).pipe(catchError(() => of<EntitySearchHit[]>([])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((hits) => {
        this.entitySearching.set(false);
        this.entityHits.set(hits);
      });
    this.http.get<FinancialYearRow[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows ?? []),
      error: () => this.financialYears.set([]),
    });
    this.http.get<{ unread_count: number }>(`${environment.apiBaseUrl}/notifications/unread-count`).subscribe({
      next: (r) => this.unreadCount.set(r.unread_count),
      error: () => this.unreadCount.set(0),
    });
  }

  toggleNotifPop(): void {
    const opening = !this.notifPopOpen();
    this.notifPopOpen.set(opening);
    if (!opening) return;
    this.http.get<NotificationRow[]>(`${environment.apiBaseUrl}/notifications`).subscribe({
      next: (rows) => this.notifications.set(rows ?? []),
      error: () => this.notifications.set([]),
    });
    this.http.get<AnnouncementRow[]>(`${environment.apiBaseUrl}/announcements`).subscribe({
      next: (rows) => this.announcements.set((rows ?? []).slice(0, 10)),
      error: () => this.announcements.set([]),
    });
  }

  markAllRead(): void {
    this.http.post(`${environment.apiBaseUrl}/notifications/read-all`, {}).subscribe({
      next: () => {
        this.notifications.set(this.notifications().map((n) => ({ ...n, is_read: true })));
        this.unreadCount.set(0);
      },
    });
  }

  openNotification(n: NotificationRow): void {
    if (!n.is_read) {
      this.http.post(`${environment.apiBaseUrl}/notifications/${n.id}/read`, {}).subscribe({
        next: () => {
          this.notifications.set(this.notifications().map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
          this.unreadCount.set(Math.max(0, this.unreadCount() - 1));
        },
      });
    }
    this.notifPopOpen.set(false);
    if (n.deep_link_path) this.router.navigateByUrl(n.deep_link_path);
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.entityQuery$.next(value);
  }

  onSearchBlur(): void {
    // A plain (blur) would fire before a (mousedown)-driven result click
    // registers — defer the close one tick so that click still lands.
    setTimeout(() => this.searchFocused.set(false), 150);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchFocused.set(false);
    this.entityHits.set([]);
  }

  goTo(route: string[]): void {
    this.clearSearch();
    this.router.navigate(route);
  }

  goToEntity(hit: EntitySearchHit): void {
    const base = ENTITY_ROUTE_BASE[hit.type];
    if (base) this.goTo([base, hit.id]);
  }

  goToFirstHit(): void {
    const firstScreen = this.searchHits()[0];
    if (firstScreen) {
      this.goTo(firstScreen.route);
      return;
    }
    const firstEntity = this.entityHits()[0];
    if (firstEntity) this.goToEntity(firstEntity);
  }

  toggleTheme(): void {
    this.ui.theme.set(this.ui.theme() === 'dark' ? 'light' : 'dark');
  }

  logout(): void {
    this.menuOpen.set(false);
    this.auth.logout();
  }
}
