import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Route, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { filter } from 'rxjs';

import { SessionStore } from '../auth/session.store';
import { NAV_MODULES } from '../../layout/nav-registry';

export interface Crumb {
  readonly label: string;
  /** Absolute URL to navigate to. Absent on the current (last) segment, which
   * is deliberately not a link. */
  readonly url?: string;
}

interface FlatRoute {
  /** Path pattern as registered, e.g. 'masters/financial-years/:id/edit'. */
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly screenId: string;
}

/**
 * The breadcrumb trail, DERIVED rather than declared.
 *
 * The requirement is that the trail must not go stale when a route changes, so
 * there is deliberately no parent map anywhere. Instead this walks the current
 * URL upwards one segment at a time and asks the REAL router config whether
 * each ancestor prefix is a registered screen. If it is, it becomes a crumb.
 * Rename or move a route and the trail follows automatically, because the
 * router config is the only source consulted.
 *
 * Labels come from the RBAC policy (`screens[screenId].label`) — the same
 * server-supplied name the sidebar shows, so a screen is called the same thing
 * in the nav and in the trail without a second list to keep in sync.
 *
 * Two things the URL cannot supply are pushed in by the screens that know them:
 * a record's own identity (so a trail reads "Employees › Priya Raman", never
 * ":id") and the active tab on a tabbed record.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly url = signal<string>('/');
  /** Set by record/form/tabbed screens once their row loads — replaces the id crumb. */
  private readonly recordLabel = signal<string | null>(null);
  /** Set by tabbed screens — appended as the final crumb. */
  private readonly tabLabel = signal<string | null>(null);
  /** Set by a form-shape screen with no updateEndpoint (Financial Year is the
   * reference case) — the trailing ".../edit" leaf reads "View X", matching
   * the page's own heading, instead of promising an edit that can't happen. */
  private readonly readOnlyLeaf = signal(false);

  /** Flattened once: every registered screen route with its path pattern. */
  private readonly flatRoutes: FlatRoute[];

  constructor() {
    this.flatRoutes = flatten(this.router.config, []);
    this.url.set(stripQuery(this.router.url));
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        // A new navigation invalidates whatever the previous screen published;
        // the incoming screen re-publishes as its own data loads.
        this.recordLabel.set(null);
        this.tabLabel.set(null);
        this.readOnlyLeaf.set(false);
        this.url.set(stripQuery(e.urlAfterRedirects));
      });
  }

  setRecordLabel(label: string | null): void {
    this.recordLabel.set(label);
  }

  setTabLabel(label: string | null): void {
    this.tabLabel.set(label);
  }

  setReadOnlyLeaf(readOnly: boolean): void {
    this.readOnlyLeaf.set(readOnly);
  }

  readonly trail = computed<Crumb[]>(() => {
    const url = this.url();
    const segments = url.split('/').filter(Boolean);
    if (!segments.length) return [];

    const screens = this.session.policy().screens;
    const out: Crumb[] = [];

    // Longest registered prefix wins as "the current screen"; its screenId also
    // supplies the module crumb.
    const current = this.matchRoute(segments);

    if (current) {
      // Prefix match, not a plain first-segment split: credit_note.list's own
      // module lives under 'invoice' (nav-registry.ts's own NAV_MODULES doc
      // explains why a screen key's own dot-prefix isn't reliable here).
      const mod = NAV_MODULES.find((m) => m.screenPrefixes.some((p) => current.screenId.startsWith(p)));
      // The module itself is a heading, not a page — there is no module landing
      // route to link to, so it renders as plain text.
      if (mod) out.push({ label: mod.label });
    }

    // Every ancestor prefix that is itself a registered screen becomes a link.
    for (let i = 1; i < segments.length; i++) {
      const prefix = segments.slice(0, i);
      const hit = this.matchRoute(prefix);
      if (!hit) continue;
      const label = screens[hit.screenId]?.label;
      if (!label) continue;
      const href = '/' + prefix.join('/');
      if (out.some((c) => c.url === href)) continue;
      out.push({ label, url: href });
    }

    // The current screen. A record route contributes the record's own name
    // rather than its id; a plain screen contributes its policy label.
    const currentLabel = this.currentLabel(current, segments, screens);
    if (currentLabel) out.push({ label: currentLabel });

    const tab = this.tabLabel();
    if (tab) out.push({ label: tab });

    // Drop the trailing link-ness: the last crumb is where you already are.
    return out.map((c, i) => (i === out.length - 1 ? { label: c.label } : c));
  });

  private currentLabel(
    current: FlatRoute | null,
    segments: readonly string[],
    screens: Record<string, { label: string }>,
  ): string | null {
    const record = this.recordLabel();
    const last = segments[segments.length - 1];

    // 'new' / 'edit' leaves read better as the action than as the screen name.
    if (last === 'new') return `Add ${singular(currentScreenLabel(current, screens) ?? 'record')}`;
    if (last === 'edit') {
      const verb = this.readOnlyLeaf() ? 'View' : 'Edit';
      return record ? `${verb} ${record}` : verb;
    }
    if (record) return record;
    return currentScreenLabel(current, screens);
  }

  /** The longest registered route whose pattern matches these URL segments. */
  private matchRoute(segments: readonly string[]): FlatRoute | null {
    let best: FlatRoute | null = null;
    for (const route of this.flatRoutes) {
      if (route.segments.length !== segments.length) continue;
      const ok = route.segments.every((s, i) => (s.startsWith(':') ? true : s === segments[i]));
      if (!ok) continue;
      // Prefer a literal match over a parameterised one at the same depth.
      if (!best || paramCount(route) < paramCount(best)) best = route;
    }
    return best;
  }
}

function currentScreenLabel(current: FlatRoute | null, screens: Record<string, { label: string }>): string | null {
  return current ? screens[current.screenId]?.label ?? null : null;
}

function paramCount(r: FlatRoute): number {
  return r.segments.filter((s) => s.startsWith(':')).length;
}

function stripQuery(url: string): string {
  return url.split('?')[0].split('#')[0];
}

/** "Financial Years" -> "Financial Year", for the "Add X" leaf label. */
function singular(label: string): string {
  if (/ies$/i.test(label)) return label.replace(/ies$/i, 'y');
  if (/ses$/i.test(label)) return label.replace(/es$/i, '');
  if (/s$/i.test(label) && !/ss$/i.test(label)) return label.replace(/s$/i, '');
  return label;
}

/** Walks the router config, collecting every route that screenRoute() tagged. */
function flatten(routes: readonly Route[], prefix: readonly string[]): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const route of routes) {
    const own = (route.path ?? '').split('/').filter(Boolean);
    const segments = [...prefix, ...own];
    const screenId = (route.data as { screenId?: string } | undefined)?.screenId;
    if (screenId) out.push({ pattern: segments.join('/'), segments, screenId });
    if (route.children?.length) out.push(...flatten(route.children, segments));
  }
  return out;
}
