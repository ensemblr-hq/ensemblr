#!/usr/bin/env bash
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

if [[ "$command" =~ (^|[^[:alnum:]_])(npm|npx|yarn|pnpm|pnpx)([^[:alnum:]_]|$) ]]; then
  echo "BLOCK: Only bun is allowed as a package manager. Use bun instead of npm/yarn/pnpm." >&2
  exit 2
fi
