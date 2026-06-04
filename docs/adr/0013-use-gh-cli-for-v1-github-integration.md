# 0013. Require gh CLI for V1 GitHub Integration

Date: 2026-06-04

## Status

Accepted

## Context

Piductor targets Conductor parity for review and pull request workflows: creating PRs, pushing branches, showing PR metadata, displaying CI/status checks, surfacing GitHub review comments, sending feedback back to the agent, resolving handled comments, opening PRs in GitHub, and merging when ready.

Conductor's public docs state that Conductor checks for GitHub authentication in the terminal environment during setup, tells users to verify with `gh auth status`, and requires GitHub plus at least one agent provider to use the app.

Implementing first-party GitHub OAuth and API integration would add product and security complexity before the rest of the workspace/review flow is proven. Developer users commonly authenticate GitHub through the GitHub CLI.

## Decision

Piductor v1 will require an authenticated `gh` CLI as a setup prerequisite.

Piductor will run `gh` from the Electron main process and treat GitHub as the source of truth for remote PR/review/check state.

Setup requirements:

- Detect `gh` availability.
- Require successful `gh auth status` before Piductor is considered fully ready to use.
- If `gh` is missing, guide the user to install GitHub CLI.
- If `gh` is unauthenticated, guide the user to run `gh auth login`.

V1 GitHub behavior:

- Use local git remotes and current workspace branch to infer repository context.
- Use `gh pr create`, `gh pr view`, `gh pr checks`, and related commands for PR flow.
- Use `gh` for opening PRs, listing comments/review threads where practical, and merge actions where supported.
- Cache fetched PR/check/comment metadata in Piductor SQLite for UI responsiveness, but refresh from GitHub as source of truth.

## Alternatives Considered

### Optional gh CLI

Making `gh` optional would allow local-only usage, but it would diverge from Conductor's setup model and weaken review/PR/check parity.

### GitHub OAuth and REST/GraphQL APIs

Direct API integration would provide more control and a polished app-native auth flow, but it would require OAuth setup, token storage, rate-limit handling, permission scopes, and more security surface. It is deferred until the core product flow is proven.

### Git only, no GitHub integration

Local git-only review would be simpler, but it would miss major Conductor parity features around PRs, checks, comments, and merge readiness.

### GitHub app installation

A GitHub App could support richer organization workflows, but it is too heavy for v1 and unnecessary for local-first developer usage.

## Consequences

- Piductor's setup flow matches Conductor's GitHub prerequisite model.
- V1 can ship useful PR/check workflows quickly for users who already have `gh` configured.
- Piductor does not need to store GitHub tokens in v1.
- UX must clearly report when `gh` is missing, unauthenticated, or lacks permissions.
- The app must parse `gh` output robustly, preferring JSON output flags wherever available.
- Future direct API integration remains possible behind a `GitHubService` boundary.
