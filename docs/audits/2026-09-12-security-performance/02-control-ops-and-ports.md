# Per-op authorization in the agent-control service and its ports

Covers every `AgentControlOp` after the origin is resolved: the four dispatch gates in
`src/main/agent-control/agent-control-service.ts`, the audience model in
`src/shared/agent-control/subagent-policy.ts`, the Zod boundary in
`src/shared/agent-control/schemas.ts`, and the port layer (`ports.ts`, `port-adapters.ts`,
`linear-ports.ts`, `review-ports.ts`, `architecture-ports.ts`, `payload-fit.ts`,
`started-terminals.ts`, `board-status-store.ts`).

The scope model itself is in good shape: every write that names a foreign `workspaceId`,
`chatTabId`, `terminalId`, or `agentSessionId` is checked against the caller's workspace and
fails closed on an unresolvable id. The headline finding is elsewhere — **the workspace
permission mode the user sets in Settings → Repo → Security is written at repository scope and
read at app scope, so `read-only` and `approval-required` never reach any gate in the main
process.** Two further defects follow: sub-agents hold the two architecture-diagram ops their
own playbook tells them are refused, and the `waitForAgents` poll loop pays a ~500 ms
synchronous full-branch scan per target per 250 ms tick for a value it discards.

Overall posture: the *policy* layer is unusually well-factored (pure functions, fail-closed
defaults, denial reasons that name the alternative). The defects are in the *wiring* around it —
one setting resolved at the wrong scope, one prose rule with no table entry, one hot path
calling a projection built for a renderer surface.

## Op × audience table

Derived by running `subAgentControlOpDenial`, `conciergeControlOpDenial`,
`planModeControlOpDenial`, `CONCIERGE_ONLY_OPS`, `isWriteOp` and `argKeysForOp` over
`AGENT_CONTROL_OPS` (script under `/tmp`, not committed). `y` = may call.

- **root** = depth-0 orchestrator · **d1** = depth-1 manager sub-agent · **d2** = depth-2 leaf
- **harness** = harness terminal (no chat tab) · **conc** = Concierge
- **plan(r)** / **plan(s)** = permitted while Plan Mode is active, for a root / a sub-agent
- Every op is Zod-validated: `AGENT_CONTROL_ARG_SCHEMAS` is `satisfies Record<AgentControlOp, z.ZodType>`
  (`src/shared/agent-control/schemas.ts:549`), so a missing schema is a compile error.
- Peer roots and Review conversations are depth-0 roots (`spawnedChildRole`,
  `src/shared/agent-control/awareness.ts:1361`) and read as the **root** column, except that a
  Review session is additionally refused `startReview` — see [CO-05].

| op(s) | write | root | d1 | d2 | harness | conc | plan(r) | plan(s) | foreign-workspace write |
|---|---|---|---|---|---|---|---|---|---|
| spawnChatTab | y | y | — | — | y | — | y | y | no |
| startConversation | y | y | y | — | y | y | y | — | **conc only**, via `workspaceId` |
| sendFollowUp | y | y | y | — | y | y | y | — | **conc only** |
| closeTab | y | y | y | — | y | y | y | y | **conc only** |
| startReview | y | y | — | — | y | — | — | — | no |
| setName, setSummary | y | y | y | y | — | — | y | y | no (own session) |
| setBranchName | y | y | — | — | y | — | y | y | no |
| getArchitectureDiagram | — | y | y¹ | y¹ | y | — | y | y | no |
| updateArchitectureDiagram | y | y | y¹ | y¹ | y | — | — | — | no |
| launchHarness, startTerminal, writeTerminal | y | y | — | — | y | — | — | — | no |
| stopTerminal | y | y | — | — | y | — | y | y | no |
| openTab | y | y | — | — | y | — | y | y | no (but see [CO-04]) |
| focusTab, focusDockTab, focusPanel | y | y | y | y | y | y | y | y | **conc only** |
| focusWorkspace, createWorkspace, listProjects, getAppSettings | y/— | — | — | — | — | y | y | y | conc-only ops |
| recallMemory | — | — | — | — | — | y | y | y | conc-only op |
| updateAppSettings | y | — | — | — | — | y | y | y | app-level, conc-only |
| setWorkspaceStatus | y | y | — | — | y | y | y | y | **conc only** |
| getWorkspaceStatus, getWorkspaceDiff, getDiffComments | — | y | y | y | y | y | y | y | no (refused cross-ws) |
| addDiffComments | y | y | y | y | y | y | y | y | **conc only** |
| resolveDiffComments | y | y | y | y | y | y | — | — | **conc only** |
| linearListIssues, linearGetIssue, linearGetMetadata | — | y | y | y | y | y | y | y | app-level (no workspace) |
| linearCreateComment | y | y | — | — | y | y | y | y | app-level |
| linearCreateIssue, linearUpdateIssue | y | y | — | — | y | y | — | — | app-level |
| listWorkspaces, listTabs, listTerminals | — | y | y | y | y | y | y | y | read, spans all |
| getConversationStatus, getLastMessage, readConversation | — | y | y | y | y | y | y | y | **read, spans all, unchecked id** |
| readTerminalOutput | — | y | y | y | y | y | y | y | no (id scope-checked) |
| listModels, waitForAgents | — | y | y | — | y | y | y | y | n/a |
| listRunScripts | — | y | (unusable) | (unusable) | y | — | y | y | no |
| notifyOrchestrator | — | y | y | y | y | — | y | y | no |
| messageConcierge | y | y | — | — | y | — | y | y | app-level |
| askUserQuestion | — | y | — | — | — | y | y | — | no |
| getSessionBrief, checkPlanModeTool | — | y | y | y | y | y | y | y | no |
| exitPlanMode | — | y | — | — | — | — | y | — | **writes `.context/plans/` — see [CO-06]** |

¹ The playbook says otherwise. See [CO-02].

**Permission mode column, omitted above because it is uniform and that is the bug:** every op
resolves to exactly one of three `PermissionActionKind`s — `app-settings-change` for
`updateAppSettings`, `app-control-write` for the 28 ops in `WRITE_OPS`, `app-control-read` for
everything else (`agent-control-service.ts:1167-1176`). Reads are allowed in every mode; writes
are blocked under `read-only` and confirmed under `approval-required`; `app-settings-change` is
in `SENSITIVE_ACTIONS` and is therefore *always* `confirmation-required`, never blocked. All of
which is correct — and none of which fires, because of [CO-01].

## Findings

### [CO-01] The repository permission mode is written at repository scope and read at app scope, so `read-only` and `approval-required` never gate anything

- Severity: **High**
- Confidence: **Confirmed**
- Where:
  - `src/main/main.ts:1544` — the only producer of the mode every gate reads:

    ```ts
    /** Reads the currently resolved permission mode that gates control ops. */
    getPermissionMode: () =>
        readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
    ```
  - `src/main/ipc/permission-gate.ts:109` — it reads `snapshot.app.settings.find(e => e.key === 'security.permissionMode')`
  - `src/main/config/config-resolution.ts:199` — `resolve()` with no `repository` argument never builds `snapshot.repository` at all (`if (repository) { … }`)
  - `src/main/environment/repository-settings.ts:32` — where the UI's value actually lands: `const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };`
  - `src/renderer/routing/routes/_workbench/settings/repo/$repoId/security.tsx:42` — the only UI that sets the mode
- What: `security.permissionMode` exists in both resolution scopes (`config-resolution.ts:515` and `:115`). The app scope is fed by `config.json`'s `security` section (`:810`) and by SQLite rows written with `scope='app', scope_id=''` (`:180`). The only surface that lets a user choose a mode is the per-repository Security panel, and `upsertRepositorySettings` stores it with `scope='repository'`. Nothing in `src/main` ever calls `settingsResolutionService.resolve({ repository })` and reads the mode off the result — `grep readPermissionModeFromSnapshot src/main` returns three call sites (`main.ts:961`, `main.ts:1544`, `ipc/handlers.ts:270`) and all three pass no repository. The repository row is written, displayed back with its `source` badge, and never consulted.
- Scenario: the user opens an unfamiliar repository and sets **Read only** in Settings → Repo → Security, whose own copy promises "Applies to every workspace of the repo, and to the tools agents reach over the control server." An agent in that workspace then calls `ensemblr_write_terminal`, `ensemblr_start_terminal`, `ensemblr_add_diff_comments`, `ensemblr_set_branch_name`, or `ensemblr_linear_update_issue`. `gatePermission` reads `getMode()`, gets the app-scope value — for anyone who has not hand-edited `~/.config/ensemblr/config.json`, the built-in `workspace-trusted` — classifies `app-control-write` as `allowed`, and the write lands. The same stale mode is handed to the Claude Code SDK session (`main.ts:961`) and to the IPC permission gate (`ipc/handlers.ts:270`), so the setting is inert on all three surfaces.
- Existing guards/tests checked: `tests/main/agent-control-service.test.ts:242` injects the port directly (`permissions: { getMode: () => overrides.mode ?? 'workspace-trusted' }`) and exercises every mode against the gate — the gate logic is well covered and correct. `tests/main/config-resolution.test.ts:326` asserts the key resolves in the *repository* scope. Neither touches the wiring between them: `grep -rn readPermissionModeFromSnapshot tests/` returns nothing, so no test observes which snapshot the production producer reads. `tests/main/permissions.test.ts` covers `classifyPermissionAction` in isolation. The defect sits exactly in the seam all three stop short of.
- Fix: make the producer repository-aware. `getPermissionMode` needs a workspace (or repository) argument so it can call `resolve({ repository: … })` and read `snapshot.repository` with `snapshot.app` as fallback — the control layer already holds `origin.workspaceId` at every call site, and `ports.permissions.getMode()` is a one-line signature change. Failing that, mirror the repository row into the app scope on write. Either way add a test driving the real `readPermissionModeFromSnapshot` against a repository-scoped SQLite row, since that missing assertion is what let this through.


### [CO-02] Sub-agents hold both architecture-diagram ops, which their own playbook tells them are refused

- Severity: **Medium**
- Confidence: **Confirmed** (executed `subAgentControlOpDenial` and `withheldControlOps` against
  the real modules; both return "allowed" at depth 1 and depth 2)
- Where:
  - `src/shared/agent-control/subagent-policy.ts:34` — `SUBAGENT_BLOCKED_OPS` lists 21 ops and
    omits `getArchitectureDiagram` / `updateArchitectureDiagram`
  - `src/shared/agent-control/awareness.ts:398` — the leaf playbook, shipped to the model:

    ```
    The rest of the surface is not yours and is refused here … moving the kanban board,
    naming the workspace and branch, reading or redrawing the architecture diagram,
    commenting on or moving a Linear issue … all belong to your immediate parent.
    ```
  - `src/shared/agent-control/awareness.ts:409` — the depth-1 manager playbook says the same
    (`…, read or redraw the architecture diagram`. Those remain with the root.)
  - `src/main/agent-control/agent-control-service.ts:1110` — `gateSubAgentRole` consults only
    `subAgentControlOpDenial`, so a null denial dispatches
- What: the architecture ops are gated on exactly one axis — the `experimental.architectureDiagram`
  feature switch (`ARCHITECTURE_DIAGRAM_OPS`, `subagent-policy.ts`) — and on no role axis at all.
  With the feature on, both ops are present in a sub-agent's MCP tool list
  (`withheldControlOps` returns a set containing neither) and both dispatch successfully.
  `updateArchitectureDiagram` replaces the whole tracked document at
  `.ensemblr/architecture.json` (`architecture-ports.ts:425`, `storeRefinedIr`) — there is no
  patch op, so a partial redraw silently deletes every component the caller did not re-send.
- Scenario: a root orchestrator fans out four leaf sub-agents over one workspace. Each leaf's
  playbook tells it the diagram belongs to its parent, but each leaf's tool list offers
  `ensemblr_update_architecture_diagram`. One leaf decides its area of the codebase is
  mis-drawn, reads the diagram, and stores a corrected version scoped to what it looked at. The
  other three components vanish from the user's tracked diff, attributed to no one — and the
  parent, which is blocked in `waitForAgents`, never sees the call.
- Existing guards/tests checked: `tests/main/agent-control-awareness-parity.test.ts:1290`
  (`backs the sub-agent playbook's promises with a real denial`) is the test designed to catch
  exactly this, and it checks a hand-picked list of five ops — `startConversation`,
  `launchHarness`, `writeTerminal`, `setWorkspaceStatus`, `askUserQuestion` — rather than every
  clause of the sentence it quotes. The architecture clause is never cross-checked.
  `tests/main/architecture-control-port.test.ts` covers the port's own validation and scoping
  (both correct), not who may call it. `tests/main/agent-control-doc-parity.test.ts:163` derives
  an audience label from `subAgentControlOpDenial`, so it inherits the same gap rather than
  detecting it.
- Fix: decide which side is right and make the other match. If the playbooks are right, add both
  ops to `SUBAGENT_BLOCKED_OPS` with reasons in the style of the existing entries (the
  `setWorkspaceStatus` entry is the closest analogue — "describes the whole workspace, not the one
  unit of work you were handed"); `withheldControlOps` and `gateSubAgentRole` then need no change.
  If a sub-agent should keep the *read*, block only `updateArchitectureDiagram` and drop
  "reading or" from both playbook sentences. Either way, widen the parity test to iterate the
  clause list rather than a five-op sample.

### [CO-03] `waitForAgents` pays a ~500 ms synchronous full-branch scan per target per 250 ms tick, for a value it then discards

- Severity: **High** (performance)
- Confidence: **Confirmed** (traced end to end; measured against the real
  `~/Library/Application Support/dev.ensemblr.app/ensemblr.db`)
- Where:
  - `src/main/agent-control/agent-control-service.ts:3201` — the poll interval
    (`WAIT_POLL_MS = 250`, `:333`), running until `guardrails.waitTimeoutMs` (300 000 ms,
    `guardrails.ts:41`)
  - `src/main/agent-control/agent-control-service.ts:3089` — `settleTarget` calls
    `ports.conversations.getStatus(agentSessionId)` for every target, every tick
  - `src/main/agent-control/port-adapters.ts:914` — the adapter, which uses four of the
    snapshot's fields and throws the rest away:

    ```ts
    getStatus: async (agentSessionId) => {
        const snapshot = deps.agentSessionService.getSession(agentSessionId);
        if (!snapshot) { return null; }
        return {
            agentSessionId: snapshot.id,
            contextUsage: deps.agentSessionService.getContextUsage(agentSessionId),
            status: snapshot.status,
            runtimeOpen: snapshot.runtimeOpen,
        };
    },
    ```
  - `src/main/agent-runtime/agent-session-service.ts:402` — `getSession` runs
    `projectSessionActivity`
  - `src/main/agent-runtime/session/session-activity-snapshot.ts:181` — which, whenever the live
    reading is absent or invalid, falls through to `readLastRecordedContextUsage`, a descending
    scan that `JSON.parse`s every payload until it meets a `context-usage` event
- What: `projectSessionActivity` is a renderer-facing projection — it computes
  `contextUsage`, `activityOrdinal`, `currentTools` (a second descending scan) and `lineage` (a
  recursive parent walk). The control adapter needs none of them: it reads `status` and
  `runtimeOpen` off the row, and takes `contextUsage` from `getContextUsage`, whose own JSDoc
  says it "serves from memory, so the agent-control wait loop can call it per target per tick."
  The cheap call was optimised; the expensive one sitting one line above it was not. `node:sqlite`
  is `DatabaseSync`, so all of this is synchronous on the Electron main thread.
- Scenario: measured on this machine's real database — 462 branches, the largest 26 922 events.
  On the eight largest branches the newest `context-usage` event sits 10 000–26 000 ordinals
  below the head, so the scan walks essentially the whole log. Timed on the largest branch:

  ```
  scanned 25111 rows, found at ordinal 1811, 496.1 ms
  ```

  An orchestrator that calls `ensemblr_wait_for_agents` (or `send_follow_up` with `wait: true`)
  on a long-lived session whose runtime has not reported a live context reading therefore asks
  the main thread for ~500 ms of blocking work every 250 ms. The loop cannot keep up with its own
  interval: the main process is saturated for the whole wait, every pending IPC reply is stalled
  behind it, and the window reads as frozen — for up to the full 5-minute wait window, multiplied
  by the number of targets and by the number of agents waiting concurrently.
- Existing guards/tests checked: `tests/main/agent-control-wait.test.ts` drives the loop through
  an injected `scheduler` and a stub conversations port, so it measures the state machine and
  never reaches `getSession`. `tests/main/agent-control-port-adapters.test.ts` covers the adapter
  against a fake session service. Nothing benchmarks the projection, and nothing asserts which
  fields `getStatus` actually consumes.
- Fix: give the session service a narrow status read — id, `status`, `runtimeOpen` off the row —
  and point `getStatus` at it instead of `getSession`. That drops the tick to a single indexed
  `getAgentSessionById`. Independently worth fixing at the source: `readLastRecordedContextUsage`
  should bound its descending scan (a few hundred ordinals, or a `WHERE event_type` predicate so
  SQLite does the filtering instead of JavaScript), since any caller that lands on a branch with
  no recent reading pays the full walk.

### [CO-04] `openTab` accepts any `filePath`, and the preview resolver is allowed outside the workspace

- Severity: **Low**
- Confidence: **Likely** (the unvalidated argument and the permissive resolver are both confirmed; I did not trace the renderer IPC call that joins tab metadata to the preview read — that file set is another dimension's)
- Where:
  - `src/shared/agent-control/schemas.ts:185` — the one path-taking op that skips the shared validator:

    ```ts
    const openTabSchema = z
        .strictObject({
            variant: z.enum(['file', 'diff', 'comment']),
            filePath: nonEmpty.optional(),
    ```
  - `src/shared/agent-control/schemas.ts:341`, `:363` — `getWorkspaceDiff` and `addDiffComments` both use `workspaceRelativePath`, which rejects absolute paths, drive letters, NUL and any `..` segment (`staysInsideWorkspace`, `:39`)
  - `src/main/agent-control/port-adapters.ts:508` — the adapter writes `filePath` into tab metadata with no resolution or containment check
  - `src/main/workspace-files/workspace-paths.ts:106` — `resolvePreviewPath` expands `~`, accepts absolute paths, and reports anything outside the workspace as `scope: 'external'` rather than refusing it
- What: the preview resolver is deliberately permissive, and its JSDoc argues correctly that "the agent already reads the whole disk through its own tools." That argument covers the agent reading a file; it does not cover the agent choosing what the *user's* file viewer displays. The tab title is the basename alone (`fileTabTitle`), so a tab opened on `~/.ssh/id_rsa` is labelled `id_rsa` and sits in the workspace's own tab strip.
- Scenario: a prompt-injected root orchestrator calls `ensemblr_open_tab` with `variant: 'file'`, `filePath: '~/.aws/credentials'`. A tab titled `credentials` opens in the user's workspace rendering a file unrelated to the repository. This is UI spoofing and unexpected data display, not exfiltration — the agent gains no bytes it could not already `cat` — which is why it is Low. The residual risk is that the user is shown something they did not ask for, in a surface implying workspace provenance.
- Existing guards/tests checked: sub-agents and the Concierge are both denied `openTab` (`SUBAGENT_BLOCKED_OPS`, `CONCIERGE_BLOCKED_OPS`), so only a root reaches it; it is in `WRITE_OPS`, so `read-only` would block it were [CO-01] fixed; `reserveSpawnGuard` bounds how many it can open. `isWithinWorkspaceReal` (`workspace-paths.ts:150`) does realpath containment but guards the attachment store, not the preview.
- Fix: validate `filePath` as the neighbouring diff ops already do — swap `nonEmpty` for `workspaceRelativePath` in `openTabSchema`. If opening a `/tmp` or `~/.claude/` artefact the agent just wrote is intended, keep the allowance but carry `resolvePreviewPath`'s `scope: 'external'` into the tab metadata and title the tab with the absolute path rather than the basename.

### [CO-05] A Review session regains `startReview` after a restart, because the "you are the review" guard is in-memory only

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/agent-control/agent-control-service.ts:2077`

  ```ts
  if (openedReviewSessions.has(origin.sessionId)) {
      return fail('denied-scope', 'You are the review. …');
  }
  ```
  populated at `:1994` (`openedReviewSessions.add(started.agentSessionId)`), a plain in-process
  `Set`; `reviewsByCaller` at `:1993` is the same.
- What: a Review conversation is opened as a **root orchestrator** (`asPeer: true`), so none of
  the sub-agent denials apply to it; the only thing stopping a reviewer from opening its own
  reviewer is this Set. The Set does not survive a process restart, and a resumed Review session
  re-registers an origin with no memory of having been opened as one. This is precisely the
  failure mode `subagent-policy.ts`'s own header describes for lineage depth — "a session resumed
  after a restart re-registers with no parent, reads as depth 0, and regains every spawn op" —
  which was fixed there by moving to the durable marker, and left unfixed here.
- Scenario: the user quits and reopens Ensemblr with a Review conversation still in the strip,
  then sends it a follow-up. It calls `ensemblr_start_review`, the Set is empty, and a second
  reviewer opens over the same diff. Bounded by `PEER_ORCHESTRATOR_LIMITS` (2 attended, 4
  unattended, `contracts.ts:302`), so the worst case is one or two extra concurrent writers on a
  checkout that already tolerates peers — hence Low.
- Existing guards/tests checked: `tests/main/agent-control-start-review.test.ts` exercises the
  reuse path and the self-review refusal within one process lifetime; nothing simulates a
  restart. The co-tenancy cap (`reserveCoTenantSlot`, `:1489`) is the real backstop and it holds.
- Fix: derive "am I a review?" from something durable rather than a Set. The review session
  already gets a distinguishing prompt prefix (`buildReviewPeerDirective`) and a known tab title;
  a persisted flag on the agent-session row, or reusing the sub-agent-marker mechanism with a
  `review` kind, would survive a restart. The same change fixes `reviewsByCaller` (a caller's
  existing review is currently forgotten across a restart, so it opens a second one).

### [CO-06] `exitPlanMode` writes a file into the workspace while classified as a read, so it is permitted under `read-only`

- Severity: **Low**
- Confidence: **Confirmed**
- Where:
  - `src/shared/agent-control/contracts.ts:146` — the deliberate omission, with its reasoning:

    ```
    `exitPlanMode` writes a plan file yet is deliberately absent: it is the only
    exit from Plan Mode, so gating it would strand a planning agent with every
    editing tool denied and no way out. It is gated on active Plan Mode instead.
    ```
  - `src/main/agent-control/agent-control-service.ts:1167` — not being in `WRITE_OPS` means the
    action resolves to `app-control-read`, which `classifyPermissionAction` allows in *every*
    mode (`src/shared/permissions.ts:139`)
  - `src/main/plan-mode/plan-file-writer.ts:23` — the write target:
    `` const PLANS_SUBDIR = path.join('.context', 'plans'); `` under `<workspaceCwd>`
- What: the reasoning for keeping `exitPlanMode` out of `WRITE_OPS` is sound — the alternative
  is a planning agent with no exit — but the mechanism chosen makes it a *read*, which means it
  is not merely un-blocked under `read-only`, it is not even confirmed under
  `approval-required`. A workspace in `read-only` mode will still gain a new file on disk.
- Scenario: the user sets a repository to `read-only` and starts a conversation in Plan Mode. The
  agent submits its plan; the app writes
  `<workspace>/.context/plans/20260912-1430-<slug>.md`. Impact is genuinely small — the path is
  fixed, the filename is slugged and length-capped, `writeFile` uses `flag: 'wx'` so nothing is
  clobbered, and the content is the plan the user is about to read anyway. The defect is that the
  mode's contract is violated at all.
- Existing guards/tests checked: `handleExitPlanMode` (`:3337`) refuses a caller not actually in
  Plan Mode and a caller with no chat tab, so the op cannot be used as a general file-writing
  primitive. `tests/main/plan-mode-control-gate.test.ts` covers the plan-mode denial table.
  Nothing asserts what `exitPlanMode` costs under `read-only`.
- Fix: give it its own `PermissionActionKind` (say `plan-submission`) that
  `classifyPermissionAction` allows in `workspace-trusted` and `approval-required` and treats as
  `confirmation-required` — not `blocked` — under `read-only`. That keeps the "never strand a
  planning agent" property while making the write visible to the mode. A cheaper alternative: in
  `read-only`, exit Plan Mode without writing the file and return the plan in the envelope.

### [CO-07] The dispatch catch-all puts raw `Error.message` into the agent-visible envelope

- Severity: **Info**
- Confidence: **Confirmed**
- Where: `src/main/agent-control/agent-control-service.ts:3766`

    ```ts
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return fail('internal', `Control op failed: ${detail}`);
    }
    ```
- What: any unhandled throw from a port surfaces verbatim. Node `fs`, `node:sqlite` and `child_process` errors routinely embed absolute paths (`ENOENT: … open '/Users/<name>/Ensemblr/workspaces/<other-project>/…'`). Under the SECURITY.md model the agent already knows the home path, so this is disclosure of *other workspaces'* names and layout to an agent scoped to one — a nudge, not a breach.
- Scenario: an agent in workspace A triggers a port failure whose message names a path under workspace B, and learns of B's existence and location. No credential is reachable this way: the Linear ports map their own failures to a typed envelope (`linear-ports.ts:150`) rather than throwing, and no secret-store call sits behind a control op.
- Existing guards/tests checked: the control server caps request bodies and the deadline wrapper produces its own envelope, so this path is reached only by a genuine throw; most ports return failure envelopes rather than throwing, which is what keeps the blast radius small.
- Fix: log the full error main-side and return a generic `internal` message plus a correlation id, as the Linear ports already do for their own failures.


## Verified sound

Attack classes I specifically looked for and found correctly handled.

- **Every op is Zod-validated before any gate runs.** `AGENT_CONTROL_ARG_SCHEMAS` is `satisfies Record<AgentControlOp, z.ZodType>` (`schemas.ts:610`), so a schema-less op will not compile; every schema is `strictObject`, so unknown keys are rejected rather than dropped. `invoke` validates first (`agent-control-service.ts:3725`).
- **Foreign-id writes are refused, fail-closed.** `outOfScope` (`agent-control-service.ts:794`) returns `not-found` on an unresolvable id and `denied-scope` on another workspace's, and is applied to `sendFollowUp` (`:2384`), `closeTab` (`:2426`), `readTerminalOutput` (`:2534`), `stopTerminal` (`:2590`), `writeTerminal` (`:2623`), `focusTab` (`:2672`), `focusDockTab` (`:2702`), and `startConversation`'s `chatTabId` (`:1734`).
- **A workspace agent may not name another workspace, even as an argument.** `resolveTargetWorkspace` (`:1256`) refuses a non-own `workspaceId` for every non-Concierge, refuses a Concierge that names none, and refuses a `workspaceId` disagreeing with the named resource's owner rather than picking a winner.
- **`stopTerminal --close` cannot target a terminal the caller did not open.** Ownership check at `:2593` (`startedTerminals.wasStartedBy`); the `kind`-selector path that would bypass it is closed at the schema (`close` requires `terminalId`, `schemas.ts:172`). The 512-entry FIFO eviction (`started-terminals.ts:16`) fails toward refusing a legitimate close.
- **`startTerminal` cannot run an arbitrary command.** `scriptName` is a lookup key into the repository's configured run scripts and an unconfigured name fails rather than falling back (`script-lifecycle-service.ts:38`); the schema refuses `scriptName` on any kind but `run` (`schemas.ts:155`).
- **Linear's terminal-state refusal is on the state *type*, fetched from Linear, fail-closed.** `terminalStateRefusal` (`linear-ports.ts:429`) refuses any `completed`/`canceled` type and refuses equally when the id matches nothing or `type === null`; a state *name* is never accepted for an id. `createIssueRefusal` (`:506`) also refuses an unknown `teamId` and a state owned by another team (`:528`).
- **`linear_update_issue` cannot change what it should not.** The port passes exactly `{assigneeId, description, priority, stateId, title}` (`linear-ports.ts:949`) — no `teamId`, no `archivedAt`, no project/label mutation.
- **`linear_create_issue` is refused until a search happened this session** (`:2939`), and only an `ok` search clears it, so a `not-connected` answer does not (`:3626`). **No Linear token reaches a result payload** — results carry `accountId` and display names only.
- **Review-comment ids are scoped before the write.** `resolveComments` (`review-ports.ts:334`) classifies every id against the workspace's own comments, so a foreign id becomes `notFound` and never reaches `saveComment`. `addDiffComments`/`getWorkspaceDiff` validate `filePath` with `workspaceRelativePath` (`schemas.ts:341`, `:363`).
- **`updateArchitectureDiagram` cannot be aimed outside the caller's workspace** — the port takes `workspaceId` from `origin` only, with no path or workspace argument (`architecture-ports.ts:425`) — and refuses to overwrite a document this build cannot parse (`:377`).
- **Concierge-only ops are refused to everyone else, most of them twice.** `gateSubAgentRole` refuses `CONCIERGE_ONLY_OPS` before dispatch (`:1091`); `handleCreateWorkspace` (`:2836`), `handleListProjects` (`:2866`) and `handleRecallMemory` (`:2882`) re-check `origin.concierge` in the handler.
- **`updateAppSettings` cannot reach the permission mode.** `appSettingsControlPatchSchema` (`shared/config.ts:244`) is a nested `strictObject` enumerating each editable field; `security` is not a section and `onboarding` is excluded by type. The op re-checks Concierge liveness and retirement at `:2119`.
- **`planMode`/`afkMode` on a spawn are Concierge-only and enforced, not merely documented.** `spawnModeDenial` (`:1692`) refuses both from any non-Concierge; everything else inherits its parent's mode (`:1798`). The schema refuses the two together and refuses `afkMode` with `wait` (`schemas.ts:87`, `:96`).
- **`peer: true` is unreachable for a sub-agent and not assertable by a model alone.** `origin.depth > 0` refuses it outright (`:1755`); otherwise `gatePeerSpawn` (`:1625`) reserves a co-tenancy slot, refuses while planning, refuses while unattended rather than auto-approving, and requires a real confirmation dialog.
- **A depth-1 manager may steer only its own durable children.** `immediateChildDenial` (`:2346`) resolves the child list from a SQLite read keyed on the caller's session id, never from an argument, and is applied to `sendFollowUp` (`:2397`), `closeTab` (`:2431`) and every `waitForAgents` target (`:3239`).
- **The sub-agent role is durable and both axes fail closed together.** `resolveRole` (`:1025`) ORs the persisted marker with lineage depth (`awareness.ts:1378`), and `gateSubAgentRole` asks the policy as if `depth === 0` were a leaf (`:1110`) — a session whose in-memory lineage was lost gets the narrowest policy, not the widest.
- **Read results are payload-capped.** `getLastMessage` uses the lazy descending iterator and stops at `MAX_AGENT_PAYLOAD_CHARS` (`port-adapters.ts:1227`); `readConversation` caps per page and per field (`conversation-transcript.ts:100`); `getWorkspaceDiff` is budgeted and reports `omittedFiles`, reading per-file patches at concurrency 8 (`review-ports.ts:50`, `:251`).
- **The board mirror sanitises untrusted input on both sides.** `coerceStatus` (`board-status-store.ts:25`) drops anything outside `WORKSPACE_BOARD_STATUSES`, for the renderer's bulk report and an agent's single write alike.
- **Blocking ops are bounded.** Non-blocking ops get a 120 s deadline (`dispatch-deadline.ts:31`); the four that block by contract are bounded by `guardrails.waitTimeoutMs` instead, and the wait loop aborts without reporting when the calling turn ends (`:3186`), so a dead caller does not consume its children's escalation signals.

## Coverage

Read in full, or in the parts bearing on authorization:

- **Control layer:** `src/main/agent-control/agent-control-service.ts` (all 3 864 lines, op by op), `ports.ts`, `port-adapters.ts`, `linear-ports.ts`, `review-ports.ts`, `architecture-ports.ts`, `payload-fit.ts`, `started-terminals.ts`, `board-status-store.ts`, `dispatch-deadline.ts`
- **Shared contracts:** `src/shared/agent-control/{contracts,schemas,subagent-policy,conversation-transcript}.ts`, `awareness.ts` (role playbooks + `resolveAgentRole`), `src/shared/permissions.ts`
- **Permission wiring:** `src/main/ipc/permission-gate.ts`, `src/main/config/config-resolution.ts`, `src/main/environment/repository-settings.ts`, `src/main/main.ts`, `src/renderer/routing/routes/_workbench/settings/repo/$repoId/security.tsx`, `src/renderer/state/preferences/atoms.ts`
- **Supporting:** `src/main/workspace-files/workspace-paths.ts`, `src/main/plan-mode/plan-file-writer.ts`, `src/main/agent-runtime/agent-session-service.ts`, `src/main/agent-runtime/session/session-activity-snapshot.ts`, `src/main/storage/repositories/agent-event-repository.ts`, `SECURITY.md`, both published schemas
- **Tests read:** `tests/main/agent-control-{service,awareness-parity,doc-parity,wait,start-review,started-terminals}.test.ts`, `config-resolution.test.ts`, `permissions.test.ts` (indexes and the relevant assertions, not every case body)

Measurements ran against a read-only copy of `~/Library/Application Support/dev.ensemblr.app/ensemblr.db` in `/tmp`, since deleted. No repository file was modified; no test suite, typecheck, or app launch was run.

**Not reached:** `ask-user-question.ts`, `review-launch.ts`, `review-focus.ts`, `review-brief-fallback.ts` and `workspace-linked-issue.ts` were read only far enough to confirm they take no caller-supplied workspace or path argument — their internals are unaudited. `guardrails.ts` fork-bomb accounting, `origin-registry.ts` and `control-server.ts` belong to the sibling transport/identity audit and I took its findings as given. I did not audit `gateFrontierModelSpawn` or the memory-recall port beyond its scope check.

## Open questions

1. **[CO-01] — is the permission mode meant to be per repository or app-wide?** The UI, the
   settings-resolution service, the published `settings.schema.json` story and SECURITY.md all
   say per repository; the entire main-process consumer side says app-wide. Fixing it toward
   "per repository" changes `getPermissionMode`'s signature and touches three call sites
   including the Claude SDK session mode; fixing it toward "app-wide" means moving the panel out
   of Settings → Repo and rewording SECURITY.md. I have assumed **per repository** is intended,
   since that is what three of the four sources and the user-facing copy say. Worth confirming
   before anyone writes the patch.
2. **[CO-02] — should a sub-agent be able to *read* the architecture diagram?** Blocking both ops
   matches the playbooks verbatim. Blocking only the write is the smaller change and arguably
   more useful — a leaf orienting itself in an unfamiliar codebase has a real use for the read.
   Either is defensible; the playbook prose has to move if you pick the second.
3. **Reads span workspaces; `readConversation` and `getLastMessage` take an unchecked
   `agentSessionId`.** That follows the stated policy ("reads may span all open workspaces") and
   I did not file it as a finding. But it does mean an agent in workspace A can read any other
   conversation's transcript — including the Concierge's, whose session id `messageConcierge`
   hands back in its result (`:3038`). Whether the Concierge transcript should be readable by a
   workspace agent is a policy call rather than a bug, so I have left it here rather than in
   Findings.
