#!/usr/bin/env bash
# Refreshes nix/pins.json, the hashes the flake's two variants build from.
#
#   nix/update-pins.sh release [vX.Y.Z]  pin a release's AppImage (default: the newest v* release)
#   nix/update-pins.sh bun               pin the Bun that package.json's packageManager names
#   nix/update-pins.sh deps              re-hash node_modules + Electron after bun.lock changes
#
# Needs git, jq, nix, and for `release` an authenticated gh.
# See docs/build-and-release.md#the-nix-flake.
set -euo pipefail

readonly REPO=ensemblr-hq/ensemblr
readonly SYSTEM=x86_64-linux
readonly FAKE_HASH=sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=

root=$(git rev-parse --show-toplevel)
pins="$root/nix/pins.json"

usage() {
	sed -n '4,6p' "$0" | sed 's/^# //' >&2
	exit 64
}

# Applies a jq filter to pins.json in place, tab-indented the way Biome wants it.
# The filter finishes before the file is opened, and writing through the existing
# file keeps its mode, where a mktemp file moved over it would leave it 0600.
write_pins() {
	local filter=$1
	shift
	local next
	next=$(jq --tab "$@" "$filter" "$pins")
	printf '%s\n' "$next" >"$pins"
}

# Converts a GitHub asset digest (`sha256:<hex>`) to the SRI form Nix takes.
sri_from_digest() {
	nix hash convert --hash-algo sha256 --to sri "${1#sha256:}"
}

pin_release() {
	local tag=${1:-}
	if [[ -z $tag ]]; then
		# `releases/latest` skips prereleases, which is what keeps the rolling
		# `nightly` out.
		tag=$(gh api "repos/$REPO/releases/latest" --jq .tag_name)
	fi
	local asset
	asset=$(gh api "repos/$REPO/releases/tags/$tag" --jq '
		[.assets[] | select(.name | test("-x64\\.AppImage$"))]
		| if length == 1 then .[0] else error("expected exactly one x64 AppImage, found \(length)") end
		| {name, digest}')
	local name digest
	name=$(jq -r .name <<<"$asset")
	digest=$(jq -r .digest <<<"$asset")
	if [[ $digest != sha256:* ]]; then
		echo "GitHub reports no sha256 digest for $name." >&2
		exit 1
	fi
	write_pins '.release = {version: $version, asset: $asset, hash: $hash}' \
		--arg version "${tag#v}" --arg asset "$name" --arg hash "$(sri_from_digest "$digest")"
	echo "Pinned the release to $tag ($name)."
}

pin_bun() {
	local version
	version=$(jq -r '.packageManager | select(startswith("bun@")) | ltrimstr("bun@")' "$root/package.json")
	if [[ -z $version ]]; then
		echo "package.json's packageManager does not name a Bun version." >&2
		exit 1
	fi
	local hash
	hash=$(nix store prefetch-file --json \
		"https://github.com/oven-sh/bun/releases/download/bun-v$version/bun-linux-x64-baseline.zip" |
		jq -r .hash)
	write_pins '.bun = {version: $version, hash: $hash}' --arg version "$version" --arg hash "$hash"
	echo "Pinned Bun $version."
}

# Puts the deps pin back and drops the build log. Runs on every exit while the
# placeholder is in pins.json, so an error or an interrupt never leaves it there.
restore_deps_pin() {
	write_pins '.deps[$system] = $hash' --arg system "$SYSTEM" --arg hash "$deps_previous"
	rm -f "$deps_log"
}

pin_deps() {
	deps_previous=$(jq -r --arg system "$SYSTEM" '.deps[$system]' "$pins")
	deps_log=$(mktemp)
	trap restore_deps_pin EXIT
	write_pins '.deps[$system] = $hash' --arg system "$SYSTEM" --arg hash "$FAKE_HASH"

	if nix build "$root#packages.$SYSTEM.master.deps" --no-link 2>"$deps_log"; then
		echo "The placeholder hash built, which should be impossible; left the pin as it was." >&2
		exit 1
	fi

	local hash
	hash=$(sed -nE 's/.*got: +(sha256-[A-Za-z0-9+/]+=*).*/\1/p' "$deps_log" | tail -n1)
	if [[ -z $hash ]]; then
		cat "$deps_log" >&2
		echo "The deps build failed before reporting a hash; left the pin as it was." >&2
		exit 1
	fi

	trap - EXIT
	rm -f "$deps_log"
	write_pins '.deps[$system] = $hash' --arg system "$SYSTEM" --arg hash "$hash"
	echo "Pinned the $SYSTEM deps to $hash."
}

case ${1:-} in
release) pin_release "${2:-}" ;;
bun) pin_bun ;;
deps) pin_deps ;;
*) usage ;;
esac
