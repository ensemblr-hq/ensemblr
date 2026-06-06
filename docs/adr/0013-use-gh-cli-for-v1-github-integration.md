# 0013. Require gh CLI for V1 GitHub Integration

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble targets Conductor parity for review and pull request workflows: creating PRs, pushing branches, showing PR metadata, displaying CI/status checks, surfacing GitHub review comments, sending feedback back to the agent, resolving handled comments, opening PRs in GitHub, and merging when ready.

Conductor's public docs state that Conductor checks for GitHub authentication in the terminal environment during setup, tells users to verify with `gh auth status`, and requires GitHub plus at least one agent provider to use the app.

Implementing first-party GitHub OAuth and API integration would add product and security complexity that is unnecessary for a local-first developer app. Developer users commonly authenticate GitHub through the GitHub CLI.

## Decision

Ensemble v1 will require an authenticated `gh` CLI as a setup prerequisite.

Ensemble will run `gh` from the Electron main process and treat GitHub as the source of truth for remote PR/review/check state.

Setup requirements:

- Detect `gh` availability.
- Require successful `gh auth status` before Ensemble is considered fully ready to use.
- If `gh` is missing, guide the user to install GitHub CLI.
- If `gh` is unauthenticated, guide the user to run `gh auth login`.

V1 GitHub behavior:

- Use local git remotes and current workspace branch to infer repository context.
- Use `gh pr create`, `gh pr view`, `gh pr checks`, and related commands for common PR flow.
- Use authenticated `gh api` for GitHub REST/GraphQL data that is not exposed cleanly by first-class `gh pr` commands, including deployment statuses, review comments, and review-thread details.
- Use `gh` for opening PRs, listing comments/review threads where practical, and merge actions where supported.
- Cache fetched PR/check/comment metadata in Ensemble SQLite for UI responsiveness, but refresh from GitHub as source of truth.

## Alternatives Considered

### Optional gh CLI

Making `gh` optional would allow local-only usage, but it would diverge from Conductor's setup model and weaken review/PR/check parity.

### Rejected App-Owned GitHub OAuth and REST/GraphQL APIs

An app-owned API integration would provide more control and a polished app-native auth flow, but it would require OAuth setup, token storage, rate-limit handling, permission scopes, and more security surface. Ensemble will not build or plan a GitHub auth layer. `gh api` remains part of the authenticated CLI path and uses the user's existing `gh` authentication.

### Git only, no GitHub integration

Local git-only review would be simpler, but it would miss major Conductor parity features around PRs, checks, comments, and merge readiness.

### GitHub app installation

A GitHub App could support richer organization workflows, but it is too heavy for v1 and unnecessary for local-first developer usage.

## Consequences

- Ensemble's setup flow matches Conductor's GitHub prerequisite model.
- V1 can ship useful PR/check workflows quickly for users who already have `gh` configured.
- Ensemble does not store GitHub tokens.
- UX must clearly report when `gh` is missing, unauthenticated, or lacks permissions.
- The app must parse `gh` output robustly, preferring JSON output flags wherever available.
- `gh api` calls must stay behind the same `GitHubService` command boundary as other `gh` commands.
- Future GitHub enhancements must use `gh` and `gh api`.
