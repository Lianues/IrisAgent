#!/bin/sh
set -e

IRIS_DATA_DIR="${IRIS_DATA_DIR:-/data}"
IRIS_PLATFORM="${IRIS_PLATFORM:-web}"
CONFIG_DIR="$IRIS_DATA_DIR/configs"
TEMPLATE_DIR="/app/data/configs.example"

# ------ First-run: initialize config from templates ------
if [ ! -d "$CONFIG_DIR" ] || [ -z "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]; then
  echo "[Iris] First run detected — initializing config directory..."

  mkdir -p "$CONFIG_DIR"

  if [ -d "$TEMPLATE_DIR" ]; then
    cp -r "$TEMPLATE_DIR"/* "$CONFIG_DIR"/
  else
    echo "[Iris] Warning: template directory not found at $TEMPLATE_DIR"
  fi

  echo "[Iris] Config initialized at $CONFIG_DIR"
  echo "[Iris] Please edit $CONFIG_DIR/llm.yaml to set your LLM API key, then restart."
fi

# ------ Docker networking: ensure web binds to all interfaces ------
# Platform type is overridden by IRIS_PLATFORM env var at runtime (no need to patch yaml).
# But web.host must be 0.0.0.0 for Docker port mapping to work.
PLATFORM_YAML="$CONFIG_DIR/platform.yaml"
if [ -f "$PLATFORM_YAML" ] && grep -q 'host: 127\.0\.0\.1' "$PLATFORM_YAML" 2>/dev/null; then
  sed -i 's/host: 127\.0\.0\.1/host: 0.0.0.0/' "$PLATFORM_YAML"
  echo "[Iris] Patched web.host to 0.0.0.0 for Docker networking"
fi

# ------ Deploy TUI binary to host (if /host-bin is mounted) ------
if [ -d /host-bin ] && [ -w /host-bin ]; then
  for bin in iris iris-onboard; do
    if [ -f "/app/bin/$bin" ]; then
      cp "/app/bin/$bin" "/host-bin/$bin"
      chmod +x "/host-bin/$bin"
    fi
  done
  echo "[Iris] TUI binaries deployed to host: iris, iris-onboard"
fi

# ------ Drop privileges to 'node' user for the main process ------
# entrypoint runs as root (for /host-bin write access), then drops to node
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$IRIS_DATA_DIR" 2>/dev/null || true
  RUN_AS="setpriv --reuid=node --regid=node --init-groups --"
fi

# ------ Start the application ------
# Console (TUI) platform requires the Bun-compiled binary
if echo "$IRIS_PLATFORM" | grep -qw "console"; then
  exec $RUN_AS /app/bin/iris "$@"
else
  exec $RUN_AS node --import ./esm-fix.mjs dist/src/index.js "$@"
fi
