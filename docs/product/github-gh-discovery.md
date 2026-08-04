# GitHub `gh` Capability Discovery (ENS-056 / THE-156)

Date: 2026-06-11
Scope: Determine whether the `gh` CLI (with authenticated `gh api`) covers the
review-flow needs of Milestone 7 without an app-owned GitHub OAuth client
(ADR 0013). Commands verified against `gh` 2.x command surface.

## Capability map

| Capability | Source | Status | Notes |
| --- | --- | --- | --- |
| PR metadata (number, title, body, URL, branch, state, draft) | `gh pr view --json …` | First-class | Single call, JSON output. |
| Mergeability signals | `gh pr view --json mergeable,mergeStateStatus,reviewDecision` | First-class | `mergeStateStatus` exposes BLOCKED/CLEAN/DIRTY. |
| Checks + per-check links | `gh pr view --json statusCheckRollup` | First-class | Rollup includes CheckRun and StatusContext nodes with `detailsUrl`/`targetUrl`. `gh pr checks` offers the same rows in tabular/JSON form; the rollup is preferred because it arrives with the same `pr view` call. |
| Check annotations (inline failure details) | `gh api -X GET repos/{owner}/{repo}/check-runs/{id}/annotations` | `gh api` only | Requires check-run id from rollup; deferred — failed-check remediation in v1 uses the check name, conclusion, and details link. |
| Issue comments on the PR | `gh pr view --json comments` | First-class | Author, body, createdAt, url. |
| Review summaries (approve/request-changes bodies) | `gh pr view --json reviews` | First-class | |
| Review threads + resolution state | `gh api graphql` (`reviewThreads { isResolved … }`) | `gh api` only | First-class `gh` commands do not expose thread resolution; GraphQL does. Implemented in `GithubService.fetchReviewThreads`. |
| Resolving / replying to review threads | `gh api graphql` mutations (`resolveReviewThread`, `addPullRequestReviewThreadReply`) | `gh api` only — deferred | Mutations exist but v1 ships read-only GitHub comments; local comments cover annotation needs (ENS-052). Comment mutation UI stays out of scope per ENS-056. |
| Deployments | `gh api -X GET repos/{owner}/{repo}/deployments -f ref=<head sha>`, retried with `-f ref=<head branch>` | `gh api` only | Returns deployment rows; environment URL requires the statuses call below. Vercel and Netlify record deployments against the commit SHA, so the query tries `headRefOid` first (a branch name only resolves when the branch lives in the base repo). GitHub matches `ref` against the literal string the deployment was recorded under and never resolves branch to commit — verified against `nuxt/nuxt`, where one commit carries deployments under both a branch ref and a SHA ref and each query returns only its own — so an empty SHA result is retried with `headRefName` to keep workflow-created deployments (`ref: github.head_ref`) discoverable. |
| Deployment status / preview URL | `gh api -X GET repos/{owner}/{repo}/deployments/{id}/statuses` | `gh api` only | `environment_url` carries the hosted preview URL. A deployment reports `queued`/`pending` with no URL before it reports `success`, so the snapshot reads a page of statuses and keeps the newest one that carries a URL. |
| Preview URLs (fallback 2) | `gh pr view --json statusCheckRollup` check links | First-class | Vercel/Netlify checks expose `detailsUrl`/`targetUrl`. Provider rows that link to review tooling (`Vercel Agent Review`, `Vercel Preview Comments`) are skipped — they are not deployments. That label heuristic applies only to rows whose URL is not already a hosted preview, so a project named `code-review-tool` keeps its link. |
| Preview URLs (fallback 3) | Provider bot PR comments (`gh pr view --json comments`) | First-class | The `vercel`/`netlify` bot comment links the hosted preview (`[Preview](https://<project>-git-<branch>.vercel.app)`, `**Deploy Preview URL**`). |
| Merge | `gh pr merge --squash/--merge/--rebase` | First-class | Used by ENS-058 confirmation flow. |

## v1 preview URL source order (validated)

1. **GitHub deployment statuses** via authenticated `gh api` (`environment_url`).
2. **Check links** from `statusCheckRollup` (`detailsUrl`/`targetUrl`).
3. **Provider bot PR comments** as last resort.

A URL on a provider-hosted origin (`*.vercel.app`, `*.netlify.app`) outranks
this order: the header links the deployed build whenever any source exposes
one, and falls back to the source order only when every candidate points at a
provider dashboard or inspector page instead. The same preference applies
*within* a source — the Netlify bot comment lists its `app.netlify.com` deploy
log above the `.netlify.app` preview, and a monorepo publishes several
deployments per commit where only some carry a preview URL. `app.netlify.com`
is therefore not a hosted origin; legacy `*.netlify.com` site URLs were retired
in 2020 and redirect to `.netlify.app`.

No Vercel/Netlify/provider auth is required: all three sources ride on `gh`
authentication. `GithubService.fetchDeployments` reads source 1; sources 2 and 3
ride on the checks and comments already in the snapshot. All three are ranked in
`derivePreviewDeployment` (`src/renderer/lib/workbench/preview-deployment.ts`).

## Add-all-comments-to-chat feasibility

Feasible. The snapshot aggregates issue comments, review bodies, and review
threads (with file/line anchors and resolution state) into one
`comments` list. ENS-053 serializes this list into a Pi context payload; size
is bounded by `first: 50` thread pagination and the context-size guard in the
composer payload builder.

## Failed-check remediation data

Available today: check name, workflow name, conclusion bucket, started/completed
timestamps, and `detailsUrl` deep link. **Not** available without extra calls:
log excerpts and annotations (need `gh api` per check run, plus run-log
endpoints that return zips). v1 recommendation: send check identity + details
URL to Pi as remediation context and let the agent/user follow the link;
annotations can be added later through
`repos/{owner}/{repo}/check-runs/{id}/annotations` without new auth.

## Gaps / intentionally unsupported in v1

- Resolving or replying to GitHub review threads from Ensemblr (mutation UI
  deferred; local comments are the Ensemblr-native annotation channel).
- Check-run log excerpts and annotations (extra `gh api` calls; deferred).
- Reactions, suggested-change application, and multi-account switching.

## Minimum v1 checks-panel comment behavior (recommendation)

- Show GitHub issue comments, review bodies, and review-thread comments
  read-only, clearly labelled with author + source, with resolution state
  badges on threads.
- Local Ensemblr comments/todos (ENS-052) render in distinct sections and are
  the only mutable items.
- Every GitHub item links out via its `url`.
- Add-to-Pi-context actions accept any comment row (ENS-053).

## Command conventions

- All GitHub access goes through `GithubService` (`src/main/github/`).
- `gh api` GET calls that pass `-f` fields always set `-X GET` explicitly so
  fields become query parameters instead of flipping the call to POST.
- GraphQL goes through `gh api graphql` with variables passed via `-F`.
- No app-owned GitHub OAuth/token storage anywhere; `gh auth status` is the
  only credential gate (setup diagnostics).
