export const environment = {
  production: true,
  // Prod: nginx serves this SPA and proxies /api/ to the backend on the SAME
  // origin (ARCH-3 §9's server block — `location /api/ { proxy_pass ... }`),
  // so a relative path is correct and deliberate here. An absolute host would
  // both hardcode the domain into the bundle and turn every API call into a
  // cross-origin request that cors_allowed_origins would then have to permit.
  apiBaseUrl: '/api/v1',
};
