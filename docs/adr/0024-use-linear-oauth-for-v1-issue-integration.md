# 0024. Use Linear OAuth for V1 Issue Integration

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble targets Conductor feature parity, including creating workspaces from Linear issues. The product also needs first-class Linear issue management: login, issue browsing, issue CRUD, comments, status updates, and workspace creation from selected issues.

Linear's public API is GraphQL and supports OAuth2 authentication and personal API keys. Linear recommends OAuth2 for applications used by others. The official TypeScript SDK supports OAuth access tokens.

Ensemble already uses macOS Keychain for secrets and keeps SQLite for app metadata/cache.

## Decision

Ensemble v1 will include first-class Linear integration using OAuth login.

Authentication:

- Use Linear OAuth2 with PKCE for desktop-app login where practical.
- Store Linear access and refresh tokens in macOS Keychain.
- Store only non-secret connection metadata in SQLite.
- Support disconnect/revoke from settings.

API client:

- Use Linear's GraphQL API through `@linear/sdk` where practical.
- Fall back to direct GraphQL operations where SDK coverage or query shape requires it.
- Treat Linear as the source of truth for remote issue state.
- Cache issue/team/project/status/label metadata in SQLite for UI responsiveness.

V1 capabilities:

- Sign in/out of Linear.
- List/search issues visible to the connected user.
- Read issue details, comments, team, project, cycle, labels, assignee, priority, and status.
- Create issues.
- Update issues: title, description, status, assignee, labels, priority, project, cycle, due date where Linear permissions allow.
- Comment on issues.
- Archive/delete issue support remains implementation-discovery scope; if supported cleanly by the Linear API and user permissions, expose it only behind explicit destructive confirmation.
- Create an Ensemble workspace from a Linear issue.
- Link the workspace record to Linear issue id, identifier, URL, team, and title.
- Use the Linear issue title/identifier to seed workspace name, branch name, initial Pi prompt, and PR metadata.

Workspace-from-issue behavior:

- User selects a Linear issue from Ensemble.
- Ensemble creates a git worktree workspace from the configured branch source.
- Ensemble stores Linear issue metadata in SQLite.
- Ensemble starts a Pi session with the issue context available in the initial composer/timeline.
- Ensemble can update Linear issue status according to user action or repository setting, but should not silently change status without clear UI.

## Alternatives Considered

### Personal API key only

Personal API keys are easy for scripts, but they are weaker UX for a desktop app and harder to manage safely for normal users. They may be allowed later as an advanced/manual option, but OAuth login is the v1 product path.

### Linear MCP only

Using a Linear MCP server could provide issue operations through agent tooling, but Ensemble needs app-native issue browsing, selection, and workspace creation. MCP can be additive, not the app integration source of truth.

### Defer Linear integration

Rejected. Linear workspace creation is part of the desired Conductor parity target and is explicitly required for v1.

## Consequences

- Linear becomes a first-class v1 integration, not a deferred feature.
- Ensemble needs OAuth callback handling, PKCE/state validation, token refresh, disconnect, and Keychain storage.
- Settings must include Linear connection state and remediation.
- Workspace creation must support Linear issue entry points through dedicated Linear issue browse/read/workspace-from-issue surfaces; the current project-add menu does not need to expose Linear unless a later product decision adds that entry point.
- Implementation must handle Linear API rate limits, pagination, filtering, OAuth token refresh, and permissions errors.
- Archive/delete mutation support must be verified against the current Linear schema before implementation.
