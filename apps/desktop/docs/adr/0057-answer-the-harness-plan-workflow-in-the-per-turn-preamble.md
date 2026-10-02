# 0057. Answer the Harness Plan Workflow in the Per-Turn Preamble

Date: 2026-09-03

## Status

Accepted

Extends [0050](./0050-name-a-planning-workspace-before-the-agent-does.md), which
established that a runtime the app prompts directly reads Ensemblr's blocks
*against* the harness text it already holds, and built the per-turn preamble as
the channel for answering it. 0050 fixed one instance — workspace naming. This
is the second, and it is what turns the fix into a rule.

## Context

A Claude Code chat planning inside Ensemblr holds three instructions about
delegation, and they disagree. Agents notice, spend visible reasoning resolving
the conflict, and pick a route by guess. One turn produced this, verbatim:

> "I notice a tension between using Explore subagents as the plan workflow
> suggests versus the guidance not to call AgentTool unless requested. I'll opt
> for the safer, more direct route and just search the codebase myself."

That answer is defensible. The problem is that it was reached by guessing, and
the next turn guesses differently.

**Two of the three voices are upstream text Ensemblr cannot edit.**

1. **A standing anti-delegation line.** Claude Code ships the pair *"Do not call
   the AgentTool unless the user requested it"* / *"Do not use workflows or
   deep-research unless the user requested it"* as one constant, gated on the
   `opus_5_prompt_bundle` prompt bundle. It is not derived from `disallowedTools`
   and it is not plan-mode-aware — it reaches every Opus 5 session whatever the
   app around it has configured.
2. **A plan workflow ordering the opposite.** `permissionMode: 'plan'` injects
   Claude Code's own Plan Workflow, which says *"Launch up to 3 Explore agents IN
   PARALLEL"* and *"Critical: In this phase you should only use the Explore
   subagent type."* It also names a plan file under `~/.claude/plans/` and calls
   it "the only file you are allowed to edit".

**The third is ours, and it is the one that resolves them.**
`resolveDisallowedTools` (`src/main/claude-agent/claude-subagent-mode.ts`) denies
`Agent` and `Task` whenever the session's delegation mechanism is `ensemblr` —
the default. So the Explore fan-out is genuinely unavailable, a working
substitute (`ensemblr_start_conversation` + `ensemblr_wait_for_agents`) is live
in its place, and nothing in the agent's context says either thing.

Read alone, the standing line is worse than ambiguous: it suppresses
`ensemblr_start_conversation` too. An agent that takes it as a blanket ban on
delegating does the whole investigation by hand, which is the outcome above.

### Why the existing carve-out does not reach Claude

`PLAN_MODE_ORCHESTRATOR_AWARENESS` already answers all of this — it writes out
the fan-out loop, names the spawn ops, and says where the plan goes. It is
**Pi-only by design**, and not by oversight: `awarenessForAudience` is called
once per session at open (`agent-runtime/session/agent-control-wiring.ts`), the
Agent SDK fixes `systemPrompt` at open, and Ensemblr's plan-mode toggle moves per
turn. There is no point at which a Claude session could be handed a different
playbook without reopening it.

This is exactly the shape 0050 recorded for the upkeep block, one layer down.

### A second collision on the same turn

The plan workflow's plan file is unreachable or wasted, never useful:

- In `read-only` permission mode, `Write` is on Ensemblr's SDK deny list
  (`MUTATING_TOOLS`, `claude-agent/claude-permission-bridge.ts`). The agent is
  ordered to make a write it cannot make.
- In every other mode the write succeeds, into a path nothing in Ensemblr reads.
  `ensemblr_exit_plan_mode` and Claude's native `ExitPlanMode` both take the plan
  as an argument, and the app saves it under `.context/plans/`.

### Two holes found while tracing

**The native `ExitPlanMode`.** `createClaudePlanBridge` filed a plan for any
origin it could resolve. `SUBAGENT_WITHHELD_OPS` withholds `exitPlanMode` from a
sub-agent's MCP list, but the native `ExitPlanMode` tool is never on the deny
list — so a planning investigator could submit through it and raise a review
panel in a tab nobody is watching, which is the outcome
`SUBAGENT_BLOCKED_OPS['exitPlanMode']` exists to prevent.

**A resumed child taking the root's mechanism.** `resolveDelegation` pinned a
child to `ensemblr` on `parentSessionId` alone. That field rides the open
request, and a *resume* carries none — the same lineage gap the durable
sub-agent marker was introduced for. A child reopened after a restart while the
setting reads `native` therefore came back holding `Agent` and `Task` live,
fanning out around the depth cap, which is precisely what that pin exists to
stop. It also made the sub-agent variant of the new directive assert something
false: "your runtime's sub-agent tool is denied".

## Decision

**1. Answer the harness in the per-turn preamble, in its own vocabulary.**
`buildPlanModeDelegationDirective` (`src/shared/agent-control/session-brief.ts`)
renders a block that names `Explore`, `AgentTool`, and the plan file literally,
and says which instruction governs. `readTurnPreamble` appends it on every
planning turn, between the upkeep block and the refinement directive.

Naming upstream vocabulary couples Ensemblr's prompt to Claude Code's wording,
and that is the trade taken deliberately: a block that says "your runtime's own
sub-agent tool" leaves the model to work out which instruction is being
overridden, which is the inference the block exists to remove. The repository
already carries this coupling and already survives its churn —
`NATIVE_SUBAGENT_TOOLS` names both `Agent` and `Task` because the tool was
renamed in v2.1.63.

**2. Three variants, because the answer inverts.** A root on `ensemblr` is told
its runtime's tool is denied and which ops replaced it; a root on `native` is
told its workflow's fan-out is correct here and the standing line does not govern
it; an investigator is told it holds neither mechanism and submits no plan. A
single hedged wording would be wrong for two of the three.

**3. `readTurnPreamble` only — not `getSessionBrief`.** That is Pi's channel, and
Pi already receives the plan-mode playbooks. `readTurnPreamble` is wired only for
`NATIVE_MCP_PROVIDERS` (`{'claude'}`), so the block lands on exactly the runtime
with the problem and costs Pi nothing. A parity test asserts the shipped
extension carries no copy of the header.

**4. Close the native `ExitPlanMode` hole.** The bridge takes an `isSubAgent`
collaborator, resolved from the durable marker rather than lineage depth so a
child that survived a restart is still refused, and drops a sub-agent's
submission with a warn.

**5. Read the marker when pinning the mechanism, too.** `resolveDelegation`
takes an `isSpawnedSubAgent` reader alongside `parentSessionId`, so a marked
session pins to `ensemblr` whether or not its lineage survived. One reader in
`main.ts` now answers this question for all three consumers — the env overlay's
playbook, the mechanism, and the plan bridge — because a session those three
disagree about is a session whose prompt and whose deny list describe different
apps.

**6. The Concierge is refused on its role, not on the caller's gate.**
`buildPlanModeDelegationDirective` returns null for `role: 'concierge'`. It is
reached through a plan-mode gate that a panel never trips, but that is a fact
about the registry rather than about this function: `originHasChatTab` reads
*species*, which a Concierge shares with the chat it spawns, so nothing in the
type or the predicate would have stopped a Concierge being handed the root
block — which points at `ensemblr_exit_plan_mode`, an op it is denied.

## Consequences

The prompt grows by one block on planning turns only, and only for Claude. The
directive states what was already true of a correctly-pinned session; decision 5
is what makes the sub-agent variant true of a resumed one.

The turn preamble resolves the caller's role once and cuts both the delegation
and linked-issue blocks from it, rather than resolving it per block. That role
read is a SQLite lookup on the chat tab, and it runs on every turn of every
directly-prompted session.

**The general rule this makes explicit:** when a directly-prompted runtime
carries harness text that contradicts Ensemblr, Ensemblr answers it in the
per-turn preamble, in the harness's own words. The playbooks cannot do it — they
are fixed at session open — and enforcement alone cannot either, because a denied
tool that the model was told to call reads as a broken app rather than a settled
question.

**What this does not cover.** The standing `AgentTool` line reaches non-planning
turns too, where it can also suppress `ensemblr_start_conversation`. Left alone:
outside Plan Mode `ORCHESTRATOR_AWARENESS` already says to do the work yourself
by default, so the two broadly agree and the cost of a permanent block outweighs
a latent conflict.

**Upstream churn is the maintenance cost.** If Claude Code renames `Explore`,
drops the standing line, or changes where the plan file goes, the directive names
something that is no longer there. That is visible in the tests, which assert on
the literal terms.
