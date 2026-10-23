#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 17)) { console.error("Node.js 24.17+ is required."); process.exit(1); }'
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "Python 3.11+ is required.")'
if ! command -v ffmpeg >/dev/null; then
  printf 'FFmpeg is required for the real audio tests. Install it before running this script.\n' >&2
  exit 1
fi

case "${1:-check}" in
  setup)
    npm ci --no-audit --no-fund
    npm --prefix services/core ci --omit=peer --ignore-scripts --no-audit --no-fund
    npm --prefix apps/web ci --no-audit --no-fund
    ;;
  check)
    npm run lint
    python3 -m unittest discover -s tests -v
    node node_modules/typescript/bin/tsc --noEmit --incremental false
    npm run test:unit
    npm --prefix services/core run check
    npm --prefix services/core test
    npm run build
    npm --prefix apps/web run format:check
    npm --prefix apps/web run check
    npm --prefix apps/web test
    npm --prefix apps/web run build
    ;;
  *) printf 'Usage: %s setup|check\n' "$0" >&2; exit 2 ;;
esac
