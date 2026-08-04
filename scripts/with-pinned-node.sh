#!/usr/bin/env bash
# Conductor scripts (and any other non-interactive shell) never source the
# mise/nvm shell hooks, so `npm ci` there runs under whatever Node is first on
# PATH — Homebrew's Node 26 — which the preinstall guard rejects, and which
# would otherwise compile macos-alias/fs-xattr for the wrong ABI. Put the Node
# pinned in .nvmrc on PATH first, then hand the command over. Falls through to
# the caller unchanged when no version manager is available, so the repo's own
# guard prints its fix instructions instead of a "command not found".
set -euo pipefail

if [ "$#" -eq 0 ]; then
	echo "usage: with-pinned-node.sh <command> [args...]" >&2
	exit 64
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
required=$(tr -d '[:space:]' <"$repo_root/.nvmrc")
current=$(node --version 2>/dev/null | sed 's/^v//; s/\..*//' || true)

if [ "$current" = "$required" ]; then
	exec "$@"
fi

if command -v mise >/dev/null 2>&1; then
	exec mise exec "node@$required" -- "$@"
fi

nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$nvm_script" ]; then
	# shellcheck disable=SC1090
	. "$nvm_script"
	if nvm use "$required" >/dev/null 2>&1; then
		exec "$@"
	fi
fi

brew_prefix=$(brew --prefix "node@$required" 2>/dev/null || true)
if [ -n "$brew_prefix" ] && [ -x "$brew_prefix/bin/node" ]; then
	export PATH="$brew_prefix/bin:$PATH"
	exec "$@"
fi

exec "$@"
