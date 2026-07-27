#!/usr/bin/env bash
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

if [[ -z "$command" ]]; then
  exit 0
fi

# Resolve the binary a shell segment actually invokes: strip quotes and any
# directory prefix, skip leading VAR=value assignments, and step over wrapper
# commands so `env FOO=1 sudo /usr/bin/pnpm add x` still reports `pnpm`.
resolve_invoked_command() {
  local segment="${1#"${1%%[![:space:]]*}"}"
  segment="${segment#[\{\(]}"

  while [[ -n "$segment" ]]; do
    segment="${segment#"${segment%%[![:space:]]*}"}"
    local token="$segment" rest=""

    if [[ "$segment" == *[[:space:]]* ]]; then
      token="${segment%%[[:space:]]*}"
      rest="${segment#"$token"}"
    fi

    if [[ "$token" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ || "$token" == -* ]]; then
      segment="$rest"
      continue
    fi

    local base="${token#[\"\']}"
    base="${base%[\"\']}"
    base="${base##*/}"

    case "$base" in
      sudo | command | exec | time | noglob | nohup | env | xargs)
        segment="$rest"
        continue
        ;;
    esac

    printf '%s' "$base"
    return 0
  done
}

# Split on shell command separators, but only outside quotes: a `|` inside
# `grep -E 'npm |npx '` is data, not a pipe, and splitting on it would flag the
# argument as an invocation.
split_command_segments() {
  local text="$1" quote="" out="" i char
  for ((i = 0; i < ${#text}; i++)); do
    char="${text:i:1}"
    if [[ -n "$quote" ]]; then
      # A newline inside quotes is data, not a separator; the read loop below
      # splits on newlines, so fold it to a space to keep the quoted argument
      # in one segment (else `-m "line1<newline>npm ..."` false-blocks).
      if [[ "$char" == $'\n' ]]; then
        out+=" "
      else
        out+="$char"
      fi
      [[ "$char" == "$quote" ]] && quote=""
      continue
    fi
    case "$char" in
      \' | \")
        quote="$char"
        out+="$char"
        ;;
      \; | \& | \|)
        out+=$'\n'
        ;;
      *)
        out+="$char"
        ;;
    esac
  done
  printf '%s\n' "$out"
}

blocked=""
while IFS= read -r segment; do
  case "$(resolve_invoked_command "$segment")" in
    npm | npx)
      blocked="npm"
      break
      ;;
    bun | bunx | pnpm | pnpx | yarn | yarnpkg)
      blocked="alt"
      break
      ;;
    corepack)
      if [[ "$segment" =~ (^|[[:space:]])(bun|bunx|pnpm|pnpx|yarn|yarnpkg)(@[^[:space:]]*)?([[:space:]]|$) ]]; then
        blocked="alt"
        break
      fi
      ;;
  esac
done < <(split_command_segments "$command")

if [[ "$blocked" == "npm" ]]; then
  echo "BLOCK: this repo runs on nub. Use nub install / nub ci, nub add <pkg>, nub remove <pkg>, nub run <script>, nubx <pkg>, or nub <file>.ts instead of npm/npx. See ADR 0039." >&2
  exit 2
elif [[ -n "$blocked" ]]; then
  echo "BLOCK: this repo runs on nub. Do not call bun/bunx/pnpm/pnpx/yarn. Use nub install, nub add <pkg>, nub run <script>, or nubx <pkg>. See ADR 0039." >&2
  exit 2
fi
