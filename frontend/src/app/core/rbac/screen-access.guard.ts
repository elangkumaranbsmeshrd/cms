import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { PolicyStore } from './policy.store';

/**
 * CanMatch, not CanActivate (ARCH-3 §4) — it prevents the lazy chunk from
 * even downloading for a screen this role can't open, rather than
 * downloading it and then redirecting away.
 *
 * Note the asymmetry with the real backend: an invisible screen 404s
 * server-side ("does not reveal that it exists" — app/rbac/deps.py's
 * require_screen), but here we route to /403 with the screen id in the
 * query string — telling the CLIENT which screen was denied is fine (the
 * user already knows what they clicked), the leak require_screen guards
 * against is a stranger fishing for screen keys that exist at all.
 */
export const screenAccessGuard = (screenId: string): CanMatchFn => () => {
  const policy = inject(PolicyStore);
  const router = inject(Router);
  if (policy.canOpen(screenId)) return true;
  return router.createUrlTree(['/403'], { queryParams: { screen: screenId } });
};
