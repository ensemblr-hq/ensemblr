# 0049. Let the User Pick Claude Code's Sub-Agent Mechanism

Date: 2026-08-14

## Status

Accepted

Builds on [0042](0042-add-claude-code-as-a-second-first-class-agent-runtime.md)
and [0040](0040-use-loopback-control-server-for-agent-app-control.md).

## Context

A first-class Claude Code chat holds two ways to delegate. Claude Code ships its
own sub-agent tool — `Agent`, renamed from `Task` in v2.1.63, with both names
still live in permission-denial paths — and Ensemblr serves
`ensemblr_start_conversation`, which opens a real chat tab the user can watch,
steer, read, and audit.

Nothing arbitrated between them. The orchestrator playbook Ensemblr appends to
the session's system prompt describes the delegate → wait → evaluate → integrate
loop in detail, and the model reaches for its built-in tool anyway: that tool is
in its training, and a playbook is one voice among several in a long prompt. The
result is the worst of both — the app pays for a playbook nobody follows, and the
user loses the visible-tab workflow the whole control layer exists to provide.

Prose was not going to fix this. The playbook already says to drive the app
rather than tell the user to click, already says delegation runs through
`ensemblr_start_conversation`, and already spends five numbered steps on the wait
loop. Adding a sixth sentence saying it harder is the intervention that has
already failed.

Two mechanisms are also not obviously one-better-than-the-other. Chat tabs are
inspectable, resumable, individually steerable, and survive a restart; built-in
sub-agents are cheaper, stay inside one conversation, and are what a user
arriving from the Claude Code CLI already knows. That is a preference, not a
defect.

## Decision

Add `app.providers.claudeSubagentMode` to `config.json` — `ensemblr` (default) or
`native` — surfaced on Settings → Providers → Claude Code, and **enforce both
directions** so the mechanism the user did not pick is absent rather than
discouraged:

- Under `ensemblr`, `Agent` and `Task` are merged into the SDK's
  `disallowedTools` alongside whatever the permission mode already withheld.
- Under `native`, `spawnChatTab`, `startConversation`, `sendFollowUp`,
  `waitForAgents`, and `listModels` are withheld from the session's control tool
  list, and the session receives `NATIVE_ORCHESTRATOR_AWARENESS` instead of the
  chat-tab playbook.

Withholding rides on the axis that already exists. `ControlAudience` gains
`delegation` beside `hasChatTab` and `role`, and `withheldControlOps` folds all
three into one answer — the same argument on every axis, that listing a tool the
service would only refuse teaches the model to keep reaching for it.

**The mechanism is pinned at session open**, on `AgentControlOrigin.delegation`.
The SDK fixes `disallowedTools` when `query()` opens — unlike `permissionMode`,
which the adapter revises per turn — so a control server that re-read the setting
per request would let a mid-session flip leave that session denied its built-in
tool *and* withheld the spawn ops, able to delegate by neither. A change reaches
the next chat.

The scope is **root** first-class Claude Code chats. Pi has no sub-agent tool of
its own, so `resolveAgentControlWiring` pins every non-Claude runtime to
`ensemblr` whatever the setting says; withholding the spawn ops there would leave
Pi unable to delegate at all. A spawned child is pinned the same way and in the
same place: nested delegation is already blocked on every other axis —
`SUBAGENT_BLOCKED_OPS` refuses the spawn ops and `SUBAGENT_AWARENESS` says a
child never fans out — so a child opened under `native` would keep its runtime's
own sub-agent tool live and route an unbounded fan-out around the depth cap. The
setting picks how a *root* delegates, not how deep the tree goes.

## Consequences

**The default is today's intended behaviour, now actually enforced.** An existing
Claude chat that used to reach for `Agent` and succeed will now be refused and
fall through to `ensemblr_start_conversation`. That is the point, but it is a
behaviour change for every Claude session, not an opt-in.

**Terminal harnesses are out.** A harness's control token is minted per workspace
and shared by every terminal in it, so the app cannot tell a Claude Code CLI from
a Codex one and cannot vary the tool list per harness. Only the launch flag and
the playbook file could vary, which would enforce in one direction while the
other stayed open — worse than not offering the choice there. If it is wanted
later, `--disallowed-tools "Agent" "Task"` in `claudeDecoration`
(`src/main/agent-control/harness-launch-config.ts`) is the seam.

**A third playbook to keep in step.** `NATIVE_ORCHESTRATOR_AWARENESS` restates
the rules that are properties of the work rather than of the mechanism — split
before you fan out, brief for a deliverable, verify before you rely, gather the
open questions. The parity test covers it for content but not byte-for-byte
against the Pi extension, because no Pi session ever resolves to `native`.

**Two names for one tool, indefinitely.** The deny list carries `Agent` and
`Task` together because the rename landed mid-2.x and a user's `claude` binary
may predate it. Dropping `Task` needs an executable-version floor the app does
not currently assert.
