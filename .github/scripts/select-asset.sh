#!/usr/bin/env bash
# Print the one path in LIST_FILE that matches PATTERN, and fail unless exactly
# one does.
#
# Usage: bash .github/scripts/select-asset.sh LIST_FILE PATTERN
#
# PATTERN is an extended regular expression matched against the whole path, so
# it anchors on the architecture the caller is building. Taking "the first
# match" instead is how an Intel archive ends up in the arm64 update feed: the
# feed document names the archive it points at, and a wrong pick is silent.
# Zero matches and more than one are both errors for the same reason — either
# means the build produced something the caller did not expect.
set -euo pipefail

if [ "$#" -ne 2 ]; then
	echo "usage: select-asset.sh LIST_FILE PATTERN" >&2
	exit 2
fi

list_file="$1"
pattern="$2"

matches=$(grep -E -- "$pattern" "$list_file" || true)
count=$(printf '%s' "$matches" | grep -c . || true)

if [ "$count" -ne 1 ]; then
	echo "::error::Expected exactly one asset matching '$pattern', found $count. Candidates:" >&2
	sed 's/^/  /' "$list_file" >&2
	exit 1
fi

printf '%s\n' "$matches"
