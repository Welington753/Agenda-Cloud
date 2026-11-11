#!/usr/bin/env bash
# Runs one command (a browser suite) inside the official Playwright image,
# pinned in PLAYWRIGHT_IMAGE by the workflow. The image already ships the
# browsers and their system dependencies, so the job no longer depends on
# the Ubuntu apt mirrors (`playwright install --with-deps`).
#
# Usage (from the repository root, in a workflow step):
#   bash .github/scripts/playwright-na-imagem.sh npm run test:browser:auth
#   bash .github/scripts/playwright-na-imagem.sh --check
#
# What stays exactly as before:
# - the command and its arguments are passed unchanged, and the script ends
#   with the command's exit code (a failing suite fails the step);
# - host network: the backend, frontend and HTTPS edge started by the
#   Playwright `webServer` entries listen on the runner's loopback, and the
#   disposable PostgreSQL stays at 127.0.0.1:55433 with TLS verify-full;
# - every server is started and stopped by the Playwright invocation itself
#   (`reuseExistingServer: false` under CI), so removing the container at the
#   end of a step never takes down something a later step needs. The
#   PostgreSQL container is not touched;
# - the checkout is mounted at the same absolute path and the process runs
#   as the runner's uid/gid, so `test-results/` (traces, screenshots) and the
#   `.next`/`dist` builds keep their paths and stay owned by the runner for
#   the upload steps;
# - the TLS certificate directory is mounted read-only.
#
# Environment: only the variables listed in PASSTHROUGH are forwarded, by
# name (`-e NAME`), so values are never written to the command line, to a
# file or to the log. Anything else from the runner stays outside.
set -euo pipefail

: "${PLAYWRIGHT_IMAGE:?PLAYWRIGHT_IMAGE must be set by the workflow}"

PASSTHROUGH=(
  CI
  HOST
  NODE_ENV
  IGNORE_DOTENV_FILE
  DATABASE_URL
  DIRECT_URL
  FRONTEND_URL
  NEXT_PUBLIC_API_URL
  NODE_EXTRA_CA_CERTS
  PLAYWRIGHT_OUTPUT_DIR
  API_PROXY_SECRET
  WEB_PUSH_VAPID_PUBLIC_KEY
  WEB_PUSH_VAPID_PRIVATE_KEY
  WEB_PUSH_SUBJECT
  E2E_RELOGIO_INICIO
)

workdir="$(pwd -P)"
certs_dir="/tmp/frontend-auth-e2e-certs"

docker_args=(
  run --rm --init
  --network host
  --ipc=host
  --user "$(id -u):$(id -g)"
  # Writable HOME for npm whatever uid the runner has (no passwd entry needed).
  -e HOME=/tmp
  -v "${workdir}:${workdir}"
  -w "${workdir}"
)

if [[ -d "${certs_dir}" ]]; then
  docker_args+=(-v "${certs_dir}:${certs_dir}:ro")
fi

for name in "${PASSTHROUGH[@]}"; do
  if [[ -n "${!name+x}" ]]; then
    docker_args+=(-e "${name}")
  fi
done

if [[ "${1:-}" == "--check" ]]; then
  # Fails the step unless the image matches the lockfile: same Playwright
  # version as the installed package, the browser revision it expects is
  # present, and the Node inside the image satisfies `engines` (>=24 <25).
  if [[ ! "${PLAYWRIGHT_IMAGE}" =~ :v([0-9]+\.[0-9]+\.[0-9]+)- ]]; then
    echo "PLAYWRIGHT_IMAGE must carry a fixed vX.Y.Z-<distro> tag" >&2
    exit 1
  fi
  echo "runner: node $(node -v), npm $(npm -v), N-API $(node -p process.versions.napi)"
  exec docker "${docker_args[@]}" -e "PLAYWRIGHT_IMAGE_VERSION=${BASH_REMATCH[1]}" \
    "${PLAYWRIGHT_IMAGE}" bash -c '
    set -euo pipefail
    image_version="${PLAYWRIGHT_IMAGE_VERSION:?}"
    echo "image: node $(node -v), npm $(npm -v), N-API $(node -p process.versions.napi), $(. /etc/os-release && echo "$PRETTY_NAME")"
    node -e "
      const major = Number(process.versions.node.split(\".\")[0]);
      if (major !== 24) { console.error(\"node \" + process.version + \" does not satisfy engines >=24 <25\"); process.exit(1); }
      const pkg = require(\"./node_modules/playwright-core/package.json\").version;
      if (pkg !== process.env.PLAYWRIGHT_IMAGE_VERSION) { console.error(\"playwright-core \" + pkg + \" != image \" + process.env.PLAYWRIGHT_IMAGE_VERSION); process.exit(1); }
      const chromium = require(\"./node_modules/playwright-core/browsers.json\").browsers.find((b) => b.name === \"chromium\");
      const dir = \"/ms-playwright/chromium-\" + chromium.revision;
      if (!require(\"node:fs\").existsSync(dir)) { console.error(\"missing \" + dir); process.exit(1); }
      console.log(\"playwright-core \" + pkg + \" matches the image; \" + dir + \" present\");
    "
    npx --no-install playwright --version
  '
fi

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...] | --check" >&2
  exit 2
fi

exec docker "${docker_args[@]}" "${PLAYWRIGHT_IMAGE}" "$@"
