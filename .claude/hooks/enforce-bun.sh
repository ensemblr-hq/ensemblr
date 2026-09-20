#!/usr/bin/env bash
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

# Strip quoted spans first: a package-manager name inside a string is an
# argument, not an invocation — `grep "npm run" docs/` and
# `sed 's|&& npm ci|&& bun ci|' f` are both legitimate and were blocked by an
# earlier version of this hook that matched anywhere in the line.
stripped=$(printf '%s' "$command" | sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g')

# Then anchor on a command position — start of the line, or just after a shell
# separator — so a filename like `.npmrc` or a flag value is never a match.
blocked='(^|[;&|(])[[:space:]]*(sudo[[:space:]]+)?(npm|npx|pnpm|pnpx|yarn|yarnpkg|corepack)([[:space:]]|$)'

if [[ "$stripped" =~ $blocked ]]; then
	echo "BLOCK: this repo enforces Bun. Use bun equivalents: bun install, bun add <pkg>, bun remove <pkg>, bun run <script>, or bunx <pkg>." >&2
	exit 2
fi
