# Builds the Angular SPA and serves it with nginx, which also proxies /api/ to
# the backend on the same origin (see nginx.conf for why same-origin matters).
#
# Multi-stage: node is needed only to produce dist/, and shipping a Node
# runtime plus node_modules to serve static files would be a much larger image
# and a much larger attack surface than nginx alone.

FROM node:20-alpine AS builder
WORKDIR /build

# Copy manifests first so the dependency layer is cached and only reinstalls
# when the manifests actually change, not on every source edit.
COPY package.json package-lock.json* ./
# `npm ci` (not `npm install`) — it installs exactly the lockfile, fails if the
# lockfile and package.json disagree, and never silently updates a dependency
# during a release build.
RUN npm ci

COPY . .
# The default configuration is production (angular.json's
# defaultConfiguration), which is what swaps environment.ts for
# environment.prod.ts via fileReplacements. Building without that swap is
# exactly the bug that made earlier builds ship a localhost API URL.
RUN npx ng build --configuration production

FROM nginx:1.27-alpine
# Angular 19's application builder emits browser assets under dist/<project>/browser
COPY --from=builder /build/dist/frontend/browser /usr/share/nginx/html
# Goes to templates/, not conf.d/ — the nginx entrypoint envsubst's it into
# conf.d at container start, which is how BACKEND_ORIGIN gets injected.
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Where the API lives, as seen from inside this container. Defaults to the
# compose service name; override for any other topology (a host-level backend,
# a separate node) without rebuilding the image.
ENV BACKEND_ORIGIN=http://backend:8000

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
