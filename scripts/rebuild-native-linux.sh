#!/usr/bin/env bash
# node-pty is the one dependency Linux has to compile — it publishes prebuilds
# for darwin and win32 only — and an immutable distro (SteamOS, Silverblue)
# ships no compiler to compile it with. Rather than unlock the root filesystem
# for one native module, build it in a throwaway Debian container and leave the
# result in node_modules, where Forge finds it already built and skips its own
# rebuild step. Nothing is installed on the host and nothing persists.
#
# Debian bookworm is deliberate: it links an older glibc than any desktop host,
# and old-built-runs-on-new is the safe direction for a binary that ends up
# inside a shipped artifact. Building against a *newer* glibc than the target
# fails at load time on the target, which is a user's machine, not this one.
set -euo pipefail

# Bookworm's node:24 image is FROM buildpack-deps, so g++/make are already there.
IMAGE=${ENSEMBLR_NATIVE_REBUILD_IMAGE:-node:24-bookworm}
MODULE=node_modules/node-pty

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

if [ "$(uname -s)" != "Linux" ]; then
	echo "✖ rebuild-native-linux.sh builds a linux-x64 binding, but this is $(uname -s)." >&2
	echo "  Running it here would overwrite the host's own node-pty binding with one" >&2
	echo "  this machine cannot load. Build the Linux artifact on Linux or in CI." >&2
	exit 1
fi

if command -v podman >/dev/null 2>&1; then
	runtime=podman
elif command -v docker >/dev/null 2>&1; then
	runtime=docker
else
	echo "✖ Neither podman nor docker is installed, and one of them is how this" >&2
	echo "  script gets a compiler without touching the host." >&2
	echo "" >&2
	echo "  Install one, or install a toolchain natively and let Forge compile:" >&2
	echo "    Debian/Ubuntu:  sudo apt-get install -y build-essential python3" >&2
	echo "    Fedora:         sudo dnf install -y gcc-c++ make python3" >&2
	echo "    Arch:           sudo pacman -S --needed base-devel python" >&2
	exit 1
fi

if [ ! -d "$repo_root/node_modules/@electron/rebuild" ]; then
	echo "✖ node_modules is missing @electron/rebuild — run npm ci first." >&2
	exit 1
fi

echo "Rebuilding node-pty in $IMAGE via $runtime…"

"$runtime" run --rm \
	--volume "$repo_root":/src \
	--workdir /src \
	"$IMAGE" \
	bash -euo pipefail -c '
		command -v python3 >/dev/null 2>&1 || {
			apt-get update -qq && apt-get install -y -qq python3
		}
		npx electron-rebuild --force --module-dir '"$MODULE"'
	'

binding="$repo_root/$MODULE/build/Release/pty.node"

if [ ! -f "$binding" ]; then
	echo "✖ The container reported success but $MODULE/build/Release/pty.node is absent." >&2
	exit 1
fi

# Rootless podman maps container root to the invoking user, so the output is
# already owned correctly; rootful docker leaves it owned by root instead.
owner=$(stat -c %u "$binding")
if [ "$owner" != "$(id -u)" ]; then
	echo "" >&2
	echo "⚠ $MODULE/build is owned by uid $owner, not you ($(id -u))." >&2
	echo "  Your container runtime runs as root. Fix with:" >&2
	echo "    sudo chown -R $(id -u):$(id -g) $MODULE/build" >&2
	echo "" >&2
fi

exec node "$repo_root/scripts/require-linux-toolchain.mjs" --report
