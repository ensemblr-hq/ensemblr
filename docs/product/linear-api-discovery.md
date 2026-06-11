# Linear API Schema and Capability Discovery (ENS-044)

Status: draft pending live verification against a development Linear workspace.
Tested against: `@linear/sdk` (latest at time of writing) over the Linear GraphQL API
(`https://api.linear.app/graphql`). Record the exact SDK version in `package.json`
when ENS-045 lands.

This note maps every v1 Linear operation Ensemble needs to an implementation
path (`@linear/sdk` vs raw GraphQL), and documents pagination, rate-limit,
permission, and cache requirements consumed by `ENS-045`..`ENS-049`.

## Authentication findings (from ENS-043)

- OAuth2 authorization-code flow against `https://linear.app/oauth/authorize`
  and `https://api.linear.app/oauth/token`; revocation at
  `https://api.linear.app/oauth/revoke`.
- PKCE (`code_challenge`/`code_verifier`, S256) is sent on every login.
  Linear's token endpoint has historically required `client_secret` even for
  PKCE flows (confidential client model). Ensemble supports both: the exchange
  includes a Keychain-stored `linear-client-secret` when present and omits it
  otherwise. Verify against the real OAuth app during manual testing and
  update this note with the outcome.
- Scopes: `read,write` requested by default; configurable via
  `app.linear.scopes` in the Ensemble config.
- Tokens live in the macOS Keychain only. SQLite holds non-secret connection
  metadata (`integration_metadata`, provider `linear`).

## Operation mapping

| v1 operation | Needed by | Implementation path | Notes |
| --- | --- | --- | --- |
| Viewer identity (`viewer { name email }`) | ENS-043 settings card | Raw GraphQL (single query at login) | Avoids SDK dependency inside the auth service. |
| Organization (`organization { name urlKey }`) | ENS-043 settings card | Raw GraphQL | Same query as viewer. |
| Teams (`teams`) | ENS-045 cache, ENS-047 pickers | `@linear/sdk` `client.teams()` | Paginated connection. |
| Projects (`projects`) | ENS-045 cache, ENS-047 pickers | `@linear/sdk` `client.projects()` | Paginated. |
| Workflow states (`workflowStates`) | ENS-046 badges, ENS-047/049 status updates | `@linear/sdk` `client.workflowStates()` | Team-scoped; cache with `team_id`. |
| Labels (`issueLabels`) | ENS-046/047 | `@linear/sdk` `client.issueLabels()` | Paginated. |
| Cycles (`cycles`) | ENS-046/047 | `@linear/sdk` `client.cycles()` | Team-scoped. |
| Users (`users`) | ENS-046/047 assignee pickers | `@linear/sdk` `client.users()` | Paginated. |
| Issues list + filter (`issues(filter:)`) | ENS-046 browse | `@linear/sdk` `client.issues({ filter })` | Cursor pagination (`after`/`pageInfo.endCursor`). |
| Issue search (`searchIssues`) | ENS-046 search | `@linear/sdk` `client.searchIssues(term)` | Full-text; falls back to cached LIKE search offline. |
| Issue read (`issue(id)`) | ENS-046 detail, ENS-049 status | `@linear/sdk` `client.issue(id)` | Accepts UUID; identifiers (`THE-143`) resolve via filter on `number`+team key or search. |
| Issue comments (`issue.comments()`) | ENS-046 detail | `@linear/sdk` connection on issue | Cursor pagination; large threads need follow-up pages. |
| Issue create (`issueCreate`) | ENS-047 | `@linear/sdk` `client.createIssue(input)` | Requires `teamId`; optional project/state/label/cycle/assignee/priority/dueDate. |
| Issue update (`issueUpdate`) | ENS-047, ENS-049 status change | `@linear/sdk` `client.updateIssue(id, input)` | Field-level permissions enforced server-side. |
| Comment create (`commentCreate`) | ENS-047 | `@linear/sdk` `client.createComment(input)` | Requires `issueId`, `body` (markdown). |
| Issue archive/delete (`issueArchive`, `issueDelete`) | — | **Discovery-only. Not implemented in v1.** | Permission behavior (admin-only deletes, archive cascades) unverified; revisit only with explicit product approval and a safe test workspace. |

## SDK vs raw GraphQL

- `@linear/sdk` is the default path for all cached reads and mutations
  (ENS-045+). It is used in the **main process only**, constructed per call
  group with a fresh access token from the auth service
  (`new LinearClient({ accessToken })`).
- Raw GraphQL (plain `fetch`) is used where the SDK would be overkill or
  unavailable: the login-time viewer/organization probe inside the auth
  service, and any query shape the SDK does not expose efficiently.
- The SDK lazily resolves nested models (each relation access can issue
  another request). For cache sync, prefer explicit list queries with the
  fields needed, and persist raw payload JSON (`data_json`) so the renderer
  never triggers lazy loads.

## Pagination

- All list endpoints are Relay-style connections: `nodes`,
  `pageInfo { hasNextPage, endCursor }`, with `first`/`after` arguments.
- SDK connections expose `fetchNext()`; cache sync uses explicit
  `{ first: 50, after: cursor }` loops and persists the cursor in
  `linear_sync_state` so interrupted syncs resume.
- Default page size: 50 (Linear default); cap sync at a bounded number of
  pages per refresh to respect complexity limits.

## Rate limits and complexity

- Linear enforces request-count and GraphQL-complexity budgets per token
  (HTTP 429 with `Retry-After`, plus `X-RateLimit-Requests-*` headers;
  complexity-based rejections surface as GraphQL errors with
  `RATELIMITED` codes).
- Client policy (ENS-045): map 429/`RATELIMITED` to typed
  `rate-limited` errors carrying `retryAfterSeconds`; surface in UI with a
  retry timer; never auto-retry in a loop.
- Metadata refresh batches team/project/state/label/cycle/user queries and is
  cursor-bounded, so a full refresh stays within complexity budgets.

## Error and permission handling

GraphQL errors carry `extensions.code` (older API versions used `extensions.type`); the client maps them to typed service errors:

| Linear error | Typed error code | UI remediation |
| --- | --- | --- |
| HTTP 401 / `AUTHENTICATION_ERROR` | `reconnect-required` (after one refresh retry) | Reconnect from settings. |
| `FORBIDDEN` / permission denied | `permission-denied` | Non-destructive notice; local workspace flows keep working. |
| HTTP 429 / `RATELIMITED` | `rate-limited` | Retry timer with `retryAfterSeconds`. |
| Entity not found | `not-found` | Stale-cache notice + refresh action. |
| Validation / bad input | `invalid-request` | Inline form validation message. |
| Network failure | `network` | Offline notice; cached data stays visible. |
| No token stored | `not-connected` | Connect Linear remediation. |

## Cache metadata requirements (ENS-045 schema inputs)

- `linear_issues`: id (UUID), identifier (`THE-143`), title, description,
  team_id, project_id, state_id, assignee_id, priority (0-4 int),
  due_date, url, archived_at, remote_updated_at, raw `data_json`, synced_at.
- `linear_resources` (kind: team/project/state/label/cycle/user): id, kind,
  team_id (nullable), name, raw `data_json`, synced_at.
- `linear_comments`: id, issue_id, author_name, body, remote_created_at,
  raw `data_json`, synced_at.
- `linear_sync_state`: per-scope cursor + status + error_code + synced_at for
  resumable, idempotent refreshes.
- Workspace linking (ENS-048) needs: issue id, identifier, title, url, team
  key/name — all present on the cached issue row.
- Linear remains the source of truth; every cache row is refreshable and
  carries `synced_at` for staleness display (ENS-049).

## Out of scope confirmations

- No archive/delete mutations are implemented in v1 (permission and cascade
  semantics unverified).
- Discovery used documentation and mocked schema only; no Linear issues were
  created or mutated during discovery.
