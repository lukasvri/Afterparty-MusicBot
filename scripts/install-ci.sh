#!/usr/bin/env bash
# Retained operator entrypoint for all locked native/Core toolchains.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec npm --prefix "$project_root" run install:ci -- "$@"
