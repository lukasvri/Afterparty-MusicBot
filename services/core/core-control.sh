#!/usr/bin/env bash
set -euo pipefail
CORE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${CORE_COMPOSE_FILE:-$CORE_DIR/compose.yml}"
if [[ -z "${CORE_COMPOSE_FILE:-}" && -f "$CORE_DIR/compose.local.yml" ]]; then
 COMPOSE_FILE="$CORE_DIR/compose.local.yml"
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
 printf 'Compose configuration not found: %s\n' "$COMPOSE_FILE" >&2
 exit 1
fi
compose() { docker --context default compose --project-directory "$CORE_DIR" -f "$COMPOSE_FILE" "$@"; }
case "${1:-status}" in
 start) compose up -d --no-build ;;
 stop) compose stop core ;;
 logs) compose logs --tail=200 -f core ;;
 admin) printf "Open /admin on your configured PUBLIC_SITE_URL.\n" ;;
 status) compose ps; curl --fail --silent http://127.0.0.1:3990/health; printf '\n' ;;
 *) printf 'Usage: %s start|stop|logs|admin|status\n' "$0"; exit 2 ;;
esac
