#!/usr/bin/env bash
set -euo pipefail
CORE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$CORE_DIR"
case "${1:-status}" in
 start) docker --context default compose up -d --no-build ;;
 stop) docker --context default compose stop core ;;
 logs) docker --context default compose logs --tail=200 -f core ;;
 admin) printf "Open /admin on your configured PUBLIC_SITE_URL.\n" ;;
 status) docker --context default compose ps; curl --fail --silent http://127.0.0.1:3990/health ;;
 *) printf 'Bruk: %s start|stop|logs|admin|status\n' "$0"; exit 2 ;;
esac
