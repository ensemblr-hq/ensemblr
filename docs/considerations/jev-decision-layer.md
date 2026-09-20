# Jev Decision Layer (Proposal)

> **Status:** Rejected after the corrected Phase 0 rerun, 2026-09-20. The original spike
> misused several Jev primitives and its result is withdrawn. The corrected run materially
> improved F1, but F2/F3 still do not support production use. None of F1-F5 has been built.
>
> **One-line summary:** this proposal would have used Jev, TypeSafe's fast classification
> model, for a few narrow, typed orchestration decisions when the user added a TypeSafe API
> key. Model selection would have been behind a toggle; the other features would have run
> automatically and fallen back to today's behaviour whenever Jev was missing, slow, or
> unsure.

## What Jev is, and what it is not

Jev (`jev-latest`; the earlier pinned `jev-1.13.0` is no longer requestable by id) is TypeSafe
AI's "System One" model. It does not write text. It takes a text or JSON `state` plus typed
questions and returns typed answers with calibrated probabilities:

| Primitive | Returns | Used here for |
| --- | --- | --- |
| Choice | `choice`, `probabilities`, `confidence` | role |
| Score | `score`, `probabilities`, `confidence` | difficulty, reversibility |
| Noul | `noul` (probability of yes, 0 to 1) | question dimensions, report flags, duplicate check |

The limits that shape this design, taken from TypeSafe's own docs:

- 32k tokens for `state` plus the longest question, and 64k for the whole request. Choice
  answers are capped at 255 options.
- It cannot generate text. It reads instructions literally. It is weak at counting, dates,
  and reasoning that takes several steps.
- Text written to steer it can move its answers. The docs say it "does not treat [state] as
  hostile".
- It is most accurate in English. Ensemblr also ships Russian and Greek, and agents reply in
  the app language.
- Price: $0.042 per million input tokens, output free. The docs advertise 70–500 ms latency,
  but the withdrawn v1 run observed p95 547 ms and a 994 ms maximum; the corrected harness did
  not retain latency. Rate limits are 1,200 requests/min and 250k tokens/s, and "can change
  without notice".
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
  timeout. Production would request the stable alias returned by `GET /v1/models`, record the
  concrete model version returned by every response, and stop if one run resolves to mixed
  versions. An exact version should be pinned only when TypeSafe exposes that id.
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

**Jev call:** one request per question in the questionnaire (at most 4), with five independent
Nouls sharing state `{ question, options }`:

- `needsUserAuthority`: acting would publish, delete, pay, or exercise other user-only authority
- `settledByRepository`: code, tests, tracked docs, or repository conventions settle it
- `isUserPreference`: valid outcomes remain and depend on taste or priorities
- `needsUserFact`: a private or physical-world fact is missing
- `isAmbiguousRequirement`: the request itself admits materially different meanings or scopes

These dimensions can overlap, so a Choice is the wrong primitive. Code combines the Nouls
into an action. An attended bounce requires `settledByRepository` above its threshold and all
four guard Nouls below theirs. AFK hard-blocks only when `needsUserAuthority` clears its own
threshold. The corrected spike did not find a deployable threshold set, so neither policy is
currently specified closely enough to build.

### F3: Report triage (automatic)

**Hook:** where `WaitedAgent` rows are built for `waitForAgents` in
`src/main/agent-control/agent-control-service.ts` (around lines 3240–3269). The Jev calls for
all settled children run concurrently.

**Jev call** (state = `{ current, previous }`; if a report is over budget, send its head and
tail). Five independent Nouls inspect `current`:

- Does it leave questions for the orchestrator unanswered?
- Does it report an executed check, test, or build that failed?
- Does it explicitly say a relevant check was not run, skipped, or unavailable?
- Does it say the child could not complete required work?
- Does it claim the assigned brief is complete?

When the same child reports again after a `send_follow_up`, a sixth Noul asks whether
`current` repeats `previous` without material new evidence or resolution. This is the check
for review rounds circling the same findings. It keeps one previous report per child session
in memory.

**Output:** `WaitedAgent.triage: { openQuestions, checksFailed, checksNotRun, blocked,
claimsComplete, repeatsPrevious? } | null`, plus a one-line `note` when a flag is ≥ 0.8. It is
only a note: it does not change how waits wake up, and it does not invent signals.
Orchestrators are still told to read the report.

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

It does not attach files, diffs, terminal sessions, environment variables, or secrets as
separate inputs. Briefs and child reports can themselves quote paths, code, diff details, or
terminal output, however, so the consent copy must disclose that transitive content rather
than promise it never leaves the machine.

## Phases and estimates

| Phase | Scope | Estimate |
| --- | --- | --- |
| 0 | Spike in `.context/`: extract 152 briefs, 126 questions, and 190 reports; independently label deterministic samples of 80/126/60+60; measure the predeclared gates. **Go/no-go gate.** | Completed |
| 1 | Foundation: the `src/main/typesafe/` concern, key store, settings row, IPC, decision log and migration, i18n | ~1 day |
| 2 | F1 behind the toggle, plus the prose switch in the awareness text | ~1 day |
| 3 | F2 and F3 | 1–1.5 days |
| 4 | F4 and F5, including the `setSummary` contract change and the tab surface | ~1.5 days |

The implementation was estimated at about 5 days if the spike passed.

### Corrected Phase 0 result (2026-09-20)

Phase 0 remains a **no-go for this production proposal**, but not for the reason the first run
claimed. The first result is withdrawn: it deleted 18 one-line F1 briefs, rounded Score before
rank correlation, treated overlapping F2 concepts as one Choice, measured the wrong bounce
predicate and authority threshold, calibrated F3 on an enriched sample at the wrong operating
point, and had a broken generic-secret redactor.

The repeatable process, private artifact manifest, exact commands, labelling protocol, and
future-model comparison rules are in [`jev-spike-runbook.md`](./jev-spike-runbook.md).

The corrected harness preserves brief text, uses independent labels, asks atomic questions with
structured criteria, batches same-state questions, separates representative and cue-enriched
F3 strata, and reports raw Score rank, exact-bin ECE, action predicates, class support, and
actual denominators. Missing support and missing report pairs are unmeasured, never silent
passes. Its evaluation path runs the leak guard immediately before the network call.

The gates were fixed before the final API run:

- F1 role accuracy and macro-F1 >= 0.85, accepted-decision accuracy at Choice confidence >=
  0.5 >= 0.95, and raw difficulty Spearman >= 0.50;
- F3 at threshold 0.8: F1 >= 0.75, precision >= 0.90, and ECE <= 0.10 for every flag; and
- any required unmeasured dimension makes the overall result no-go.

F2 intentionally has no production gate because its observed sample has no certain bounce
positive. The shared-threshold sweep below is only a one-dimensional diagnostic through a
five-threshold policy space; it cannot select production thresholds.

The final run evaluated 80 independently labelled briefs, all 126 F2 questions (86 observed
questionnaires plus 40 question-shaped fragments harvested from real agent reports as
counterfactual controls), and 102 unique reports (60 representative, 60 cue-enriched, 18 in
both) from a 152/126/190 extracted corpus. One clean-room Opus 5 pass labelled the initial
set; after F3 enrichment was tightened, a second pass preserved retained labels and labelled
18 new reports. Neither pass saw Jev answers. These are independent AI labels, not human
ground truth, and were not double-labelled or adjudicated. The F1 pass marked 58 of 80 labels
uncertain, mostly at coder/builder and difficulty boundaries. F2 retained 103 certain
rows. The database had no child branch with two completed turns, so `repeatsPrevious` remains
unmeasured.

The stable `jev-latest` alias was the only non-preview model exposed by `GET /v1/models`; the
old concrete id could no longer be requested directly. All 308 responses resolved to
`jev-1.13.0`, however, so the v1-to-v2 difference is not a model-version confound. The run used
605,621 input and 28,482 output tokens and cost about $0.025 at the documented input price.
The v2 harness did not record request latency.

#### F1

| Check | Required | Corrected |
| --- | ---: | ---: |
| Role accuracy | >= 0.85 | 0.838 (67/80; Wilson 95% CI 0.742–0.903) |
| Role macro-F1 | >= 0.85 | 0.625 |
| Accepted-decision accuracy at Choice confidence >= 0.5 | >= 0.95 | 0.880 (66/75) |
| Accepted-decision coverage | diagnostic | 0.938 (75/80) |
| Raw difficulty rank correlation | >= 0.50 | 0.811 |
| Rounded difficulty exact accuracy | diagnostic | 0.650 |
| Production difficulty action accuracy | diagnostic | 0.638 |

| Role | Support | F1 |
| --- | ---: | ---: |
| Sage | 1 | 0.000 |
| Coder | 16 | 0.609 |
| Builder | 20 | 0.766 |
| Grunt | 3 | 0.800 |
| Explorer | 40 | 0.952 |

This is materially stronger than the invalid first run, but no knife-edge pass is claimed. On
the 22 labels the Opus labeler considered certain, role accuracy was 0.955 and raw difficulty
correlation was 0.693; that subset had no Sage example. Jev found all 40 Explorers, 18 of 20
Builders, and only 7 of 16 Coders. Thirty-nine of the 40 Explorer briefs still contained
semantic role cues such as “read-only”, “no edits”, or “actionable plan” after the explicit
role token was withheld, so this measures role recovery from structured briefs rather than
classification of role-neutral tasks. An earlier unretained run over the same F1 request set
measured 0.850 role accuracy, 0.814 raw difficulty correlation, and 0.663 rounded difficulty
accuracy; the retained run measured 0.838, 0.811, and 0.650. That earlier artifact was overwritten, so this variance observation
is disclosed but is not reproducible and is not gate evidence.

#### F2

The five Nouls are not equally usable. `source` remained offline metadata and was not sent to
Jev. On the 103 certain rows:

| Noul | Positives | Precision @0.6 | Recall @0.6 | F1 @0.6 | ECE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Needs user authority | 13 | 0.692 | 0.692 | 0.692 | 0.173 |
| Settled by repository | 31 | 1.000 | 0.065 | 0.121 | 0.090 |
| User preference | 65 | 0.773 | 0.785 | 0.779 | 0.070 |
| Needs user fact | 9 | 0.875 | 0.778 | 0.824 | 0.156 |
| Ambiguous requirement | 7 | 0.038 | 0.143 | 0.061 | 0.396 |

The diagnostic shared-threshold predicate had 21 labelled positives. At 0.6 it fired twice,
with precision 0.500 and recall 0.048; at 0.7 and above it never fired. More importantly, all
21 positives came from counterfactual controls. The 69 certain observed
`ask_user_question` rows had no positive bounce case, so this production distribution cannot
measure bounce precision or calibrate separate Noul thresholds. The proposed authority
threshold of 0.6 also misses the 0.95 recall requirement.

#### F3

The production operating point is 0.8; calibration uses only the 60 representative reports.
The tightened enriched stratum increased support to 9 check-failure and 7 blocked positives,
but it is used only for rare-case recall.

| Flag | Representative positives | F1 @0.8 | Precision @0.8 | Recall @0.8 | ECE | Enriched positives | Enriched recall @0.8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Open questions | 23 | 0.821 | 1.000 | 0.696 | 0.114 | 24 | 0.917 |
| Checks failed | 6 | 0.444 | 0.667 | 0.333 | 0.123 | 9 | 0.333 |
| Checks not run | 27 | 0.897 | 0.839 | 0.963 | 0.204 | 37 | 0.973 |
| Blocked | 2 | 0.000 | no positive predictions | 0.000 | 0.082 | 7 | 0.000 |
| Claims complete | 57 | 0.519 | 1.000 | 0.351 | 0.440 | 53 | 0.302 |
| Repeats previous | 0 pairs | unmeasured | unmeasured | unmeasured | unmeasured | 0 pairs | unmeasured |

No F3 flag clears all three requirements. `claimsComplete` is worse than the always-true
baseline's F1 of 0.974, and `blocked` is worse than the always-true baseline's F1 of 0.065.
Repetition cannot be assessed from current history.

No TypeSafe service, key storage, decision log, settings UI, or hook should be built from this
proposal. F4/F5 were not measured; they remain blocked because the shared Phase 0 gate failed,
not because this spike produced evidence about them. A narrower future spike could revisit F1
after adjudicating the taxonomy, but automatic question bouncing needs representative
observed positives and F3 needs real follow-up pairs plus better boundaries.

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
