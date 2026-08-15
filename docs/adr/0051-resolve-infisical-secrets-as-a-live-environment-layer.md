# 0051. Resolve Infisical Secrets As A Live Environment Layer

Date: 2026-08-15

## Status

Accepted

Extends [0018](./0018-use-keychain-for-secrets.md), which made the macOS Keychain
the sole store for anything secret. That still holds: the credentials this ADR
introduces, and the values it caches, live there and nowhere else.

## Context

Ensemblr already has a complete environment-variable system — three scopes
(`app`, `repository`, `workspace`), a layered assembler in
`src/main/environment/`, Keychain-backed secrets, and a settings panel. Every
value in it, though, has to be typed in by hand or pointed at a local `.env`
file. A team that keeps its secrets in Infisical had to copy them into Ensemblr
once per developer, and again on every rotation.

Four decisions had to be made together, because each one constrains the next.

## Decision

### 1. Authenticate with a Machine Identity, not OAuth

Infisical does expose OAuth 2.0 applications (`/api/v1/oauth/authorize`,
`/token`, PKCE, refresh tokens) and the app already has the machinery for that
flow — `src/main/linear/` runs exactly it against Linear. It does not fit here.

**Infisical OAuth applications are registered per organization**, by an
organization admin, under Organization Settings. There is no globally registered
"Ensemblr" client the app can ship the way it ships one for Linear, so the
browser-consent flow would still begin with the user pasting a `client_id` and
`client_secret` an admin created for them — the same paste, with an OAuth
round-trip bolted on, and nothing working for self-hosted instances until
someone registered an app there too.

Universal Auth is one paste and works everywhere: cloud US, cloud EU, and any
self-hosted deployment, with no admin step beyond creating the identity. The
account model is deliberately auth-method-agnostic, so OAuth can be added later
as a second method behind the same interface.

### 2. A hand-written REST client, not `@infisical/sdk`

The repository's precedent is already a hand-written client: `linear-client.ts`
talks to Linear's GraphQL API directly rather than through `@linear/sdk`, and
GitHub is reached by shelling out to `gh`. Three further facts settled it:

- **The SDK cannot list projects.** Its `ProjectsClient` exposes only `create`
  and `inviteMembers`. The project picker — the entire point of the settings
  screen — needs raw REST regardless, so the SDK would be a second HTTP stack
  rather than a replacement for one.
- **It costs 55 MB installed**, 17 MB of which is `@aws-sdk/credential-providers`
  for the AWS IAM auth method this app will never use. Its ESM bundle imports
  those statically, so it would need `external` in `vite.main.config.mts` and a
  matching `PACKAGE_KEEP_*` in `forge.config.ts`, and the packaged app would
  carry all of it.
- **It depends on zod 3**, against the zod 4 this repository pins, which would
  put two copies of zod in the main bundle.

Against that, the surface actually needed is four endpoints, all verified live
against `app.infisical.com`:

| Call | Endpoint |
| --- | --- |
| Log in | `POST /api/v1/auth/universal-auth/login` |
| List projects (**with environments inlined**) | `GET /api/v1/projects` |
| Read secrets | `GET /api/v3/secrets/raw` |

`/api/v1/projects` returning each project's environments in the same payload is
what lets the settings screen fill both the project and the environment picker
from one authenticated request.

### 3. Pull only

Infisical is the source of truth. Ensemblr reads; it never writes. This removes
the entire conflict-resolution question and, more importantly, removes any path
by which a stale local value — or an agent — could overwrite a shared production
secret.

### 4. A live layer with a Keychain-backed failure fallback

The obvious alternative was to materialise: on an explicit sync, write each
Infisical secret into the existing Ensemblr secret store at repository scope.
That reuses everything already built, but it duplicates every secret onto disk
permanently, goes stale silently, and needs a deletion-reconciliation story.

Instead `src/main/environment/environment-assembly.ts` gains an Infisical layer
resolved at assembly time. Values are fresh, and nothing is permanently
duplicated.

**Every resolution fetches live.** There is deliberately no freshness window:
the Keychain-held entry is a *failure fallback*, read only when the fetch fails,
not a latency cache. Secrets rotate without warning, and a stored value served
while Infisical is reachable would hand a script a credential that has already
been revoked — a failure mode that is silent and hard to attribute.

The practical consequence is that **setup scripts, run scripts, terminals, and
agent harnesses all resolve fresh secrets on every launch**, because each of
them spawns through `src/main/terminal/terminal-service.ts`, which assembles the
workspace environment per session. Concurrent resolutions of one scope are
collapsed into a single request by an in-flight map, so opening several
terminals at once costs one round trip rather than several.

**The layer sits between env files and explicit local values:**

```
env files  <  infisical  <  plain (sqlite)  <  ensemblr secrets
```

A variable the developer sets by hand therefore still wins, which is what
someone debugging against a local service expects. Every Infisical value joins
`redactValues`, so the existing command-output scrubber covers them with no new
work.

**The resolver never throws.** A network failure serves the stored fallback and
emits a warning diagnostic; no fallback and no network yields an empty layer and
a warning. Infisical being unreachable must never be the reason a workspace
cannot open,
and `tests/main/environment-infisical-layer.test.ts` asserts exactly that.

## Consequences

**The link is split by sensitivity.** The project half — instance URL, project
id, environment, path — is written to the committed `.ensemblr/settings.toml`
under `[infisical]`, so a teammate who clones the repository is already pointed
at the right secrets. The credential half never leaves the machine: the account
row is in SQLite (migration `017_infisical_accounts_and_links`) and the client
secret is in the Keychain. `infisical_accounts` deliberately has **no column**
for the secret, so a database copied off the machine carries no credential.

**Which account resolves a committed link is a local choice.** Ensemblr matches
on instance URL and adopts the account when exactly one matches; an ambiguous
match is left for the user rather than guessed, because guessing would spend one
organization's credentials against another's project.

**The settings panel asks which project, never which account.**
`InfisicalService.listProjects` fans out over every configured account and
returns one list, each project tagged with the account that reached it, so the
account half follows from the project the user picks. An account picker would
make the user answer a question they cannot answer from the outside — which of
their organizations owns a project is a fact of the project, not a decision.
Several accounts are still normal (cloud US, cloud EU, self-hosted), so the
picker groups by account label once more than one is configured, and an account
that fails to list drops out of the aggregate with a named notice rather than
failing the whole call. This also resolves the ambiguous-instance-URL case
above: matching the committed project id against the aggregated list identifies
the account, leaving Save as the only remaining step.

**`src/main/environment/` does not depend on `src/main/infisical/`.** The
resolver is injected as a single function type, wired in `src/main/main.ts`.
That keeps the dependency one-directional and lets the layer be tested with a
fake — no network, no Keychain.

**Infisical-sourced variables are read-only in the settings panel.** They render
masked with an Infisical badge and no edit, delete, or reveal control, because
there is no local value to act on. The user changes them in Infisical.

**The client secret is write-only across IPC.** It goes down to main once and is
never returned; the renderer only ever sees the store's mask.

**Agents gain no new capability.** There is deliberately no agent-control op that
reads an Infisical secret. Values reach agents only as process environment,
exactly as today's secrets do.

**The service is rebuilt when the database connection changes**, because the
account store, link store, and cache all bind to one open handle. `main.ts`
memoizes it against the current connection rather than constructing it at
startup.
