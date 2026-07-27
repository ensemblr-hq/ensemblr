#!/usr/bin/env bash
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

if [[ "$command" =~ (^|[^[:alnum:]_])(bun|bunx|pnpm|pnpx|yarn|yarnpkg|corepack)([[:space:]]|$) ]]; then
  echo "BLOCK: Only npm is allowed as a package manager. Use npm/npx instead of bun/yarn/pnpm." >&2
  exit 2
fi
