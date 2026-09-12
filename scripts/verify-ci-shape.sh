#!/usr/bin/env bash
#
# Run the browser suite the way CI runs it, not the way this machine does.
#
# Three CI failures in a row came from the same shape of mistake: the local
# environment differs from the runner's, so a green local run proved nothing
# about the thing that was about to go red.
#
#   1. `npm run dev` on 3100 vs the packaged artifact on 3001.
#   2. macOS fonts vs Linux fonts — `sans-serif` is 9-12% wider on a runner, so
#      three placeholders fit here and were clipped there.
#   3. **LASTFM_API_KEY is set in this .env and unset in CI.** Every test gated
#      on "an unconfigured deployment never mentions Last.fm" therefore *skips*
#      locally and runs on the runner. A regression in that copy is invisible
#      here by construction.
#
# This closes the first and the third. The second is handled inside the suite
# itself, which now requires placeholders to fit with headroom rather than
# merely to fit.
#
# Usage: scripts/verify-ci-shape.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3001}"
BASE="http://localhost:${PORT}"

set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
# shellcheck disable=SC1091
[ -f .env.local ] && . ./.env.local
set +a

# The point of the exercise: CI has no Last.fm credentials.
unset LASTFM_API_KEY LASTFM_SHARED_SECRET
export APP_BASE_URL="$BASE"

echo "==> Building"
npm run build >/dev/null

echo "==> Packaging"
rm -rf artifact && mkdir -p artifact
cp -r .next/standalone/. artifact/
mkdir -p artifact/.next && cp -r .next/static artifact/.next/static
[ -d public ] && cp -r public artifact/public
mkdir -p artifact/scripts
cp scripts/start-standalone.cjs scripts/smoke.js scripts/check-env.mjs artifact/scripts/
cp -r prisma artifact/prisma

echo "==> Serving on ${PORT}"
if lsof -ti:"$PORT" >/dev/null 2>&1; then kill "$(lsof -ti:"$PORT")"; sleep 1; fi
PORT="$PORT" node artifact/scripts/start-standalone.cjs >/tmp/tj-verify.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true; rm -rf artifact' EXIT

for _ in $(seq 1 45); do
  curl -sf -o /dev/null "${BASE}/api/health" && break
  sleep 1
done
curl -sf -o /dev/null "${BASE}/api/health" || { echo "server never became healthy"; tail -20 /tmp/tj-verify.log; exit 1; }

echo "==> Smoke"
node scripts/smoke.js "$BASE"

echo "==> Browser suite"
E2E_BASE_URL="$BASE" npx playwright test

echo "==> CI-shaped verification passed"
