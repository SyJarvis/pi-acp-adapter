#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
adapter_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)

if ! command -v pi >/dev/null 2>&1; then
  printf '%s\n' 'pi is required; install it and ensure it is on PATH.' >&2
  exit 127
fi

exec pi -e "$adapter_root" "$@"
