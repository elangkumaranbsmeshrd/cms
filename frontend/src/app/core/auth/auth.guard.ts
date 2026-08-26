import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { SessionStore } from './session.store';

/** Gates the entire authenticated shell — distinct from screenAccessGuard,
 * which gates one screen within it. Unauthenticated → straight to /login.
 */
export const authGuard: CanMatchFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  return session.isAuthed() ? true : router.createUrlTree(['/login']);
};
