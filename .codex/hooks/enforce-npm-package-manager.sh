#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
command_text="$(jq -r '.tool_input.command // .tool_input.cmd // ""' <<<"$payload")"

if [[ -z "$command_text" ]]; then
  exit 0
fi

trim_left() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "$value"
}

clean_token_base() {
  local token="$1"
  token="${token#\"}"
  token="${token%\"}"
  token="${token#\'}"
  token="${token%\'}"
  token="${token##*/}"
  printf '%s' "$token"
}

first_invoked_command() {
  local segment
  segment="$(trim_left "$1")"
  segment="${segment#\{}"
  segment="${segment#\(}"

  while [[ -n "$segment" ]]; do
    segment="$(trim_left "$segment")"
    local token="$segment"
    local rest=""

    if [[ "$segment" == *[[:space:]]* ]]; then
      token="${segment%%[[:space:]]*}"
      rest="${segment#"$token"}"
    fi

    local base
    base="$(clean_token_base "$token")"

    if [[ "$token" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]]; then
      segment="$rest"
      continue
    fi

    case "$base" in
      sudo|command|exec|time|noglob|nohup)
        segment="$rest"
        continue
        ;;
      env)
        segment="$rest"
        while [[ -n "$segment" ]]; do
          segment="$(trim_left "$segment")"
          token="$segment"
          rest=""

          if [[ "$segment" == *[[:space:]]* ]]; then
            token="${segment%%[[:space:]]*}"
            rest="${segment#"$token"}"
          fi

          if [[ "$token" == -* || "$token" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]]; then
            segment="$rest"
            continue
          fi

          break
        done
        continue
        ;;
    esac

    printf '%s' "$base"
    return 0
  done
}

blocked_command=""

while IFS= read -r segment; do
  invoked="$(first_invoked_command "$segment")"

  case "$invoked" in
    bun|bunx|pnpm|pnpx|yarn|yarnpkg)
      blocked_command="$invoked"
      break
      ;;
    corepack)
      if [[ "$segment" =~ (^|[[:space:]])(bun|bunx|pnpm|pnpx|yarn|yarnpkg)(@[^[:space:]]*)?([[:space:]]|$) ]]; then
        blocked_command="corepack ${BASH_REMATCH[2]}"
        break
      fi
      ;;
  esac
done < <(printf '%s\n' "$command_text" | sed -E 's/[;&]+/\n/g; s/[[:space:]]*\|\|[[:space:]]*/\n/g; s/[[:space:]]*\|[[:space:]]*/\n/g')

if [[ -n "$blocked_command" ]]; then
  jq -cn --arg blocked "$blocked_command" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("BLOCK: this repo enforces npm. Do not call " + $blocked + ". Use npm equivalents: npm install, npm i <pkg>, npm uninstall <pkg>, npm run <script>, or npx <pkg>.")
    }
  }'
fi
