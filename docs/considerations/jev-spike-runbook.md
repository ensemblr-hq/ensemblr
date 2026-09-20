# Jev Spike Runbook

This runbook reproduces the Jev decision-layer spike against a newer Jev model. Read
[`jev-decision-layer.md`](./jev-decision-layer.md) first: that proposal defines the features,
boundaries, and current no-go decision.

> **Note (2026-09-21):** this runbook was written while the repository still carried
> `scripts/with-pinned-node.sh`. That wrapper is gone — Ensemblr now injects the workspace's
> login-shell `PATH` (mise-activated Node 24), so drop the `./scripts/with-pinned-node.sh`
> prefix from the commands below and run `node …` directly. See
> [ADR 0073](../adr/0073-move-the-package-manager-from-npm-to-bun.md).

The durable artifact is this method, not the private corpus. Spawn briefs, questionnaires, and
child reports may contain repository paths, code snippets, or terminal output, so the dataset,
labels, and raw responses stay ignored under `.context/jev/` with mode `0600`. Never commit or
paste them into an issue.

## What counts as a reproduction

There are two valid runs; do not compare them as though they were the same experiment.

1. **Model comparison:** reuse one frozen `dataset-*.json` and `gold-*.json`, change only
   `JEV_MODEL`, and write a new results file. This is the preferred way to test a newer Jev.
2. **Corpus refresh:** extract and label a new corpus before evaluating it. This tests current
   Ensemblr traffic, not model progress. Report it as a new baseline.

A bit-for-bit model comparison requires preserving the private dataset, gold labels, harness,
and their hashes outside an ephemeral workspace. If those artifacts are gone, only a corpus
refresh is possible.

## Official references to recheck

Read the current TypeSafe documentation before changing request shapes or selecting a model:

- <https://docs.typesafe.ai/introduction>
- <https://docs.typesafe.ai/concepts/state>
- <https://docs.typesafe.ai/concepts/how-to-build-with-system-one>
- <https://docs.typesafe.ai/primitives/choice>
- <https://docs.typesafe.ai/primitives/score>
- <https://docs.typesafe.ai/primitives/noul>
- <https://docs.typesafe.ai/primitives/advanced>
- <https://docs.typesafe.ai/confidence>
- <https://docs.typesafe.ai/api>
- the current Jev model-jaggedness page

The harness verifies the requested id against `GET /v1/models` before evaluation. Use the stable
model, not a preview, unless the experiment explicitly tests a preview. Record both the
requested alias and the concrete `model` returned by every `POST /v1/systemone` response. Stop
if one run resolves to more than one concrete model.

## Private artifacts

The v2 names are:

| Path | Purpose |
| --- | --- |
| `.context/jev/harness.mjs` | Read-only extractor, request builder, evaluator, and metric reporter |
| `.context/jev/dataset-v2.json` | Redacted frozen states and provenance metadata |
| `.context/jev/label-sample-v2.json` | Clean-room labelling input |
| `.context/jev/gold-v2.json` | Frozen independent labels |
| `.context/jev/results-v2.json` | Raw Jev answers plus computed report |
| `.context/jev/report-v2.json` | Report-only export |

The 2026-09-20 baseline hashes are:

```text
f94ca44230c3731290a77894a122383909443d51469985b95778ed8261f65c09  harness.mjs
eab0d8eeef0c09bc99e783b46eb70f58716437253d43aafdf2d4b141798b6cf4  dataset-v2.json
4b20be6add92c65bc8a96e80702d36a73c165f89f504e078056b912a104cbbe9  label-sample-v2.json
5adf345afcf9447958cac240c2ae1ac56f06b5aa6520a6dca252ffb5ad7eb77c  gold-v2.json
542678d507f844c835da4cd4cdc58f47fa12749d411cd275083538dd6b69e52b  results-v2.json
```

Verify them from the repository root with:

```bash
shasum -a 256 \
  .context/jev/harness.mjs \
  .context/jev/dataset-v2.json \
  .context/jev/label-sample-v2.json \
  .context/jev/gold-v2.json \
  .context/jev/results-v2.json
```

## Preflight

1. Work in an isolated Ensemblr workspace. Do not run against another workspace's checkout or
   database through Git overrides.
2. Put `TYPESAFE_API_KEY` in the ignored root `.env`. Never print it or write it into an
   artifact.
3. Use the repository-pinned Node runtime.
4. Set `umask 077` in the shell before creating any private artifact and keep it active through
   extraction, evaluation, and report redirection. Confirm every private data/result artifact
   is mode `0600`. The harness contains no private corpus or secret and may use the
   repository's normal source-file permissions.
5. Declare the model, corpus, gold set, action thresholds, gates, and unique output paths before
   the API call. Refuse an existing path; never overwrite prior evidence or tune a threshold on
   the rows later used to claim the gate passed.

Run the local checks:

```bash
./scripts/with-pinned-node.sh node --check .context/jev/harness.mjs
./scripts/with-pinned-node.sh node .context/jev/harness.mjs self-test
./scripts/with-pinned-node.sh node .context/jev/harness.mjs dry-run
```

`self-test` must prove generic secret assignments and URL credentials are redacted, surviving
secrets are rejected, role stripping preserves text, F1 states are non-empty, and each ECE row
lands in exactly one integer-indexed bin. `dry-run` prints request counts and an approximate
input-token cost without network access.

## Corpus refresh only

Skip this section for a model-only comparison.

The extractor opens
`~/Library/Application Support/dev.ensemblr.app/ensemblr.db` read-only and enables
`PRAGMA query_only`. It redacts before writing. The v2 corpus contains:

- 152 spawn briefs, with explicit role tokens replaced rather than deleting their lines;
- 86 observed `ask_user_question` questions plus 40 question-shaped fragments harvested from
  child reports as counterfactual controls; and
- 190 final child reports.

Sampling is deterministic SHA-256 ordering with fixed salts:

- F1: 80 independently labelled briefs;
- F2: all 126 rows; and
- F3: 60 representative reports plus 60 reports ranked by explicit blocked/check-failure/
  check-not-run/incomplete cues, deduplicated before labelling.

Run:

```bash
set -e
umask 077
corpus_id="$(date -u +%Y%m%dT%H%M%SZ)-$(
  ./scripts/with-pinned-node.sh node -e 'console.log(require("node:crypto").randomUUID())'
)"
dataset_path=".context/jev/dataset-${corpus_id}.json"
sample_path=".context/jev/label-sample-${corpus_id}.json"
if [ -e "$dataset_path" ] || [ -e "$sample_path" ]; then
  printf 'Refusing to overwrite an existing corpus artifact.\n' >&2
  exit 1
fi
./scripts/with-pinned-node.sh node .context/jev/harness.mjs extract \
  --out "$dataset_path" \
  --sample "$sample_path"
./scripts/with-pinned-node.sh node .context/jev/harness.mjs dry-run \
  --dataset "$dataset_path"
printf 'dataset=%s\nsample=%s\n' "$dataset_path" "$sample_path"
```

Review the generated controls manually. They are real report text but not observed
questionnaires, so they must never be presented as production-distribution positives. Record
representative/enriched overlap and per-flag support.

### Labelling protocol

Freeze labels before the Jev call.

- The labeler sees only the new label sample and the written rubric.
- It must not inspect old gold, old Jev results, historical role/thinking metadata, or model
  answers.
- F1 labels one role, difficulty 0–3, and an honest `certain` flag.
- F2 labels the five dimensions independently; several may be true.
- F3 labels each report flag independently. `checksNotRun` requires an explicit statement;
  `blocked` describes the reporting agent's assigned work, not a project it audited.
- Double-label and adjudicate disputed rows when the result will authorize production work.
  The v2 run used one Opus 5 clean-room pass, then a second pass to label 18 new reports after
  enrichment changed; retained labels were preserved rather than adjudicated. These labels are
  useful spike evidence rather than human ground truth.

Validate exact ids, order, schemas, booleans, enums, and `0600` permissions before evaluation.
Any unsupported class is `unmeasured`, never a zero silently included in a macro score.

## Request contract

Batch all questions that share one state into one System One request.

- **F1:** state `{ brief }`; one five-way role Choice with contrastive
  `what`/`not_for`/`examples`, plus one concrete-situation difficulty Score.
- **F2:** state `{ question, options }`; five independent Nouls. `source` is retained only as
  offline metadata and is never sent, because production `askUserQuestion` has one source.
- **F3:** state `{ current, previous }`; separate Nouls for open questions, checks failed,
  checks not run, blocked, and claims complete. Ask repeats-previous only when a real prior
  report exists.

The harness validates every response id, enum, score bound, and probability. It records the
concrete response model version and rejects a run that resolves to zero or multiple versions.
It retries only documented transient `429` and `529` responses. A timeout or other
HTTP failure aborts the run; a partial result file is not accepted.

## Gates and diagnostics

Declare gates before evaluation:

- F1 role accuracy and macro-F1: at least `0.85`.
- F1 accepted-decision accuracy where Choice confidence is at least `0.5`: at least `0.95`;
  report coverage separately.
- F1 raw Score Spearman correlation: at least `0.50`.
- F3 at the production threshold `0.8`: F1 at least `0.75`, precision at least `0.90`, and ECE
  at most `0.10` for every flag.
- Any required unmeasured dimension, including missing report pairs, makes the overall result
  no-go.

Also report Wilson intervals, per-class support, constant baselines, rounded difficulty, and
production difficulty after capping level 3 below Score confidence `0.8`. Choice confidence is
concentration over options, so call the gated metric accepted-decision accuracy, not
calibration or probability of correctness.

F2 currently has no valid production gate: the observed v2 questionnaires contain no certain
bounce-positive row. A future corpus must contain representative observed positives and use a
held-out set to select separate thresholds for `settledByRepository` and each guard Noul.
A one-threshold diagonal sweep is diagnostic only.

## Model-only rerun

Choose unique result and report paths before calling the API. This example includes both a UTC
timestamp and a UUID, rejects collisions, and keeps the restrictive umask active through shell
redirection:

```bash
set -e
umask 077
model=jev-latest
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$(
  ./scripts/with-pinned-node.sh node -e 'console.log(require("node:crypto").randomUUID())'
)"
results_path=".context/jev/results-${model}-${run_id}.json"
report_path=".context/jev/report-${model}-${run_id}.json"
report_tmp="${report_path}.tmp"
if [ -e "$results_path" ] || [ -e "$report_path" ] || [ -e "$report_tmp" ]; then
  printf 'Refusing to overwrite an existing run artifact.\n' >&2
  exit 1
fi

set +e
env JEV_MODEL="$model" \
  ./scripts/with-pinned-node.sh node --env-file=.env \
  .context/jev/harness.mjs evaluate \
  --dataset .context/jev/dataset-v2.json \
  --gold .context/jev/gold-v2.json \
  --concurrency 12 \
  --out "$results_path"
evaluate_status=$?
set -e
if [ "$evaluate_status" -ne 0 ] && [ "$evaluate_status" -ne 2 ]; then
  exit "$evaluate_status"
fi

set +e
./scripts/with-pinned-node.sh node .context/jev/harness.mjs report \
  --results "$results_path" > "$report_tmp"
report_status=$?
set -e
if [ "$report_status" -ne 0 ] && [ "$report_status" -ne 2 ]; then
  rm -f "$report_tmp"
  exit "$report_status"
fi
mv "$report_tmp" "$report_path"
chmod 600 "$results_path" "$report_path"
printf 'results=%s\nreport=%s\n' "$results_path" "$report_path"
```

Exit `0` means every required gate passed. Exit `2` means no-go or unmeasured and is an
expected completed result, not a transport failure.

Repeat the same model run when a gate is near its boundary, always with a unique results path.
An earlier unretained 2026-09-20 run over the same F1 requests and resolved `jev-1.13.0` build
measured role accuracy `0.850`, raw difficulty correlation `0.814`, and rounded difficulty
accuracy `0.663`; the retained run measured `0.838`, `0.811`, and `0.650`. The earlier file was
overwritten, so this observation motivates the retention rule but is not reproducible evidence.

## Reporting checklist

Record all of the following in the proposal or evaluation note:

- date, Git revision, Node version, harness/dataset/gold/result hashes;
- official documentation pages reviewed;
- requested model alias and concrete resolved model version;
- corpus and label counts, uncertainty counts, source strata, overlaps, and class support;
- requests, input/output tokens, estimated price, retries/failures, and measured latency if the
  harness records it;
- every gate with numerator, denominator, operating threshold, confidence interval, and
  unmeasured reason;
- constant baselines and any run-to-run variance;
- prompt, sample, label, or metric changes since the previous run; and
- the decision: go, no-go, or inconclusive. Never turn an unsupported dimension into a pass.
