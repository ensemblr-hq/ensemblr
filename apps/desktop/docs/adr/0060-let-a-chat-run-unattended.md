# 0060. Let a Chat Run Unattended

Date: 2026-09-05

## Status

Accepted

Mirrors [0044](./0044-enforce-plan-mode-fail-closed-at-the-control-channel.md),
which put Plan Mode's enforcement in `shared/` behind the control channel, and
[0057](./0057-answer-the-harness-plan-workflow-in-the-per-turn-preamble.md),
which established the per-turn preamble as the channel for anything that moves
between turns. AFK is the third user of both shapes and the first that is not
about planning.

## Context

The composer already carries a Plan Mode chip: stop, investigate, and come back
with a plan the user approves. Its premise is that somebody is watching.

Nothing in the app carries the opposite premise, and three surfaces assume the
user is present:

1. **`ensemblr_ask_user_question`** blocks the agent's turn until a human answers
   or dismisses it, with no time limit. That is deliberate — the agent asked
   because it could not proceed, and a human is allowed to take their time — and
   it is exactly what turns an overnight run into a turn that made no progress
   after minute four. Claude Code's own `AskUserQuestion` does the same and never
   touches Ensemblr's control server.
2. **The `approval-required` confirmation** `gatePermission` raises on every
   control write.
3. **Claude's per-tool `canUseTool` prompt** in the same mode.

A user who steps away has no way to say so. The workarounds are all worse than
the problem: `workspace-trusted` permanently widens the permission mode, and a
prompt that says "don't ask me anything" is advice the next turn forgets.

## Decision

**A per-chat AFK toggle, built as Plan Mode's opposite number and mutually
exclusive with it.** Everything it needs already exists, so it is a second
instance of each mechanism rather than a parallel path: a
`chatAfkModeAtomFamily` in `localStorage` that rides every open and submit, an
in-memory `AfkModeRegistry` mirroring it in main, a control-op denial in
`src/shared/afk-mode/`, and a per-turn block on the same channel `planRefinement`
and the upkeep block ride.

### The ask tool is refused, and told what to do instead

`afkModeControlOpDenial` answers `denied-scope`, and the reason carries the
escape hatch rather than only the cause: take the most defensible reading, act on
it, and record the assumption in the final message under its own heading. An
agent told only "no" retries the same call or stops, and both lose the run the
mode exists to keep moving. `buildAfkDirective` puts the same instruction in the
turn's preamble so the refusal is not discovered by trial.

Claude Code's native `AskUserQuestion` is withheld by a **`PreToolUse` hook**
rather than a `disallowedTools` entry. The SDK fixes that list when `query()`
opens while the chip moves per turn, so a list built at open would keep refusing
the tool after the user came back and would let it through for a chat that went
AFK mid-run. The hook reads the live flag at call time and tracks the toggle both
ways — including on a steer or a follow-up, which is what "mid-run" actually
means. It is *added* to whatever hooks the session already registers rather than
installed instead of them: the Concierge's containment hook and this one both
exist to refuse, and a deny from either has to stand.

### Confirmations are auto-approved, with two carve-outs

Two dialogs resolve approved without being raised: `gatePermission`'s, on every
control write, and Claude's own per-tool card, which `canUseTool` raises inside
the same `approval-required` mode and which parks the tool call with no deadline
of its own. They are one decision rather than two — closing only the first would
leave a chat stalling on its first `Edit` in the one mode where the first even
fires.

This is a real escalation — a composer chip now answers dialogs that exist to be
answered by a human — and it is bounded in two places:

- **It reaches only the `confirmation-required` boundary.** A `blocked` one is
  still blocked, so a `read-only` workspace stays read-only, and a containment
  gate that refuses outright — the Concierge's — is never wrapped. AFK answers a
  question the mode already permits; it never widens the mode.
- **The peer-orchestrator confirmation is refused, not approved.** That dialog
  exists because the playbook only lets an agent open a second writer on the
  worktree *when the user asks it to*, and that premise cannot hold while they
  are away. It fails fast with a reason rather than waiting on a dialog nobody
  will answer, so two unsupervised writers never land on one worktree.

The counterweight to what *is* approved lives in the directive: nobody is
watching, so the agent's own judgement is the only remaining gate on anything
hard to reverse or outward-facing.

### Mutually exclusive with Plan Mode

Planning exists to stop and ask, which is the one thing AFK rules out. The
composer clears one atom when the other is switched on; `applyTurnModes` in the
IPC handler applies the same rule against the registries, because a second or
stale window can still send both.

Exclusivity resolves in favour of the flag the request actually **states**, so a
mode left in the registry by an earlier turn cannot veto the one the user just
switched on. When a request states both — which only a stale window can do — Plan
Mode wins: it is the more restrictive, and AFK's promise is that the agent keeps
working.

### Inherited by spawns

A conversation an unattended agent opens inherits AFK, exactly as a planning
parent's child inherits Plan Mode and along the same path: snapshotted at spawn,
registered before `submitPrompt` resolves, and mirrored to the renderer so the
child's composer tells the truth. A sub-agent already cannot ask the user, but a
peer can, and a peer spawned by an unattended agent would otherwise raise a
dialog in a tab nobody is watching.

## Consequences

**A chat can now finish work overnight.** The three surfaces that could park a
turn indefinitely are closed, and the agent is told what to do at each one rather
than left to discover a refusal.

**The user's account of an unattended run is the final message.** The directive
asks for the assumptions in a named section, and the session summary matters more
on a turn nobody watched than on any other. This is a weaker record than a dialog
the user answered, and that is the trade the mode makes.

**Auto-approval is scoped, not general.** The two carve-outs are the load-bearing
part of this ADR: a future op that adds a blocking prompt has to decide which
side it falls on, and "AFK approves it" is not the automatic answer.

**The chip is `AFK` in all three languages.** A borrowed acronym in the class of
`commit` and `worktree`, because the composer's control row has no room for
`Не за компьютером` or `Λειτουργία απουσίας`; the meaning rides the translated
tooltip, which names the behaviour (*work without asking me*) rather than the
user's absence.

**One more thing rides the per-turn preamble.** That channel now carries the
upkeep block, the plan-delegation directive, the refinement directive, the AFK
directive, the language directive, the linked-issue directive, and the co-author
credit. Each is null when it does not apply, but the list is long enough that the
next addition should be weighed against folding two of them together.
