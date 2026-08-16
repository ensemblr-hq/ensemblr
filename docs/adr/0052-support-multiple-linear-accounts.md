# 0052. Support Multiple Linear Accounts

Date: 2026-08-16

## Status

Accepted

Extends [ADR 0024](0024-use-linear-oauth-for-v1-issue-integration.md), which
stands: OAuth is still the authentication path and Linear is still the source of
truth. This ADR only lifts the assumption that there is exactly one connection.

## Context

The Linear integration was built for one connection. `linear-auth-service.ts`
stored tokens under three fixed Keychain keys and one `integration_metadata` row
keyed `resource_id = 'default'`; the cache tables from migration `009` carried no
account column; and `main.ts` built one `LinearService` over one client whose
`getAccessToken` closed over that single connection.

Anyone working across two Linear organizations — a company workspace and a
client's, or a personal one — had to disconnect and reconnect to switch, which
also invalidated the whole issue cache. The Infisical integration
([ADR 0051](0051-resolve-infisical-secrets-as-a-live-environment-layer.md)) had
already shipped a multi-account shape one release earlier, so the app was
inconsistent with itself as well as short of the capability.

## Decision

**Linear is multi-account and merged.** Every connected account syncs, and the
browse list, composer issue picker, search, and workspace-from-issue picker show
all of them at once, each row tagged with its organization.

The alternative — connect N accounts, one active at a time, with a switcher —
was rejected. It is a much smaller change, but it keeps the failure the feature
exists to remove: you cannot see two organizations' issues side by side, and
switching re-syncs the cache each time.

### `accountId` is optional everywhere, resolved from the entity named

No surface asks the user or the agent to pick an account when the call already
implies one. Resolution order for a write or a single-entity read:

1. the `accountId` the caller passed;
2. the account of the entity named — the cached issue, or the target team's
   owning account;
3. for agent ops, the account of the calling workspace's linked issue;
4. the only account, when there is one.

Ambiguity is refused rather than guessed. `ENG-1` is unique inside a Linear
organization but not between two, so an identifier matching in more than one
account fails with the accounts named, and the agent surface carries the account
list on the failed result so the retry is informed rather than a second guess.

`listIssues` is the deliberate exception: it merges every account by default,
because seeing both organizations at once is what a search is for.

### Per-account failures narrow a result, they do not blank it

A merged read returns `accountFailures` alongside a partial result. One
rate-limited or reauthorizing organization removes its own rows and says so; it
does not turn the whole list into an error. The renderer surfaces this as a
warning above the list, and the agent port appends a sentence naming what was
missed — a short list that reads as a complete one is the failure mode worth
spending the words on.

### Tokens stay in the Keychain, one pair per account

`linear_accounts` has no token column. Access and refresh tokens live at
`linear-access-token:<accountId>` and `linear-refresh-token:<accountId>` in the
Keychain, so a database copied off the machine still carries no credential. The
boolean recording whether a grant can be renewed is `can_refresh`, not
`has_refresh_token`, so no column name reads as holding one — `database.test.ts`
asserts this.

The OAuth *client* stays app-level: one `app.linear.clientId` and one
`linear-client-secret`, because a Linear OAuth app installs into many workspaces.
Accounts are identities against that client, not separate clients.

### The cache was recreated, not migrated

Migration `019_linear_accounts` drops and recreates the four tables from `009`
with an `account_id` column and `ON DELETE CASCADE`. They are a refreshable
mirror of Linear, so the cost is one resync — whereas backfilling `account_id`
would need an account row that does not exist until the Keychain adoption pass
runs on first launch, long after migrations complete.

The cascade is load-bearing: disconnecting an account has to take its cached
issues with it, or the browse list keeps serving an organization the user just
signed out of.

### The pre-0052 connection is adopted, not discarded

On first read after the upgrade the service moves the legacy tokens to the
per-account keys, fills the identity from Linear, and deletes the legacy row. A
user connected before the upgrade stays connected without noticing.

Adoption needs the network to resolve the organization and viewer ids that key
the account row, and it can run offline. In that case the account is adopted
under a sentinel identity so the user stays connected, and the next successful
login for the same organization replaces it rather than adding a duplicate.

## Consequences

- `LinearConnectionSnapshot` became `LinearAccountSnapshot` plus a
  `LinearConnectionSummary` carrying the account list and one aggregate state, so
  the setup check and the onboarding gate keep asking a single yes/no question.
- `LinearIssueWire` and `LinearResourceWire` carry `accountId` and
  `organizationName`. The issue editor narrows every picker to the selected
  team's account, because an id from one organization is never valid in another.
- The five `ensemblr_linear_*` agent ops gained an optional `accountId`, and the
  port takes the calling `workspaceId` so a workspace created from an issue does
  not have to be told which organization it belongs to.
- A workspace's `linkedIssue` records `accountId`. It is a JSON field on an
  existing row, so no migration; workspaces created before this change have none
  and fall back to resolution by entity.
- `identifier` is no longer unique in the cache. `getIssueByIdentifier` takes an
  account, and `parseDeepLink`'s identifier-shaped `linear-issue` branch is
  ambiguous under multi-account — it has no dispatcher in `src/` today and was
  left alone rather than built on.
