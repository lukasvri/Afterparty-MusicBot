#!/usr/bin/env bash
# Retained operator entrypoint. Native build subprocesses have bounded timeouts.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
exec npm run build -- "$@"
