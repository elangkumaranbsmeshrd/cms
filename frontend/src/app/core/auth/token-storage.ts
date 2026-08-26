/**
 * Isolates the one open question ARCH-3 leaves unresolved until real Angular
 * auth work begins: the backend delivers both tokens as JSON in the response
 * body today (no HttpOnly cookie — see auth.service.ts's own header comment
 * for the full reasoning). The access token lives only in an in-memory
 * signal (AuthService) and is never persisted. The refresh token needs
 * SOMEWHERE to live so a page reload doesn't force a fresh login; sessionStorage
 * is the least-bad interim choice (survives reload, cleared on tab close,
 * scoped to this tab rather than shared across the whole browser the way
 * localStorage would be). Isolated to these two functions so a future
 * cookie-based migration only touches this file and the interceptor.
 */

const REFRESH_TOKEN_KEY = 'meshrd_refresh_token';

export function getStoredRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setStoredRefreshToken(token: string): void {
  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearStoredRefreshToken(): void {
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}
