# 0013. Require gh CLI for V1 GitHub Integration

Date: 2026-06-04

## Status

Accepted

## Context

Ensemblr needs a complete review and pull request workflow: creating PRs, pushing branches, showing PR metadata, displaying CI/status checks, surfacing GitHub review comments, sending feedback back to the agent, resolving handled comments, opening PRs in GitHub, and merging when ready.

Every one of those actions already exists as a `gh` subcommand that runs against the user's own GitHub authentication. The alternative is re-implementing an authenticated GitHub client inside the app, plus token storage, and asking the user to authenticate a second time on a machine that already holds working GitHub credentials.

Implementing first-party GitHub OAuth and API integration would add product and security complexity that is unnecessary for a local-first developer app. Developer users commonly authenticate GitHub through the GitHub CLI.

## Decision

Ensemblr v1 will require an authenticated `gh` CLI as a setup prerequisite.

Ensemblr will run `gh` from the Electron main process and treat GitHub as the source of truth for remote PR/review/check state.

Setup requirements:

- Detect `gh` availability.
- Require successful `gh auth status` before Ensemblr is considered fully ready to use.
- If `gh` is missing, guide the user to install GitHub CLI.
- If `gh` is unauthenticated, guide the user to run `gh auth login`.

V1 GitHub behavior:

- Use local git remotes and current workspace branch to infer repository context.
- Use `gh pr create`, `gh pr view`, `gh pr checks`, and related commands for common PR flow.
- Use authenticated `gh api` for GitHub REST/GraphQL data that is not exposed cleanly by first-class `gh pr` commands, including deployment statuses, review comments, and review-thread details.
- Use `gh` for opening PRs, listing comments/review threads where practical, and merge actions where supported.
- Cache fetched PR/check/comment metadata in Ensemblr SQLite for UI responsiveness, but refresh from GitHub as source of truth.

## Alternatives Considered

### Optional gh CLI

Making `gh` optional would allow local-only usage, but review, PRs, and checks are core surfaces, and silently dropping them at first run produces confusing failures later in the workflow.

### Rejected App-Owned GitHub OAuth and REST/GraphQL APIs

An app-owned API integration would provide more control and a polished app-native auth flow, but it would require OAuth setup, token storage, rate-limit handling, permission scopes, and more security surface. Ensemblr will not build or plan a GitHub auth layer. `gh api` remains part of the authenticated CLI path and uses the user's existing `gh` authentication.

### Git only, no GitHub integration

Local git-only review would be simpler, but it would miss the PR, check, comment, and merge-readiness workflows the product is built around.

### GitHub app installation

A GitHub App could support richer organization workflows, but it is too heavy for v1 and unnecessary for local-first developer usage.

## Consequences

- Ensemblr's setup flow states the GitHub prerequisite up front, rather than letting the user discover it when the PR flow fails.
- V1 can ship useful PR/check workflows quickly for users who already have `gh` configured.
- Ensemblr does not store GitHub tokens.
- UX must clearly report when `gh` is missing, unauthenticated, or lacks permissions.
- The app must parse `gh` output robustly, preferring JSON output flags wherever available.
- `gh api` calls must stay behind the same `GitHubService` command boundary as other `gh` commands.
- Future GitHub enhancements must use `gh` and `gh api`.
