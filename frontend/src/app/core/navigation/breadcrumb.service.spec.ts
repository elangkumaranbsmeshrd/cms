/**
 * Layer 4 (COMPLETE-TEST-PROMPT.md §"Shared spine"): "Breadcrumb service —
 * trail derivation from routes".
 *
 * The service's whole claim is that the trail is DERIVED, never declared:
 * it walks the current URL upwards a segment at a time and asks the REAL
 * router config whether each ancestor prefix is a registered screen. So this
 * spec feeds it the REAL `routes` array from app.routes.ts rather than a
 * hand-built fixture — if someone renames `masters/financial-years`, these
 * expectations move with it, which is exactly the property being claimed.
 *
 * The Router itself is stubbed down to the three members the service actually
 * touches (`config`, `url`, `events`). That keeps every assertion synchronous
 * and, more importantly, keeps the real routes usable: navigating them for
 * real would run `screenAccessGuard` on every screen and redirect to /403
 * before a trail ever existed. Navigation is Angular's code; the derivation
 * is this app's, and it is the derivation under test.
 *
 * Labels come from the RBAC policy, so the policy is loaded through the real
 * SessionStore. The degenerate case where it has NOT loaded is covered too.
 */
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';

import { BreadcrumbService, Crumb } from './breadcrumb.service';
import { SessionStore } from '../auth/session.store';
import { CurrentUser, PolicyScreen } from '../auth/session.model';
import { routes } from '../../app.routes';

/** Server-supplied screen labels for the screens these URLs resolve to. */
const LABELS: Record<string, string> = {
  'masters.financial_year': 'Financial Years',
  'masters.email_configuration': 'Email Configuration',
  'employee.directory': 'Employees',
  'employee.master_record': 'Employee Record',
  'employee.onboarding': 'Onboarding',
  'credit_note.list': 'Credit Notes',
  'payroll.my_payslips': 'My Payslips',
};

function policyScreens(labels: Record<string, string>): Record<string, PolicyScreen> {
  const screens: Record<string, PolicyScreen> = {};
  for (const [key, label] of Object.entries(labels)) {
    screens[key] = { label, module: key.split('.')[0], mode: 'full', actions: [], fields: {} };
  }
  return screens;
}

function user(labels: Record<string, string>): CurrentUser {
  return {
    id: 'u-1',
    email: 'tester@meshrd.in',
    fullName: 'Test User',
    role: 'SUPER_ADMIN',
    mustChangePassword: false,
    previewingAs: null,
    policy: { version: '2026-01-01T00:00:00', screens: policyScreens(labels) },
  };
}

describe('BreadcrumbService', () => {
  let events: Subject<NavigationEnd>;
  let session: SessionStore;
  /** What the stub Router reports as its current URL when the service is
   * constructed — read exactly once, in the constructor. */
  let startUrl: string;
  let navId: number;

  beforeEach(() => {
    events = new Subject<NavigationEnd>();
    startUrl = '/';
    navId = 1;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            config: routes,
            get url(): string {
              return startUrl;
            },
            events: events.asObservable(),
          },
        },
      ],
    });

    session = TestBed.inject(SessionStore);
    session.set(user(LABELS));
  });

  /** Constructs the service (which snapshots `startUrl` and subscribes). */
  function boot(): BreadcrumbService {
    return TestBed.inject(BreadcrumbService);
  }

  /** Boots, then drives one completed navigation, as the real Router would. */
  function at(url: string): BreadcrumbService {
    const service = boot();
    events.next(new NavigationEnd(navId++, url, url));
    return service;
  }

  function trailAt(url: string): Crumb[] {
    return at(url).trail();
  }

  function labelsAt(url: string): string[] {
    return trailAt(url).map((c) => c.label);
  }

  // ---------------------------------------------------------------------
  // Depth: a module root vs a nested record.
  // ---------------------------------------------------------------------

  describe('at a module root', () => {
    it('is two crumbs: the nav module, then the screen', () => {
      expect(labelsAt('/masters/financial-years')).toEqual(['Masters', 'Financial Years']);
    });

    it('links neither of them — the module is a heading, the screen is where you already are', () => {
      const trail = trailAt('/masters/financial-years');
      expect(trail.map((c) => c.url)).toEqual([undefined, undefined]);
    });

    it('takes the module crumb from the nav registry, not from the policy or the URL', () => {
      // '/masters/financial-years' has no `masters` route of its own, and the
      // policy has no screen called "Masters" — the crumb comes from
      // NAV_MODULES matching the screen KEY prefix `masters.`.
      expect(labelsAt('/masters/financial-years')[0]).toBe('Masters');
    });

    it('is a single screen crumb plus its module for a one-segment screen', () => {
      expect(labelsAt('/employees')).toEqual(['Employee', 'Employees']);
    });
  });

  describe('at a nested record', () => {
    it('adds the parent list as a real link and the record as the leaf', () => {
      const service = at('/employees/emp-1');
      service.setRecordLabel('Priya Raman');

      expect(service.trail().map((c) => c.label)).toEqual(['Employee', 'Employees', 'Priya Raman']);
      expect(service.trail()[1].url).toBe('/employees');
      expect(service.trail()[2].url).toBeUndefined();
    });

    it('falls back to the screen label when the record has not published its name yet', () => {
      // employees/:id is employee.master_record, so the id segment renders as
      // that screen's own policy label until the row loads.
      expect(labelsAt('/employees/emp-1')).toEqual(['Employee', 'Employees', 'Employee Record']);
    });

    it('grows one crumb deeper than the module root', () => {
      expect(labelsAt('/employees').length).toBe(2);
      expect(labelsAt('/employees/emp-1').length).toBe(3);
    });
  });

  // ---------------------------------------------------------------------
  // The ancestor walk itself.
  // ---------------------------------------------------------------------

  describe('ancestor segments', () => {
    it('links every ancestor prefix that is itself a registered screen', () => {
      // 5 URL segments -> 4 crumbs: module, two registered ancestors, leaf.
      // Both ancestors carry the same label because both routes are the same
      // RBAC screen key (masters.email_configuration) — the label is per
      // SCREEN, and only the URL distinguishes them.
      const trail = trailAt('/masters/email-configuration/templates/9/edit');
      expect(trail.map((c) => c.label)).toEqual(['Masters', 'Email Configuration', 'Email Configuration', 'Edit']);
      expect(trail.map((c) => c.url)).toEqual([
        undefined,
        '/masters/email-configuration',
        '/masters/email-configuration/templates',
        undefined,
      ]);
    });

    it('skips a segment that is not a registered route on its own', () => {
      // 4 URL segments, but `.../financial-years/42` is not a registered
      // route (Financial Year has no record screen), so it contributes
      // nothing and the trail stays at 3.
      const trail = trailAt('/masters/financial-years/42/edit');
      expect(trail.map((c) => c.url)).toEqual([undefined, '/masters/financial-years', undefined]);
      expect(trail.length).toBe(3);
    });

    it('prefers a literal route over a parameterised one at the same depth', () => {
      // 'employees/onboarding-queue' (employee.onboarding) and 'employees/:id'
      // (employee.master_record) both match two segments; the literal wins, so
      // the leaf reads "Onboarding", not the record screen's label.
      expect(labelsAt('/employees/onboarding-queue')).toEqual(['Employee', 'Employees', 'Onboarding']);
    });

    it('never leaves the last crumb as a link, however deep the trail', () => {
      for (const url of ['/employees', '/employees/emp-1', '/masters/email-configuration/templates/9/edit']) {
        const trail = trailAt(url);
        expect(trail[trail.length - 1].url).withContext(url).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------
  // The module crumb is matched by screen-key prefix, not by URL segment.
  // ---------------------------------------------------------------------

  describe('module crumb', () => {
    it('resolves a screen whose key does not start with its own module name', () => {
      // The case nav-registry.ts calls out by name: credit_note.list belongs
      // to the Invoice module. A first-segment split of '/credit-notes' could
      // never produce this.
      expect(labelsAt('/credit-notes')).toEqual(['Invoice', 'Credit Notes']);
    });

    it('resolves a module that two screen prefixes share', () => {
      // payroll.* and leave.* are one nav module.
      expect(labelsAt('/my-payslips')).toEqual(['Leave & Payroll', 'My Payslips']);
    });
  });

  // ---------------------------------------------------------------------
  // Action leaves.
  // ---------------------------------------------------------------------

  describe('new / edit leaves', () => {
    it('renders a "new" leaf as a singularised Add action', () => {
      expect(labelsAt('/masters/financial-years/new')).toEqual(['Masters', 'Financial Years', 'Add Financial Year']);
    });

    it('renders an "edit" leaf with the record name once the row loads', () => {
      const service = at('/masters/financial-years/42/edit');
      service.setRecordLabel('FY 2025-26');
      expect(service.trail().map((c) => c.label)).toEqual(['Masters', 'Financial Years', 'Edit FY 2025-26']);
    });

    it('renders a bare "Edit" before the row loads', () => {
      expect(labelsAt('/masters/financial-years/42/edit')).toEqual(['Masters', 'Financial Years', 'Edit']);
    });

    it('says View instead of Edit on a read-only leaf', () => {
      const service = at('/masters/financial-years/42/edit');
      service.setRecordLabel('FY 2025-26');
      service.setReadOnlyLeaf(true);
      expect(service.trail().map((c) => c.label)).toEqual(['Masters', 'Financial Years', 'View FY 2025-26']);
    });
  });

  // ---------------------------------------------------------------------
  // Pushed-in labels, and their reset on navigation.
  // ---------------------------------------------------------------------

  describe('record and tab labels', () => {
    it('appends the tab as the final crumb', () => {
      const service = at('/employees/emp-1');
      service.setRecordLabel('Priya Raman');
      service.setTabLabel('Documents');
      expect(service.trail().map((c) => c.label)).toEqual(['Employee', 'Employees', 'Priya Raman', 'Documents']);
    });

    it('leaves the record crumb unlinked even when a tab follows it', () => {
      // The current-screen crumb is built without a url, so the tab crumb
      // does not turn it into a link back to itself.
      const service = at('/employees/emp-1');
      service.setRecordLabel('Priya Raman');
      service.setTabLabel('Documents');
      expect(service.trail()[2].url).toBeUndefined();
      expect(service.trail()[3].url).toBeUndefined();
    });

    it('clears record, tab and read-only-leaf state on the next navigation', () => {
      const service = at('/masters/financial-years/42/edit');
      service.setRecordLabel('FY 2025-26');
      service.setTabLabel('Periods');
      service.setReadOnlyLeaf(true);
      expect(service.trail().map((c) => c.label)).toEqual([
        'Masters',
        'Financial Years',
        'View FY 2025-26',
        'Periods',
      ]);

      events.next(new NavigationEnd(navId++, '/employees/emp-1', '/employees/emp-1'));
      expect(service.trail().map((c) => c.label)).toEqual(['Employee', 'Employees', 'Employee Record']);
    });

    it('accepts null to withdraw a label', () => {
      const service = at('/employees/emp-1');
      service.setRecordLabel('Priya Raman');
      service.setRecordLabel(null);
      expect(service.trail().map((c) => c.label)).toEqual(['Employee', 'Employees', 'Employee Record']);
    });
  });

  // ---------------------------------------------------------------------
  // Degenerate inputs.
  // ---------------------------------------------------------------------

  describe('degenerate URLs', () => {
    it('is empty at the root path', () => {
      expect(trailAt('/')).toEqual([]);
    });

    it('is empty for an empty path', () => {
      expect(trailAt('')).toEqual([]);
    });

    it('is empty before any navigation has completed', () => {
      expect(boot().trail()).toEqual([]);
    });

    it('is empty for an unknown one-segment route', () => {
      expect(trailAt('/definitely-not-a-screen')).toEqual([]);
    });

    it('is empty for an unknown deep route, rather than inventing crumbs from the segments', () => {
      expect(trailAt('/definitely-not-a-screen/42/details')).toEqual([]);
    });

    it('emits only the action word if an unknown URL happens to end in /edit', () => {
      // currentLabel() checks the 'new'/'edit' leaf BEFORE it looks at whether
      // the route matched anything, so an unmatched URL ending in /edit still
      // yields a lone "Edit". Pinned, not endorsed — and unreachable in the
      // real app: app.routes.ts ends in `{ path: '**', redirectTo: '' }`, so
      // an unknown URL never survives to a NavigationEnd; urlAfterRedirects is
      // '/dashboard' by then, which is what this service actually reads.
      expect(labelsAt('/definitely-not-a-screen/42/edit')).toEqual(['Edit']);
    });

    it('ignores a query string', () => {
      expect(labelsAt('/masters/financial-years?page=2&status=OPEN')).toEqual(['Masters', 'Financial Years']);
    });

    it('ignores a fragment', () => {
      expect(labelsAt('/masters/financial-years#top')).toEqual(['Masters', 'Financial Years']);
    });

    it('adopts whatever URL the router is already on at construction', () => {
      // A service created mid-session (first injected by a screen already on
      // screen) must not start blank.
      startUrl = '/employees';
      expect(boot().trail().map((c) => c.label)).toEqual(['Employee', 'Employees']);
    });
  });

  describe('when the RBAC policy has not loaded', () => {
    beforeEach(() => session.set(null));

    it('keeps the module crumb but drops every policy-labelled crumb', () => {
      // Module labels come from NAV_MODULES (a client constant); screen labels
      // come from the server, so with no policy there is nothing to print for
      // them and they are omitted rather than rendered blank.
      expect(labelsAt('/masters/financial-years')).toEqual(['Masters']);
    });

    it('drops unlabelled ancestors too rather than emitting empty links', () => {
      const trail = trailAt('/masters/email-configuration/templates/9/edit');
      expect(trail.map((c) => c.label)).toEqual(['Masters', 'Edit']);
      expect(trail.some((c) => c.label === '')).toBe(false);
    });

    it('falls back to a generic noun on an Add leaf', () => {
      expect(labelsAt('/masters/financial-years/new')).toEqual(['Masters', 'Add record']);
    });
  });
});
