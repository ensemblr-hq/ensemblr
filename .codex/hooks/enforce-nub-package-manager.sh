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
      \'|\")
        quote="$char"
        out+="$char"
        ;;
      \;|\&|\|)
        out+=$'\n'
        ;;
      *)
        out+="$char"
        ;;
    esac
  done
  printf '%s\n' "$out"
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

    if [[ "$token" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ || "$token" == -* ]]; then
      segment="$rest"
      continue
    fi

    case "$base" in
      sudo|command|exec|time|noglob|nohup|xargs)
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
    npm|npx|bun|bunx|pnpm|pnpx|yarn|yarnpkg)
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
done < <(split_command_segments "$command_text")

if [[ -n "$blocked_command" ]]; then
  jq -cn --arg blocked "$blocked_command" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("BLOCK: this repo runs on nub. Do not call " + $blocked + ". Use nub install / nub ci, nub add <pkg>, nub remove <pkg>, nub run <script>, nubx <pkg>, or nub <file>.ts. See ADR 0039.")
    }
  }'
fi
