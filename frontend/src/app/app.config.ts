import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/http/auth.interceptor';
import { requestIdInterceptor } from './core/http/request-id.interceptor';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // ARCH-3 §1 specifies zoneless — tried first via
    // provideExperimentalZonelessChangeDetection() (Angular 19.2's naming;
    // it stabilizes in v20). Reverted to zone-based after a browser-testing
    // session where a `.click()`-triggered signal write appeared to update
    // the component (confirmed via `ng.getComponent()`) without the
    // template repainting — BUT that was checked by reading DOM state
    // synchronously in the same script as the triggering click, which
    // races Angular's own (inherently async) render scheduling regardless
    // of zone/zoneless; a later check using two separate calls (matching
    // how a real click-then-look interaction actually happens) showed the
    // repaint DID happen correctly. So this is NOT a confirmed zoneless
    // bug — the test methodology was the likely culprit, not the feature.
    // Kept on zone-based anyway: it's the mature, unsurprising default,
    // "Experimental" in this exact version is reason enough to not need a
    // stronger justification, and there's no cost to deferring zoneless to
    // a future Angular upgrade where it's stable and this ambiguity is moot.
    provideZoneChangeDetection({ eventCoalescing: true }),
    // ARCH-3 §1 also specifies withViewTransitions() — dropped here after
    // live-testing showed it throws an uncaught InvalidStateError on every
    // route change in Angular 19.2 (a documented rough edge in this
    // version's router/View-Transitions-API integration, not a bug in this
    // app's code — the navigation itself completes correctly regardless).
    // Not worth shipping console noise on every click for a cosmetic
    // animation; revisit when upgrading past 19.2.
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    // withFetch(): ARCH-3 §1's explicit choice over XHR.
    provideHttpClient(withFetch(), withInterceptors([requestIdInterceptor, authInterceptor])),
    // Session bootstrap before first paint (ARCH-3 §4/§8) — tries a stored
    // refresh token, fetches /api/v1/me, populates SessionStore. A guest
    // with no stored session resolves immediately to logged-out.
    provideAppInitializer(() => firstValueFrom(inject(AuthService).restore())),
  ],
};
