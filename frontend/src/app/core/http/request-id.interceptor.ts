import { HttpInterceptorFn } from '@angular/common/http';

/** Matches the request-id already threaded through every backend log line
 * (app/core/logging_config.py's request_id_var, app/main.py's middleware) —
 * generating it client-side means a support conversation can correlate a
 * browser network-tab entry straight to a server log line.
 */
export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ setHeaders: { 'X-Request-Id': crypto.randomUUID() } }));
};
