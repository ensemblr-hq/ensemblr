# 0044. Enforce Plan Mode Fail-Closed at the Control Channel

Date: 2026-08-08

## Status

Accepted

Relates to [0040](0040-use-loopback-control-server-for-agent-app-control.md)
(loopback control server),
[0016](0016-use-workspace-trusted-local-execution.md) (workspace permission
modes) and [0042](0042-add-claude-code-as-a-second-first-class-agent-runtime.md)
(Claude Code as a second runtime), whose §3 treats Plan Mode as a given without
the decision ever having been recorded.

## Context

Plan Mode is a per-chat toggle (⌥⇧P, `composer.togglePlanMode`) that holds an
agent to planning until the user approves what it proposes. ADR 0042 §3 already
leans on it — "Ensemblr synthesises plan mode and control tools for Pi because
stock Pi has neither" — and records that Claude uses its own. The decision that
sentence refers to was never written down. This ADR is that record.

Stock Pi has no plan mode. The cheap version is a prompt: tell the agent not to
edit files. That is advisory, and it degrades in exactly the situations where it
matters. A model can decide the instruction has been superseded; a compaction can
drop it; a stale session summary can contradict it. Anything worth calling a mode
has to be enforced somewhere the model cannot reach.

Two enforcement points existed, and neither is sufficient alone.

Pi's extension API exposes a `tool_call` hook, so the shipped extension can
intercept `bash`, `edit`, and `write`. But the same extension registers
Ensemblr's own control tools, and among them are ones that open a real terminal,
launch another coding agent, and start a child conversation. Each is an
unguarded route straight back to editing the repository, and none of them passes
through a Pi built-in tool. Guarding Pi's tools while leaving `ensemblr_*` open
is a lock on the front door of a house with the back door removed.

Meanwhile the classifier is security-sensitive and the extension is a standalone
`.mts` file Pi loads with `pi --mode rpc -e <file>`. It cannot import from
`src/` at runtime. A second copy of a deny-by-default allowlist, maintained by
hand in a shipped resource, is a parity failure with a date on it.

## Decision

### 1. One classifier in `src/shared/plan-mode/`, reached over the control channel

Policy lives in `shared/` behind the `src/shared/plan-mode.ts` barrel:
`bash-guard.ts` (the read-only command allowlist), `shell-lexer.ts` (the
quote-aware lexer it runs on), `tool-guard.ts` (the Pi tool classifier),
`control-ops.ts` (the `ensemblr_*` policy), and `block-reason.ts` (the closing
sentence every denial shares, so the two gates hand the model one way out rather
than two near-identical strings that drift).

**The extension carries no policy.** Its `tool_call` hook forwards the call to
the app as a `checkPlanModeTool` control op and applies the verdict it gets back.
The one thing embedded in the extension is `PLAN_MODE_GUARDED_TOOLS` — the set of
tool names worth forwarding at all — and a parity test asserts the embedded copy
matches `src/shared/plan-mode/tool-guard.ts`.

That set (`bash`, `edit`, `write`) MUST name every built-in Pi tool that can
mutate the repository. One left off is neither blocked in the app nor forwarded
by the extension, so it bypasses Plan Mode silently rather than failing loudly.
Adding a Pi mutation tool means editing both copies in the same change.

The hook asks per call rather than caching a per-turn answer. The user can
approve a plan mid-turn, and a stale "not planning" cache would let the agent
edit files it had just been told not to.

### 2. The hook fails closed

An unanswered control channel blocks the call:

```ts
if (!result.ok) {
 return {
  block: true,
  reason: `Ensemblr could not confirm whether Plan Mode is on (…), so this tool call was blocked. Retry, or tell the user the app is unreachable.`,
 };
}
```

This is the whole reason the split in §1 is safe. Reaching across a process
boundary for every guarded tool call introduces a failure mode that a local copy
would not have; failing closed converts that failure mode from "silently
unenforced" into "visibly unavailable", which is the trade a security gate should
make.

**The prompt path deliberately fails the other way.** `fetchSessionBrief` reports
"not planning, nothing outstanding" when the control channel is unreachable,
because the playbook text is cosmetic and enforcement does not depend on it.
Failing closed there would break ordinary turns to protect nothing.

### 3. `bash` is a deny-by-default allowlist over a lexed command

Splitting the command on whitespace misread quoted paths, and blanking
`>/dev/null` by string replace let `>/dev/nullx` through as a discard — a hole in
a gate whose entire value is that it denies by default. `shell-lexer.ts` follows
bash on what quotes and spacing actually do, and rejects the constructs that
reach past the command they name.

Allowlisting command *names* is not enough either, because an allowlisted
read-only tool can still be an arbitrary-execution primitive through a flag. `fd
-x/--exec/-X/--exec-batch`, `rg --pre/--hostname-bin`, `find -exec`, and `date
-s` all route through one flag guard. `git -c`, `--config-env`, and `--exec-path`
are denied outright rather than skipped along with their values, because
`diff.external`, `core.fsmonitor`, `core.pager`, and `diff.<driver>.textconv`
each name a program git runs during an otherwise inspecting subcommand —
invisible to a classifier that only reads tokens. `git branch` is denied a bare
name and the flags that reset, retarget, or rename a ref, while its listing forms
still pass.

**A leading `FOO=bar` is denied outright, with no safe-list.** Stripping the
assignments to reach the head word read `GIT_EXTERNAL_DIFF='sh -c …' git diff` as
`git diff`, and the program it names runs during that inspecting subcommand.
`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_COUNT`, `GIT_SSH_COMMAND` and `GIT_PAGER` do the
same, and `PATH` and `LD_PRELOAD` redirect the binary itself — so an assignment is
`env` without the word, and `env` was already denied. There is no allowed subset
to enumerate: the deny side is unbounded across every allowlisted binary, so
`LC_ALL=C sort` loses too and the reason tells the agent to re-run without it.

**A flag is matched in every spelling its command accepts**, because matching the
whole token missed three of them. Short options cluster and take their value
attached, so `sort -no /tmp/out` and `sort -o/tmp/out` both wrote a file past a
guard that only knew `-o`; and both git's parse-options and getopt_long accept
any unambiguous truncation, so `sort --out=` wrote one and `git branch
--unset-upst` retargeted a ref. The guard therefore splits `--flag=value` at the
`=`, prefix-matches an abbreviation against the canonical long name, and scans a
single-dash token letter by letter.

The corresponding false-positive discipline matters as much — a guard that blocks
reading is a guard users turn off — and the letter-by-letter scan is what put it
under pressure, because an attached value is letters too: `git status -uno`,
`git log -S<term>` and `date -Iseconds` are all read-only commands carrying a
guarded letter inside a value. Two rules keep them readable rather than a
whole-token match that reopens the holes above:

- **Each guard's flag set is scoped to the command that really has that flag.**
  `-o/--output` is guarded on `sort` and `tree`, where it writes; `grep -o` and
  `rg -o` mean `--only-matching` and are not guarded at all; and git's own
  output guard is **long-only**, because git has no short output flag anywhere —
  `git diff -o` answers `invalid option`, and `-O<file>` is an orderfile it
  reads. A set with no short flag in it cannot trip the cluster scan.
- **`FlagGuard.valueLetters` names the short letters of one command that consume
  their value attached**, stopping the scan where the value starts: `-t`/`-e` on
  `fd`, `-I`/`-P` on `tree`, and `-I`/`-d`/`-f`/`-r`/`-v` on `date`. Its two
  directions are not symmetric — **a letter left out over-blocks a read-only
  command, a letter wrongly added under-blocks a writing one** — so the bar for
  adding one is evidence, never a false positive somebody wanted quiet.

  The table holds two grades of that evidence and the JSDoc says which is which,
  because a rule with a silent exception is worse than one that names it. The
  `fd` and `date` letters were **measured** against the installed binaries, and
  that measurement is read per platform as well as per command, because Linux is
  a first-class target here rather than a port: `date -d` is GNU-only, so a table
  written against macOS alone denies `date -dyesterday` on the platform where it
  is the working spelling, while `-v` is BSD-only and the `-s` it could otherwise
  have hidden does not exist on that binary at all. The `tree` letters rest on
  the **documented interface alone**, because tree is not installed on the
  machines this was written on — a weaker bar, taken because both are
  unambiguous in every tree manual and `-o` is the only letter `tree` guards.

### 4. Agent-control ops are gated by op and role, as a pure function

`createAgentControlService` gates every op through
`planModeControlOpDenial(op, role)` before it dispatches, and returns
`denied-scope` with the model-facing reason.

`PLAN_MODE_BLOCKED_OPS` — denied to every planning caller, whatever its role:

| Op | Why it cannot be made safe |
| --- | --- |
| `launchHarness` | starts a coding agent with no Plan Mode of its own, launched with approval prompts skipped |
| `startTerminal` | a raw shell the read-only command rules cannot see into |
| `writeTerminal` | runs arbitrary commands in that shell |
| `resolveDiffComments` | marks a review finding fixed, and nothing has been fixed while `write` and `edit` are blocked |

The first three are the "back door" from the Context section. `resolveDiffComments`
is a different kind of hazard — it does not touch the repository, it lies about
it, telling the user a change landed that does not exist. Reading and *adding*
diff comments stay available: annotating a diff is planning output.

`PLAN_MODE_SUBAGENT_BLOCKED_OPS` — additionally denied to a planning sub-agent:
`startConversation`, `sendFollowUp`, `exitPlanMode`, `askUserQuestion`. All four
belong to the orchestrator that spawned it and is blocked waiting on its report.
Their reasons deliberately bypass the shared escape hatch, which tells a caller
to finish the plan and call `ensemblr_exit_plan_mode` — for a sub-agent that
names a tool which is itself denied, and would send it round the same loop.

`PLAN_MODE_CONDITIONAL_OPS` (`sendFollowUp`, `startConversation`) exists so that
absence from the blocked map reads as a decision rather than as an oversight, and
an exhaustive table in `tests/main/plan-mode-op-policy.test.ts` fails the suite
until each newly added op is classified. **A spawn-shaped op cannot default to
allowed.**

`planModeFollowUpDenial(targetPlanning)` covers the case the op and role cannot
answer: a planning orchestrator may follow up only on a conversation that is
itself planning, so delegation cannot be laundered into an edit through an
unrestricted conversation.

Every one of these decisions takes its inputs as arguments and reads no session
state. That is what lets a parity test cross-check the playbook prose in
`src/shared/agent-control/awareness.ts` against the functions, so the tools an
agent is *told* are blocked and the ops actually refused cannot disagree.

### 5. Sub-agents inherit Plan Mode; role comes from a persisted marker

The original decision (#184) blocked `startConversation` outright, because a
spawned conversation was never registered as planning and would run unrestricted.
# 191 made inheritance real — `startConversation` passes
`planMode: isPlanning(origin)` to the child — which is what moved the op into the
conditional set for an orchestrator while leaving it denied for a sub-agent. A
planning orchestrator can now fan out read-only investigators.

Role resolution reads a marker persisted on the child's chat tab
(`src/main/agent-control/sub-agent-marker.ts`), **not live lineage**.
`parentSessionId` is never stored, so a session resumed after a restart
re-registers at depth 0 while its Plan Mode comes back from the renderer's
per-tab store. Lineage alone would hand a restored investigator the orchestrator
policy and let it submit a plan into a tab nobody is watching. The env overlay
that selects a playbook reads the same marker, so the prose an agent is given and
the ops it may reach come from one source.

### 6. The app writes the plan file, so Plan Mode never punches a hole in its own `write` block

`ensemblr_exit_plan_mode` takes the plan as a tool argument, and
`src/main/plan-mode/plan-file-writer.ts` writes
`<workspaceCwd>/.context/plans/<YYYYMMDD-HHmm>-<slug>.md` on the first submission.
Refinements update that original file, even if the title changes or the app
restarts. The generated frontmatter's `agentSessionId` and `workspaceId` identify
the conversation's document; its filename and `createdAt` stay fixed. Existing
legacy duplicates are left alone except for the earliest matching document,
which receives subsequent refinements. New conversations get distinct files.
Refinements replace the file only after the new contents have been written to a
temporary file, preserving the previous plan when writing fails.

The alternative — let the agent write its own plan out — requires an exception in
the `write` block, and an exception in a deny-by-default gate is the thing most
likely to be widened later by someone who does not know why it is there. Having
the app own the write removes the need for one.

### 7. Exit does not block, and the app posts the plan into the timeline

`createPlanSubmission` (`src/main/plan-mode/exit-plan-mode.ts`) saves the plan,
posts it, broadcasts the review panel, and returns immediately — which aborts the
turn.

**Not blocking is deliberate.** A blocking call would park the turn with the
agent still "working", pushing the plan out of the last-message slot. Instead,
the pending review disables the composer and its send pipeline until the user
chooses Approve, Refine, or Hand off. The decision bar remains active; Refine
unlocks the existing draft, and Hand off keeps the lock until a new chat is
successfully created. The decision reaches the agent as its next prompt, not as
the tool result.

**The app posts the plan from `args.plan`** rather than relying on the agent to
print it first. The turn ends the moment the tool returns, so an agent that
called the tool before narrating got aborted before the plan text existed —
roughly half the time the user was left with a review panel for a plan that never
appeared. `appendAgentMessage` persists a synthetic agent/text event and
broadcasts it through the same sink as a runtime message (mirroring
`setSessionName`), so it renders as a normal assistant bubble and survives
reload with no renderer change. The playbook correspondingly tells the agent to
hand the plan to the tool and *not* also write it as its reply.

With no window open, submission still saves and posts, and tells the agent to
stop rather than reporting a success the user never saw.

### 8. The plan-mode playbook replaces the role playbook; it does not stack on it

Plan Mode first appended its playbook to the orchestrator or sub-agent one, so a
planning turn carried "do the work yourself by default", the whole
delegate-wait-integrate protocol, and the spawn tools listed as available,
directly above "implement nothing, those tools are blocked". Agents resolved the
contradiction by inventing a source for it: one fabricated a
`<session_state source="compaction">` tag naming an implement mode, then spent
the turn reconciling a conflict that had no origin outside its own output.

`PLAN_MODE_ORCHESTRATOR_AWARENESS` and `PLAN_MODE_SUBAGENT_AWARENESS` each
*replace* the matching role variant. Each is self-contained: its own headline, an
inventory of only what survives the guard, the blocked control ops named tool by
tool, and a precedence paragraph stating that stale summaries and anything
resembling session state describe how the agent behaves once Plan Mode is off.

### 9. The registry is in-memory; the renderer owns the durable toggle

`createPlanModeRegistry` holds a `Set<string>` of planning session ids, written
by the IPC layer on open and submit and read by the control layer. The renderer's
per-chat `atomWithStorage` toggle is the durable source and re-sends `planMode`
on every open and submit, so a restart rebuilds the map from the next prompt
rather than from a database migration.

## Consequences

- **Claude Code uses its own tool gate but the same control-op gate.** Per ADR
  0042 §3, Claude runs `permissionMode: 'plan'` with its native `ExitPlanMode`
  tool, and `PLAN_MODE_GUARDED_TOOLS` — a list of *Pi* tool names — is not
  applied to it. The §4 control-op policy is runtime-neutral and does apply:
  `planModeRegistry.setActive` is called from the provider-neutral
  `src/main/ipc/handlers/agent-session.ts`, so a planning Claude session is
  refused `startTerminal`, `launchHarness`, and the rest on the same terms.
- **The control channel became load-bearing for safety, not just capability.**
  ADR 0040 introduced the loopback server as the route for agent→app control. The
  fail-closed hook makes it a dependency of correctness: with the server
  unreachable, a planning Pi session cannot run `bash`, `edit`, or `write` at all.
  That is the intended behaviour, and it is a stronger coupling than ADR 0040
  contemplated.
- **The bash guard is a maintained allowlist, and allowlists rot.** Every new
  read-only tool someone wants to use while planning is a change to
  `bash-guard.ts`, and every allowlisted tool that later grows an exec flag is a
  silent hole until someone notices. `tests/shared/plan-mode-bash-guard.test.ts`
  and `plan-mode-shell-lexer.test.ts` carry the regression cases; the flag-guard
  entries for `fd`, `rg`, `find`, and `date` are there because each was found
  after the fact, as are the assignment denial, the clustered and abbreviated
  flag spellings, and `uniq <in> <out>`.
- **The ALLOWED list is load-bearing, not decoration.** Every tightening of the
  matcher has cost read-only commands on the way past — the letter-by-letter scan
  took `git status -uno`, `git log -S<term>` and `date -Iseconds` with it before
  the two rules above went in — and only a command written down as allowed makes
  that visible. Add the read-only forms a change nearly broke, not just the
  writing form it set out to catch.
- **Nothing about planning state is persisted server-side.** No table, no
  migration, no column. The cost is that main's view of who is planning is only
  as good as the renderer's next message; the benefit is that a toggle the user
  flips cannot get stuck on in a database.
- **The plan review surface moved into the composer** (#218): the decision bar
  renders as the composer's header, divided from the textarea by a hairline,
  rather than floating above the footer as a separate panel.
- **Two files must change together, forever.** `PLAN_MODE_GUARDED_TOOLS` in
  `src/shared/plan-mode/tool-guard.ts` and its copy in
  `resources/pi-extensions/ensemblr-control.mts`. The parity test is the only
  thing that makes this survivable; do not remove it to unblock a change.
