# ============================================================
# Iris — Multi-stage Docker build
# ============================================================
# Targets:
#   production    (default)  — Node 22 Debian slim + Bun 编译 TUI, ~400 MB
#   computer-use  (optional) — Ubuntu + Playwright/Chromium, ~900 MB
#
# Build:
#   docker build -t iris .                                  # production
#   docker build -t iris-cu --target computer-use-base .    # with Playwright
# ============================================================

# ------ Stage 1: Install ALL dependencies (incl. devDeps for tsc) ------
FROM node:22-slim AS deps
WORKDIR /app

# Native addon build tools (better-sqlite3, sharp, node-pty)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ libvips-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/extension-sdk/package.json packages/extension-sdk/package.json
# Prepare web-ui directory for its own package.json
RUN mkdir -p extensions/web/web-ui
COPY extensions/web/web-ui/package.json extensions/web/web-ui/
# Console extension (imported dynamically from src/attach.ts, tsc follows the import)
RUN mkdir -p extensions/console
COPY extensions/console/package.json extensions/console/

RUN npm install --legacy-peer-deps
RUN cd extensions/web/web-ui && npm install
RUN cd extensions/console && npm install --legacy-peer-deps


# ------ Stage 2: Build Vue 3 Web UI (Vite) ------
FROM deps AS build-ui
COPY extensions/web/web-ui/ extensions/web/web-ui/
# web-ui imports shared modules from parent directory via @web-shared alias
COPY extensions/web/src/ extensions/web/src/
RUN cd extensions/web/web-ui && npm run build


# ------ Stage 3: Compile TypeScript ------
FROM deps AS build
COPY src/ src/
COPY tsconfig.json tsconfig.build.json ./
COPY packages/ packages/
COPY data/ data/
# extensions/console is needed for dynamic import in src/index.ts
COPY extensions/console/ extensions/console/
# Build extension-sdk (needed at runtime by core imports)
RUN cd packages/extension-sdk && npx tsc
RUN npx tsc -p tsconfig.build.json
# Strip devDependencies — production image only needs runtime deps
RUN npm prune --omit=dev


# ------ Stage 4: Compile standalone binary with Bun (TUI + onboard) ------
FROM deps AS bun-compile

# Install Bun (needed for bun build --compile; npm is already available from deps)
RUN npm install -g bun
# OpenTUI React dependency — must be installed via npm to avoid incomplete package
RUN npm install --no-save react-devtools-core

COPY src/ src/
COPY tsconfig.json tsconfig.build.json ./
COPY data/ data/
COPY packages/ packages/
COPY script/ script/
COPY terminal/ terminal/
# All extensions needed: embedded.json lists cron, memory, web, console, telegram
COPY extensions/ extensions/
# Overlay pre-built web-ui (build.ts expects extensions/web/web-ui/dist/)
COPY --from=build-ui /app/extensions/web/web-ui/dist/ extensions/web/web-ui/dist/

# Sync extension metadata and install all extension deps
RUN npx tsx script/install-extension-deps.ts --frozen-lockfile

# Compile standalone binary for current platform (linux-x64)
# build.ts internally runs: bun install --os="*" --cpu="*" @opentui/core
# 末尾的 test 校验是关键：
#   1) 一旦脚本静默退出 0 但没生成二进制，这一层会失败、不会被缓存，
#      避免 GHA cache 污染导致后续 COPY 阶段报 "iris not found"。
#   2) 同时这行内容的变化也会把任何已被污染的旧缓存层 hash 击穿。
RUN bun run script/build.ts --single \
 && test -x dist/bin/iris-linux-x64/bin/iris \
 && test -x dist/bin/iris-linux-x64/bin/iris-onboard \
 && echo "✓ iris binaries verified" \
 && ls -lh dist/bin/iris-linux-x64/bin/

# Prune devDependencies from embedded extension source directories.
# copyEmbeddedExtensions() already prunes the dist/bin/ copy (used by npm),
# but the source extensions/ are what get COPY'd into the Docker image.
# This strips TypeScript, @types, etc. — keeping only runtime deps.
RUN node -e " \
  const fs = require('fs'); \
  const { execSync } = require('child_process'); \
  const config = JSON.parse(fs.readFileSync('extensions/embedded.json', 'utf8')); \
  for (const ext of config.extensions) { \
    const dir = 'extensions/' + ext.name; \
    if (fs.existsSync(dir + '/node_modules') && fs.existsSync(dir + '/package.json')) { \
      console.log('Pruning devDeps: ' + dir); \
      try { execSync('npm prune --omit=dev --no-audit --no-fund', { cwd: dir, stdio: 'inherit' }); } \
      catch(e) { console.warn('  prune failed for ' + dir + ': ' + e.message); } \
    } \
  } \
  " && echo "✓ extension devDeps pruned"


# ------ Stage 5: Production image (default target) ------
FROM node:22-slim AS production

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Compiled JS
COPY --from=build /app/dist/ dist/
# resolveProjectRoot() checks for data/ relative to dist/src/paths.js → projectRoot = /app/dist
# workspaceExtensionsDir = projectRoot/extensions; replace tsc's partial output with symlink to full extensions
RUN ln -s /app/data dist/data && rm -rf dist/extensions && ln -s /app/extensions dist/extensions
# Runtime dependencies only (devDeps pruned in build stage)
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json .
# Extension SDK (symlinked from node_modules)
COPY --from=build /app/packages/extension-sdk/ packages/extension-sdk/
# Config templates for first-run init
COPY --from=build /app/data/ data/
# Web UI static files
COPY --from=build-ui /app/extensions/web/web-ui/dist/ extensions/web/web-ui/dist/
# Bun-compiled binaries (TUI + onboard)
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris bin/iris
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris-onboard bin/iris-onboard
RUN chmod +x bin/iris bin/iris-onboard
# Entrypoint script
COPY deploy/docker/entrypoint.sh /app/entrypoint.sh
COPY deploy/docker/esm-fix.mjs /app/esm-fix.mjs
RUN chmod +x /app/entrypoint.sh
# Extension plugins (lark, telegram, web, weixin, etc.)
# Only embedded extensions (listed in extensions/embedded.json).
# Additional extensions can be installed at runtime via: iris extension install
COPY --from=bun-compile /app/extensions/embedded.json extensions/embedded.json
COPY --from=bun-compile /app/extensions/multimodal/ extensions/multimodal/
COPY --from=bun-compile /app/extensions/mcp/ extensions/mcp/
COPY --from=bun-compile /app/extensions/cron/ extensions/cron/
COPY --from=bun-compile /app/extensions/memory/ extensions/memory/
COPY --from=bun-compile /app/extensions/web/ extensions/web/
COPY --from=bun-compile /app/extensions/console/ extensions/console/
COPY --from=bun-compile /app/extensions/remote-connect/ extensions/remote-connect/
COPY --from=bun-compile /app/extensions/remote-exec/ extensions/remote-exec/
COPY --from=bun-compile /app/extensions/telegram/ extensions/telegram/
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    IRIS_DATA_DIR=/data \
    IRIS_PLATFORM=web

EXPOSE 8192
VOLUME /data
# NOTE: runs as root initially so entrypoint can deploy TUI binaries to /host-bin,
# then drops to 'node' user via setpriv before starting the main process.

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]


# ------ Stage 6: Computer Use variant (Playwright + Chromium) ------
# Playwright base image already ships Node.js 22 + Chromium + system deps
FROM mcr.microsoft.com/playwright:v1.58.0-noble AS computer-use-base

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/dist/ dist/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json .
COPY --from=build /app/packages/extension-sdk/ packages/extension-sdk/
COPY --from=build /app/data/ data/
COPY --from=build-ui /app/extensions/web/web-ui/dist/ extensions/web/web-ui/dist/
# Install playwright in root node_modules (extension uses --external=playwright)
RUN npm install --no-save playwright@1.52.0
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris bin/iris
COPY --from=bun-compile /app/dist/bin/iris-linux-x64/bin/iris-onboard bin/iris-onboard
RUN chmod +x bin/iris bin/iris-onboard
COPY deploy/docker/entrypoint.sh /app/entrypoint.sh
COPY deploy/docker/esm-fix.mjs /app/esm-fix.mjs
RUN chmod +x /app/entrypoint.sh
# Extensions with deps from bun-compile stage
# Only embedded extensions (listed in extensions/embedded.json).
# Additional extensions can be installed at runtime via: iris extension install
COPY --from=bun-compile /app/extensions/embedded.json extensions/embedded.json
COPY --from=bun-compile /app/extensions/multimodal/ extensions/multimodal/
COPY --from=bun-compile /app/extensions/mcp/ extensions/mcp/
COPY --from=bun-compile /app/extensions/cron/ extensions/cron/
COPY --from=bun-compile /app/extensions/memory/ extensions/memory/
COPY --from=bun-compile /app/extensions/web/ extensions/web/
COPY --from=bun-compile /app/extensions/console/ extensions/console/
COPY --from=bun-compile /app/extensions/remote-connect/ extensions/remote-connect/
COPY --from=bun-compile /app/extensions/remote-exec/ extensions/remote-exec/
COPY --from=bun-compile /app/extensions/telegram/ extensions/telegram/
# Same symlink fix as production stage
RUN ln -s /app/data dist/data && rm -rf dist/extensions && ln -s /app/extensions dist/extensions

RUN mkdir -p /data && chown pwuser:pwuser /data

ENV NODE_ENV=production \
    IRIS_DATA_DIR=/data \
    IRIS_PLATFORM=web \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8192
VOLUME /data
# Same as production: runs as root initially for /host-bin deploy, then drops privileges in entrypoint

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
