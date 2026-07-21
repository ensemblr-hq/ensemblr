# 0039. Remove the Open Chat Tab Limit

Date: 2026-07-21

## Status

Accepted

Supersedes [0022](0022-limit-open-chat-tabs-to-five.md).

## Context

ADR 0022 capped open chat tabs at five per workspace for Conductor parity and to
bound Pi session/UI resource usage. In practice the cap blocked users mid-flow:
opening a sixth chat surfaced a warning toast and a soft no-op, forcing a close
before a new conversation could start. The parity argument no longer outweighs
the friction, and the workspace already streams tabs lazily, so the resource
ceiling the limit protected is not a practical concern.

## Decision

Ensemblr allows an unlimited number of open chat tabs per workspace.

Rules:

- No cap applies to `kind: 'chat'` tabs.
- The `CHAT_TAB_LIMIT` constant, `CHAT_TAB_LIMIT_ERROR_CODE` marker, and
  `ChatTabLimitError` are removed; `openTab` no longer counts open chat tabs.
- The min-one-open-chat-tab rule from `closeTab` is unchanged.
- Non-chat tabs (file/diff/document/preview) still re-focus an already-open tab
  for the same subject instead of duplicating.

## Consequences

- Users can keep as many concurrent chat sessions open as they want.
- Ensemblr no longer matches Conductor's observed five-tab behavior; parity docs
  are updated to reflect the intentional divergence.
- Open Pi session/UI resource usage is bounded only by user behavior, not by a
  fixed ceiling.
