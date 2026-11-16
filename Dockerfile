# syntax=docker/dockerfile:1
# dc-rack-3d: static Vite build served by unprivileged nginx on :8080.

# ── build ──────────────────────────────────────────────────────────────────────────────────────
# Build natively on the build host even for --platform linux/amd64: the output is arch-independent static files.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: devDeps (vitest/playwright) install as packages only; no browser download
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# uid 101 (nginx), listens on 8080. Replace the data by mounting a file/volume at
# /usr/share/nginx/html/data/datacenter.json (see k8s/dc-rack-3d.yaml).
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
