# Jev Decision Layer (Proposal)

> **Status:** Rejected after Phase 0, 2026-09-20. The measured spike failed every go/no-go
> gate. None of F1-F5 has been built.
>
> **One-line summary:** this proposal would have used Jev, TypeSafe's fast classification
> model, for a few narrow, typed orchestration decisions when the user added a TypeSafe API
> key. Model selection would have been behind a toggle; the other features would have run
> automatically and fallen back to today's behaviour whenever Jev was missing, slow, or
> unsure.

## What Jev is, and what it is not

Jev (`jev-1.13.0`) is TypeSafe AI's "System One" model. It does not write text. It takes a text
or JSON `state` plus typed questions and returns typed answers with calibrated probabilities:

| Primitive | Returns | Used here for |
| --- | --- | --- |
| Choice | `choice`, `probabilities`, `confidence` | role, question category |
| Score | `score`, `probabilities`, `confidence` | difficulty, reversibility |
| Noul | `noul` (probability of yes, 0 to 1) | yes/no report flags, duplicate check |

The limits that shape this design, taken from TypeSafe's own docs:

- 32k tokens for `state` plus the longest question, and 64k for the whole request. Choice
  answers are capped at 255 options.
- It cannot generate text. It reads instructions literally. It is weak at counting, dates,
  and reasoning that takes several steps.
- Text written to steer it can move its answers. The docs say it "does not treat [state] as
  hostile".
- It is most accurate in English. Ensemblr also ships Russian and Greek, and agents reply in
  the app language.
- Price: $0.042 per million input tokens, output free. Latency is 70–500 ms. Rate limits are
  1,200 requests/min and 250k tokens/s, and "can change without notice".
- Launched in early access on 2026-09-15. Zero data retention is enterprise-only.

It follows that Jev never replaces the agent that asks, briefs, or reviews. It answers one
kind of question well: **what kind of thing is this?** It is a poor fit for **what is the
right answer?**

## The combined list

| # | Decision | Mode | Hook | Phase |
| --- | --- | --- | --- | --- |
| F1 | Pick the model and thinking level for a spawned child | **Toggle** | `resolveForSpawn` | 2 |
| F2 | Sort an `ask_user_question` by who should answer it | Automatic | `askUserQuestion` gate | 3 |
| F3 | Flag child reports (open questions, failed checks, blocked, repeated findings) | Automatic | `waitForAgents` result | 3 |
| F4 | Warn before an agent creates a duplicate Linear issue | Automatic | `createIssue` port | 4 |
| F5 | Rank the decisions an AFK run made for the user, riskiest first | Automatic | AFK final turn | 4 |
| F6 | Suggest a skill for each turn | Deferred | the runtime adapters | not in this proposal |

Never handed to Jev:

- **Permission gating.** This includes the AFK confirm skip in `gatePermission` in
  `src/main/agent-control/agent-control-service.ts`.
- **The Plan Mode bash guard** in `src/shared/plan-mode/`.
- **Frontier-tier cost approval**, **naming and summaries**, and **diff review**.

Each of these is either a security boundary, which text written to steer Jev can move, or a
generation task, which Jev cannot do.

## Principles

1. **Fail open.** Each hook gets `null` when Jev is unavailable: no key, a timeout, a 429, a
   5xx, a response that fails validation, or confidence under the feature's floor. On `null`
   the hook does exactly what it does today. Jev can never block an agent.
2. **Code keeps control.** Jev classifies and code decides. Thresholds, ladders, and fallbacks
   are named constants in code, following TypeSafe's own guidance to put arithmetic and policy
   in code.
3. **Anything explicit wins.** A `model`, `thinkingLevel`, or role that the caller named is
   never overridden.
4. **No new authority.** Jev's output never widens a permission, skips a confirm, or reaches the
   frontier tier.
5. **Store no raw text.** The decision log keeps a hash of the input, never the input itself.

## Architecture

### New main-process concern: `src/main/typesafe/`

This is concern-first, like `src/main/infisical/`. The public surface goes through
`src/main/typesafe/index.ts`.

- `typesafe-client.ts` is a hand-written REST client for `POST /v1/systemone` and
  `GET /v1/models`. It has no SDK dependency, the same stance ADR 0051 took for Infisical:
  `@typesafe-ai/sdk` was first published on 2026-09-12 and covers one endpoint. Responses are
  parsed with Zod because they cross a trust boundary. Each call carries an `AbortSignal`
  timeout, and the model is pinned with `JEV_MODEL = 'jev-1.13.0'` rather than the moving
  `jev-latest` alias.
- `typesafe-key-store.ts` keeps the API key in the platform secret store (`src/main/secrets/`:
  Keychain on macOS, `safeStorage` on Linux) with `scope: 'app'` under key
  `typesafe-api-key`. The key never goes into `config.json`.
- `jev-service.ts` is a deep module with one method per feature and a small interface:
  `pickSpawnProfile`, `triageQuestions`, `triageReport`, `findDuplicateIssues`,
  `rankDecisions`. Each returns a typed result or `null`. A circuit breaker skips all calls for
  60 s after 3 failures in a row.
- `jev-questions.ts` holds the instructions and criteria each feature sends, as versioned
  English constants. They are agent-facing prose, so they stay English per
  `.claude/rules/i18n.md`.
- `jev-decision-log.ts` records each decision through a new repository,
  `src/main/storage/repositories/jev-decision-repository.ts`. Each row holds the feature, a
  hash of the input, the answers, probabilities, confidence, model version, latency, and
  whether the answer was acted on. It needs a new numbered migration in
  `src/main/storage/database.ts` (currently at version 32), asserted in
  `tests/main/database.test.ts`. The table is capped at 5,000 rows so it cannot grow without
  bound the way the event log did in the 2026-09-12 audit. It exists for three things:
  answering "why did it pick that?", tuning thresholds, and replaying evaluations.

Agent-control adds no capability code of its own. The ports call `jev-service`, and policy
lives in the ports, the same pattern `src/main/agent-control/linear-ports.ts` follows.

### Settings

- **Key:** a new row under Settings → Integrations,
  `src/renderer/components/settings/integrations/typesafe-connection-row.tsx`, beside the
  Linear and Infisical rows. It lets the user paste a key, test it against `GET /v1/models`,
  and remove it. The row also states exactly what gets sent (see [Data sent](#data-sent)). It
  needs the four-file IPC path: `src/shared/ipc/channels.ts`,
  `src/shared/ipc/contracts/typesafe.ts`, `src/main/ipc/request-schemas/typesafe.ts`, and
  `src/main/ipc/handlers/typesafe.ts`, then the preload bridge.
- **Toggle:** `models.jevModelSelection` (boolean, default `false`). It goes in
  `modelSettingsSchema` in `src/shared/config.ts` and is mirrored in
  `schemas/config.schema.json`, which `tests/main/published-schemas.test.ts` checks for drift.
  It also needs a line in the settings prose in `src/shared/agent-control/awareness.ts`
  (the "Editable preferences" block). The UI is
  `src/renderer/components/settings/models/jev-model-selection-row.tsx`, placed inside
  `model-orchestration-settings.tsx`. It is disabled until a key exists, and it shows a notice
  when no model has a role assigned (see F1).
- **Everything else** turns on when a key is present. There is no toggle per feature.
- **i18n:** new strings ship in en, ru, and el. `Jev` and `TypeSafe` are proper nouns, and both
  need rows in `docs/i18n-glossary.md`.

## Feature designs

### F1: Model and thinking-level selection (toggle)

**Why it is gated:** it changes what a spawn costs and which model does the work. The other
features only add information.

**Hook:** `resolveForSpawn` in `src/main/agent-providers/spawn-model-resolver.ts`, called from
`src/main/agent-control/port-adapters.ts:854`. It gets two new inputs: `brief` (the spawn
prompt) and a `pickSpawnProfile` collaborator.

**Runs when:** the toggle is on, a key is present, and the caller left out `model`,
`thinkingLevel`, or both. Whatever the caller named stays as named.

**Jev call** (one request, state = the brief):

- `role`: a Choice over `sage | coder | builder | grunt | explorer`. The criteria are the role
  definitions already in `src/shared/agent-control/awareness.ts`.
- `difficulty`: a Score over four levels. 0 = mechanical, one obvious shape. 1 = ordinary
  implementation or reading. 2 = design, diagnosis, or review someone will rely on.
  3 = genuinely hard.

**Code maps the answers onto a model.** Jev never sees model ids, because to it they are opaque
strings, and the tier (`standard | frontier` in `src/shared/agent-model-tier.ts`) cannot tell
Haiku from Opus.

1. Start from the candidates `listModelsFor(callerRuntime)` returns, minus hidden models, minus
   every `frontier`-tier model (settled decision 3), and minus Codex Spark. Spark is only
   described in prose today (`SPARK_MODEL_GUIDANCE`), so it needs a real id match.
2. Keep the candidates the user has assigned the chosen `role` to. If the caller's own model is
   one of them, use it. Otherwise take the first in the user's assignment order.
3. If no candidate carries that role, keep the caller's model. That is today's inheritance,
   even when the caller runs on a frontier model: the caller chose that model, Jev did not.
   Jev then only sets the thinking level.
4. The thinking level is `difficulty` mapped onto the chosen model's own `thinkingLevels`
   ladder: 0 → the lowest rung above `off`, 1 → the middle, 2 → the second-highest, 3 → the
   top. Level 3 applies only at confidence ≥ 0.8; below that it is capped at the
   second-highest rung.

**Fallback:** if role confidence is below 0.5, or Jev returns `null`, the spawn resolves
exactly as it does today.

**Visibility:**
- The spawn result gains `selection: { by: 'jev', role, difficulty, confidence }`, so the
  orchestrator can see what happened.
- The decision log records it.
- When the toggle is on, the awareness prose changes to: "omit `model`/`thinkingLevel`, name
  the role in the brief; Ensemblr picks. Name a model only when the user asked for one."

**Prerequisite:** role assignments (Settings → Models). Without them F1 can only set thinking
levels, and the settings row says so.

### F2: Question triage (automatic)

**Hook:** the `askUserQuestion` dispatch in `src/main/agent-control/agent-control-service.ts`,
before `gateAfkMode`.

**Jev call:** one Choice per question in the questionnaire (at most 4), all in one request.
The state holds the question and its options. The categories are:

- `user-preference`: taste or priorities only the user holds
- `needs-user-authority`: publish, delete, pay, or touch something outside the workspace
- `answerable-from-context`: the code, docs, or repository conventions settle it
- `ambiguous-requirement`: the request itself is underspecified

**Policy** (a pure function in `src/shared/`, so it can be tested without Jev):

| Mode | Result | Action |
| --- | --- | --- |
| Attended | Every question `answerable-from-context` at confidence ≥ 0.85 | Bounce once: return unanswered, telling the agent to decide it and record the assumption. The same question asked again in that session goes through to the user. |
| Attended | Anything else | Show the questionnaire, as today |
| AFK | Any question `needs-user-authority` at ≥ 0.6 | A hard-block denial: do the independent parts, stop, report |
| AFK | Anything else | Today's denial: decide, record the assumption |

The AFK denial is currently a static map in `src/shared/afk-mode/control-ops.ts`, which a
parity test holds to `src/shared/agent-control/afk-directive.ts`. It becomes a pure function
of `(op, category | null)`, and the parity test learns the second denial text. The threshold
for a hard block is deliberately low, because a stop that turns out to be wrong costs less
than an action taken without authority.

### F3: Report triage (automatic)

**Hook:** where `WaitedAgent` rows are built for `waitForAgents` in
`src/main/agent-control/agent-control-service.ts` (around lines 3240–3269). The Jev calls for
all settled children run concurrently.

**Jev call** (state = the child's final message; if it is over budget, send the head and the
tail). Four Nouls:
- Does it leave questions for the orchestrator unanswered?
- Does it report a check, test, or build that failed or was not run?
- Does it say the child could not proceed?
- Does it claim the brief is complete?

When the same child reports again after a `send_follow_up`, a fifth Noul is added, with state
`{ previous, current }`: "Does the current report repeat findings already in the previous
one?" This is the check for review rounds circling the same findings. It keeps one previous
report per child session in memory.

**Output:** `WaitedAgent.triage: { openQuestions, checksFailed, blocked, claimsComplete,
repeatsPrevious? } | null`, plus a one-line `note` when a flag is ≥ 0.8. It is only a note:
it does not change how waits wake up, and it does not invent signals. Orchestrators are still
told to read the report.

### F4: Linear duplicate check (automatic)

**Hook:** `createIssue` in `src/main/agent-control/linear-ports.ts`, after `createIssueRefusal`.

**Flow:**
1. Search the same team using keywords from the title and take the top 10 candidates.
2. Ask one Noul per candidate, with state `{ proposed, candidate }`: "Do these describe the same
   work?"
3. If any candidate scores ≥ 0.85, refuse with `status: 'possible-duplicate'` and list those
   ids.
4. The agent can retry with the new argument `allowDuplicate: true`. That argument touches the
   Zod schema, `TOOL_DEFS`, and `docs/agent-control.md`.

If Jev is unavailable, the check fails open and the issue is created as today.

### F5: AFK decision ranking (automatic)

**Contract change:** `SetSummaryArgs` gains an optional `decisions: string[]`, one entry per
decision made on the user's behalf. The AFK REPORT prose in
`src/shared/agent-control/afk-workflow.ts` requires it. A structured field is used rather than
parsing a heading, because agents write in the app language and a translated heading cannot be
matched reliably.

**Jev call:** for each decision, one Score `reversibility` (0 = trivially undone, 1 = takes
work, 2 = hard to undo) and one Noul: "Would a careful reviewer want this changed?"

**Surface:**
- In the chat tab, a "Review these first" list that code sorts by objection × reversibility.
- The AFK completion notification body gets a count ("3 decisions, 1 flagged"), added to
  `src/main/agent-runtime/notification-strings.ts` in en, ru, and el.

### F6: Skill suggestion (deferred)

TypeSafe's cookbook reports that suggested skills cut wrong skill loads from 16.8% to 7.3% on
Haiku 4.5. But the harnesses own skill loading. Doing this would mean injecting a
system-prompt line every turn in both `src/main/claude-agent/` and `src/main/pi-agent/`, and
nobody has measured the gain on the models Ensemblr orchestrators run on. Revisit once
F1–F3 have shipped and have a measured record.

## Data sent

This is what leaves the machine, and the settings row lists it word for word:

- spawn briefs (F1)
- `ask_user_question` questions and options (F2)
- children's final reports (F3)
- the title and description of a proposed Linear issue, plus candidate issues (F4)
- the decision bullets from AFK runs (F5)

It never sends file contents, diffs, terminal output, environment variables, or secrets.

## Phases and estimates

| Phase | Scope | Estimate |
| --- | --- | --- |
| 0 | Spike in `.context/`: replay real briefs, questions, and reports from `agent_session_events`, hand-label about 40 of each, and measure accuracy against confidence. **Go/no-go gate.** | 2–3 h |
| 1 | Foundation: the `src/main/typesafe/` concern, key store, settings row, IPC, decision log and migration, i18n | ~1 day |
| 2 | F1 behind the toggle, plus the prose switch in the awareness text | ~1 day |
| 3 | F2 and F3 | 1–1.5 days |
| 4 | F4 and F5, including the `setSummary` contract change and the tab surface | ~1.5 days |

The implementation was estimated at about 5 days if the spike passed.

### Phase 0 result (2026-09-20)

Phase 0 is a **no-go**. Production implementation stopped at this gate.

The rebuilt harness read the local event log in read-only mode and redacted secrets before
writing or sending any text. It extracted the proposed 152 spawn briefs, 86
`ask_user_question` questions, and 190 child reports. The evaluation used all briefs and
questions plus 60 reports enriched for uncommon flags. Opus 5 labelled the question and
report samples independently. The disposable harness, redacted dataset, labels, and raw
results remain under the ignored `.context/jev/` directory.

The run made 298 requests to pinned model `jev-1.13.0`. It used 424,380 input tokens and
22,562 output tokens, costing about $0.018. Median latency was 301 ms; p95 was 547 ms, and the
slowest request took 994 ms.

| Check | Required | Measured |
| --- | ---: | ---: |
| F1 role accuracy | >= 0.85 | 0.586 |
| F1 role macro-F1 | >= 0.85 | 0.469 |
| F1 high-confidence precision | >= 0.95 | 0.689 |
| F1 difficulty rank correlation | >= 0.50 | 0.497 |
| F2 certain-label macro-F1 | >= 0.80 | 0.433 |
| F2 automatic-bounce precision | >= 0.95 | 0.167 |
| F2 authority recall at 0.60 | >= 0.95 | 0.267 |

F2 also had a dataset problem: 29 of 86 labels were uncertain, and none of the certain labels
was `answerable-from-context`. Jev nevertheless chose that category for 23 certain examples,
which accounts for much of the poor bounce precision. The sample cannot establish a safe
threshold for the automatic bounce.

F3 failed its per-flag gate too:

| Flag | F1 | Precision | Recall | ECE |
| --- | ---: | ---: | ---: | ---: |
| Open questions | 0.742 | 0.605 | 0.958 | 0.208 |
| Checks failed | 0.778 | 0.778 | 0.778 | 0.063 |
| Checks not run | 0.842 | 0.857 | 0.828 | 0.114 |
| Blocked | 0.333 | 1.000 | 0.200 | 0.044 |
| Claims complete | 0.681 | 1.000 | 0.517 | 0.558 |

All 60 sampled reports claimed completion, and none had a previous report, so the sample could
not test `claimsComplete` as a discriminating label or test `repeatsPrevious` at all. The
remaining flags still missed the required F1, precision, or calibration bounds.

No TypeSafe service, key storage, decision log, settings UI, or F1-F5 hook should be built from
this proposal. A revisit needs a new design, a representative F2 set containing certain
`answerable-from-context` examples, report pairs for the repetition check, and a fresh spike
against a newer model or materially different questions.

## Planned testing (not implemented)

- The pure policy functions (F2's table, F1's mapping from difficulty to rung, the F3 and F4
  thresholds) get Vitest tests under `tests/shared/`.
- The service and ports get `tests/main/` tests with a fake client covering the timeout, 429,
  breaker, and validation-failure paths. Every one must show today's behaviour unchanged.
- `tests/main/published-schemas.test.ts` (settings key), `tests/main/database.test.ts`
  (migration), and the AFK tests `tests/shared/afk-directive.test.ts` and
  `tests/main/afk-mode-control-gate.test.ts`.
- `npm run check`, `npm run typecheck`, and `npm run i18n:status`.

## Settled decisions

The user settled these on 2026-09-19:

1. **F2 when the user is present: bounce once.** A question Jev is confident is answerable
   from context goes back to the agent once. Asking it again reaches the user. Jev never
   blocks the user from seeing a question an agent asks a second time.
2. **F1: explicit choices win.** Jev picks only when the caller left out `model` or
   `thinkingLevel`. With the toggle on, the awareness prose tells orchestrators to leave them
   out unless the user asked for a specific model.
3. **F1: Jev never picks a frontier model.** Frontier-tier models are removed from the
   candidates. Only an explicit pick reaches them, through the existing frontier confirm.
4. **Languages: one set of thresholds.** Russian and Greek use the same thresholds as English.
   The Phase 0 spike measures them separately and adjusts only if the numbers call for it.

## Sources

- TypeSafe docs: [Introduction](https://docs.typesafe.ai/introduction),
  [Models](https://docs.typesafe.ai/models), [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13),
  [Confidence](https://docs.typesafe.ai/confidence), [Intent routing](https://docs.typesafe.ai/patterns/intent-routing),
  [Skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion),
  [Legal](https://docs.typesafe.ai/legal)
- [Launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev), 2026-09-15
