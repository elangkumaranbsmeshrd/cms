export const environment = {
  production: false,
  // Dev: ng serve on :4200, API on :8001 (already CORS-allowed server-side —
  // app/core/config.py's cors_allowed_origins defaults to this exact pair).
  apiBaseUrl: 'http://127.0.0.1:8001/api/v1',
};
