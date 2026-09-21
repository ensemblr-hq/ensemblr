#!/usr/bin/env bash
# Put the Node pinned in .nvmrc first on PATH, then hand the command over.
# Setup and run scripts need this even though Ensemblr injects a login-shell
# PATH that has already activated mise: *having* mise's Node on PATH is not the
# same as having it *first*. A startup file that prepends Homebrew after
# activating mise — `eval (brew shellenv)` below `mise activate`, the common
# order — leaves Homebrew's Node 26 ahead of it, and mise's hook re-applies only
# when it detects a change, so the captured PATH keeps the wrong one. `bun ci`
# then hands that Node to every lifecycle script: the preinstall guard rejects
# it, and it would otherwise compile macos-alias/fs-xattr for the wrong ABI.
#
# This was deleted once, on the belief that the login-shell capture made it
# redundant, and every workspace's setup script failed on the next run. Keep it
# until the capture itself puts the pinned toolchain first.
#
# Falls through to the caller unchanged when no version manager is available, so
# the repo's own guard prints its fix instructions instead of "command not found".
set -euo pipefail

if [ "$#" -eq 0 ]; then
	echo "usage: with-pinned-node.sh <command> [args...]" >&2
	exit 64
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
required=$(tr -d '[:space:]' <"$repo_root/.nvmrc")

major_of() {
	"$1" --version 2>/dev/null | sed 's/^v//; s/\..*//' || true
}

bin_dir_is_pinned() {
	[ -x "$1/node" ] && [ "$(major_of "$1/node")" = "$required" ]
}

run_with_bin_dir() {
	export PATH="$1:$PATH"
	hash -r 2>/dev/null || true
	shift
	exec "$@"
}

if [ "$(major_of node)" = "$required" ]; then
	exec "$@"
fi

if command -v mise >/dev/null 2>&1; then
	mise_root=$(mise where "node@$required" 2>/dev/null || true)
	if [ -z "$mise_root" ]; then
		mise install "node@$required" >&2 || true
		mise_root=$(mise where "node@$required" 2>/dev/null || true)
	fi
	# `mise exec` appends its tool bin dir *after* the inherited PATH entries, so
	# Homebrew's node still wins for any child that re-resolves it — which is
	# exactly what Bun's lifecycle scripts do. Prepend the dir ourselves.
	if [ -n "$mise_root" ] && bin_dir_is_pinned "$mise_root/bin"; then
		run_with_bin_dir "$mise_root/bin" "$@"
	fi
fi

nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$nvm_script" ]; then
	# shellcheck disable=SC1090
	. "$nvm_script"
	if nvm use "$required" >/dev/null 2>&1; then
		nvm_node=$(nvm which "$required" 2>/dev/null || true)
		nvm_bin=$([ -n "$nvm_node" ] && dirname "$nvm_node" || true)
		if [ -n "$nvm_bin" ] && bin_dir_is_pinned "$nvm_bin"; then
			run_with_bin_dir "$nvm_bin" "$@"
		fi
	fi
fi

brew_prefix=$(brew --prefix "node@$required" 2>/dev/null || true)
if [ -n "$brew_prefix" ] && bin_dir_is_pinned "$brew_prefix/bin"; then
	run_with_bin_dir "$brew_prefix/bin" "$@"
fi

exec "$@"
