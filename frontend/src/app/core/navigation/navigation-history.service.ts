import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

/**
 * Where Back should actually go.
 *
 * The requirement is that Back returns to the ORIGIN, not a guessed parent: a
 * record opened from a filtered list returns to that list with its filters
 * intact. The list store already persists filter state per screen in
 * sessionStorage, so returning to the same URL is enough to restore it — this
 * service only has to remember which URL that was.
 *
 * It deliberately does NOT use history.back(). Browser history includes
 * redirects, 403 bounces and the login page; navigating to a remembered
 * in-app URL is both more predictable and safe on a deep link, where there is
 * no in-app history at all and the caller falls back to the breadcrumb parent.
 */
@Injectable({ providedIn: 'root' })
export class NavigationHistoryService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Most-recent-first, excluding the current URL. Bounded: this is a
   * back-target hint, not a session recording. */
  private readonly stack = signal<string[]>([]);
  private readonly MAX = 20;

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        const url = e.urlAfterRedirects;
        // Auth screens are never a sensible Back target.
        if (url.startsWith('/login') || url.startsWith('/forgot-password') || url.startsWith('/403')) return;
        this.stack.update((s) => {
          // Deduped by PATH, not by full URL. A tabbed record changes only its
          // ?tab= query as you move between tabs, and those are not separate
          // destinations — without this, Back would walk backwards through tabs
          // instead of leaving the screen. Keeping the most recent URL for the
          // path also means Back returns you to the tab you were actually on.
          const path = stripQuery(url);
          const rest = s.filter((u) => stripQuery(u) !== path);
          // Returning to a path already in the stack (Back, or re-clicking a nav
          // item) truncates rather than grows it — otherwise Back ping-pongs
          // between two screens forever.
          const at = s.findIndex((u) => stripQuery(u) === path);
          if (at > 0) return s.slice(at).map((u, i) => (i === 0 ? url : u));
          return [url, ...rest].slice(0, this.MAX);
        });
      });
  }

  /** The previous distinct in-app screen, or null on a deep link / first screen.
   * Compared by path so a tab or query change is never treated as "somewhere
   * else to go back to". */
  previous(currentUrl: string): string | null {
    const here = stripQuery(currentUrl);
    for (const url of this.stack()) {
      if (stripQuery(url) !== here) return url;
    }
    return null;
  }
}

function stripQuery(url: string): string {
  return url.split('?')[0].split('#')[0];
}
