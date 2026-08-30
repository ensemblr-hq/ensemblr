# Integrations

Ensemblr talks to five things outside itself: GitHub through the `gh` CLI,
Linear over OAuth, Infisical over its API, git through the native binary, and
your desktop — Launch Services on macOS, `.desktop` entries on Linux — to find
the apps an "Open in…" menu offers. The first three need a setup step; the other
two need nothing.

The connection state for each lives in **Settings → Integrations**, and the
setup gate that checks them at first run is described in
[`./03-first-run.md`](./03-first-run.md).

## GitHub

Ensemblr does not implement a GitHub client. It shells out to the **`gh` CLI**
and runs every command as you, using the credentials `gh` already holds
([ADR 0013](../adr/0013-use-gh-cli-for-v1-github-integration.md)).

**Ensemblr stores no GitHub token.** There is nothing to paste into settings, no
OAuth screen, and no second place a token can leak from. `gh` owns its
credentials and Ensemblr never copies them.

Setup is one command:

```
gh auth login --hostname github.com
```

Ensemblr checks `gh auth status` as part of its setup gate and tells you to run
that command when the check fails. If `gh` itself is missing, install the GitHub
CLI first.

What the integration powers:

| Surface | What `gh` does |
| --- | --- |
| Pull request status | reads the PR for the workspace's branch — state, draft flag, mergeability, title, description |
| The per-check list | reads the status-check rollup for that PR, so each check row shows passed, failed, or running |
| PR comments | reads review threads and issue comments into the Checks tab, alongside your local review comments |
| Creating a PR | `gh pr create`, run by the agent onto the target branch |
| Merging | `gh pr merge`, from the two-step merge confirmation |
| Repository browsing | lists the repositories your account can see, when you add a project from GitHub |
| Publishing a project | `gh repo create` publishes a new local project to GitHub |
| The board backlog | reads each project's **unassigned** open issues, so work with no workspace yet has a place to sit |

GitHub is treated as the source of truth for remote state: Ensemblr caches what
it fetched so the panel paints instantly, then refreshes from GitHub, and tells
you when a refresh failed rather than showing you a stale result.

Board issues are cached locally as well, so the dashboard paints at app start
instead of waiting on a `gh issue list` per repository. When `gh` fails and the
cache stands in for it, the rows shown are real but old, and the board says so
rather than presenting them as current. The backlog query asks GitHub for
unassigned issues directly rather than filtering them afterwards — a page limit
counts the rows GitHub returns, so filtering after the fact would empty the
backlog of any repository whose newest open issues happen to all be assigned.

A repository with **Issues disabled** on GitHub is not an error. `gh` refuses the
listing, Ensemblr recognises the refusal, and that repository simply contributes
no issues — the backlog stays green rather than reddening because one project in
the list does not use GitHub Issues. Failures that *are* real are reported per
repository, so a broken token on one remote never hides the other nine.

Review and merge flow is on [`./08-reviewing-changes.md`](./08-reviewing-changes.md).

## Linear

Linear connects over OAuth 2.0 with PKCE. **A normal user configures nothing**:
Ensemblr ships with a registered OAuth application, and the login is a public
PKCE client, so no client secret ships in the build and none is asked of you.

Connecting opens `linear.app` in your browser for consent. The callback comes
back to a temporary loopback HTTP server on `127.0.0.1`, on one of five fixed
ports registered as redirect URIs on that application — Linear matches redirect
URIs exactly, so a random port could never match. The server takes one callback
and shuts down.

The access and refresh tokens go straight to the OS secret store, keyed per
account; only non-secret connection metadata is kept in the clear. Disconnecting from
settings revokes the token with Linear rather than just forgetting it. Ensemblr
requests the `read` and `write` scopes.

### More than one account

A Linear OAuth application installs into one organization at a time, so an
account per organization is the normal case rather than an edge one. **Connect
as many as you need** ([ADR 0052](../adr/0052-support-multiple-linear-accounts.md)).
Every connected account syncs, and browse, search, the composer's issue picker,
and the workspace-from-issue picker show all of them at once, each row tagged
with the organization it came from.

- **A read that spans accounts is merged, not chosen.** When one organization is
  reauthorizing, its rows drop out and the surface names it, rather than the
  whole list going blank.
- **A write is scoped to exactly one account.** Which one follows from the issue
  named; a workspace created from an issue defaults to the account that issue
  came from. When the target is genuinely ambiguous, the call is refused with
  the candidate accounts named rather than guessed at — an issue id from one
  organization is never valid in another.
- **Disconnecting an account takes its cached issues with it**, and its stored
  tokens. The accounts you keep are untouched.

A connection made before this landed is adopted automatically on first read.

If you run your own Linear OAuth application — a self-hosted setup, or a
workspace whose admins will not approve a third-party app — set
`app.linear.clientId` in `~/.config/ensemblr/config.json`. It always overrides
the built-in one.

What the integration powers:

| Surface | What it does |
| --- | --- |
| Issue browsing | search and read issues visible to any connected account, with their comments, team, project, status, labels, and assignee — plus an inline editor for the properties rail |
| The board backlog | unstarted issues appear in Backlog; dragging one rightward is what creates the workspace from it |
| Workspace from an issue | create a workspace directly from an issue, seeding its name, branch, and initial prompt from the issue title and identifier |
| Attaching to a chat | pick an issue in the composer and attach it as a chip; the whole issue is serialized as a markdown document for the agent to read |
| Agent reads | agents can list and read issues and the metadata tables (teams, projects, states, labels, users) through Ensemblr Control |
| Agent writes | agents can update an issue and comment on it |

**Images embedded in an issue or a comment load.** A `uploads.linear.app` URL is
unauthenticated and the signed URL Linear hands back expires five minutes later,
so the fetch happens in the main process against the owning account's token
rather than in the renderer, and the expiring signature is stripped before
anything crosses to the renderer or into an agent's context. A ticket left open
for an hour still shows its screenshots; an image that genuinely fails falls back
to a placeholder carrying its alt text.

**The browse list remembers how you left it.** Search text, account, and team
narrowing persist across a restart alongside the scope, sort, and grouping
preferences, and the filter bar has a reset control. A stored filter that outlives
what it names — an account since disconnected, a team since archived — falls back
to its default rather than quietly emptying the list.

A workspace created from an issue now **tells its agent so**: the chat opens
with that issue attached as a document, and the agent is given the issue's
identity along with the moments at which it is expected to move the ticket. The
ticket therefore tracks the work without you asking for each transition by hand.

Agent writes are gated: an agent **cannot move an issue into a state Linear
classifies as completed or canceled**, and an unknown state id fails closed
rather than being attempted. A sub-agent is refused tracker writes outright and
reports back through its parent instead, and a planning agent is refused the
move — In Review would claim an implementation that does not exist yet. That is
enforced at the control boundary, not merely instructed — see
[`./09-agent-control.md`](./09-agent-control.md).

Nothing on the board writes back to Linear. Dismissing an issue from the board
hides it locally; the issue's own status stays yours to change
([ADR 0024](../adr/0024-use-linear-oauth-for-v1-issue-integration.md)).

## Infisical

Link a repository to an **Infisical** project and its secrets resolve into every
workspace, terminal, run script, and agent that repository launches
([ADR 0051](../adr/0051-resolve-infisical-secrets-as-a-live-environment-layer.md)).
Nothing is written into the repository, and nothing is copied into Ensemblr's
own secret store.

Setup is two halves, split by sensitivity:

| Half | Where it goes | What it holds |
| --- | --- | --- |
| The **account** | SQLite, with its client secret in the Keychain | a Machine Identity — instance URL, client id, client secret |
| The **project** | the committed `.ensemblr/settings.toml` | instance URL, project id, environment, path |

Because the project half is committed, a teammate who clones the repository is
already pointed at the right secrets and only has to add an identity of their
own. **Settings → Integrations** owns the accounts list (add, re-check, remove);
the repository's own **Secrets** screen owns the link.

Authentication is Infisical's **Universal Auth**, not OAuth: an Infisical OAuth
application is registered per organization by an admin, so there is no globally
registered Ensemblr client to ship the way there is for Linear. One Machine
Identity paste works against cloud US, cloud EU, and any self-hosted instance.
Create one under Organization Access Control → Identities, give it access to the
project, and paste its client id and secret.

The Secrets screen asks which **project**, never which account: Ensemblr lists
projects across every configured account at once and each row carries the
account that reached it, so picking the project settles the account. An account
that cannot be listed drops out of the list by name rather than failing the
whole screen.

Three properties worth knowing:

- **Pull only.** Ensemblr never writes a secret back to Infisical.
- **Every launch resolves live.** There is no freshness window — a rotated
  secret takes effect on the next terminal, script, or agent you start. The
  Keychain-held copy is a *failure* fallback, read only when the fetch fails,
  never as a cache.
- **Local values still win.** The layer sits between env files and the values
  you set by hand:

  ```
  env files  <  infisical  <  plain (local)  <  Ensemblr secrets
  ```

Infisical being unreachable never blocks a workspace: the resolver serves the
stored fallback and warns, or yields an empty layer and warns. Every resolved
value joins the output redactor, so it is scrubbed from terminal output like any
other secret.

The `[infisical]` block itself is documented in
[`./12-repository-settings.md`](./12-repository-settings.md).

## git

Ensemblr drives the **native `git` binary**. It does not bundle its own git
implementation, and nothing it does to your repository is something you could
not do yourself from a terminal in the same directory.

It uses git for worktrees (one per workspace — the isolation the whole product
rests on), branch creation and renaming, reading status and conflicts, commits,
push, the commit log behind the Changes source picker, and every diff the review
panel renders.

Because the worktree is a normal git worktree, any other tool you point at it —
your editor's git integration, a source-control GUI, your own shell — sees
exactly the same repository state.

## macOS: opening a workspace elsewhere

The workbench header carries an **Open workspace in…** split button that hands
the workspace directory to another app
([ADR 0028](../adr/0028-use-launch-services-for-open-workspace-in-app.md)).

Ensemblr detects installed apps through Launch Services and shows their real
macOS icons. **Only apps you actually have installed appear** — the menu never
lists something that would fail to open. The candidate set spans Finder, editors
(VS Code and Insiders, Cursor, Windsurf, Zed, Xcode, Sublime Text, Nova,
IntelliJ IDEA, WebStorm, PyCharm), terminals (Ghostty, Warp, iTerm, Hyper,
Alacritty, kitty, Terminal), and source-control apps (GitHub Desktop, Tower,
Fork, Sourcetree, GitKraken), plus **Copy path**.

| Shortcut | Action |
| --- | --- |
| `⌘O` | open in the current primary target |
| `⌘⇧C` | copy the workspace path |
| `1`–`9` | open the Nth entry, while the dropdown is open |

Detection is cached, so the menu paints with real icons on the first frame of
every launch after the first. The very first launch takes about a second to
populate; a background refresh on each launch keeps the list current as you
install and uninstall apps.

## Where secrets live

Every secret Ensemblr stores goes into the **OS secret store**, and which one
that is depends on the platform:

- **macOS** — the Keychain, written through `/usr/bin/security` under the service
  name `dev.ensemblr.app.secret-store`
  ([ADR 0018](../adr/0018-use-keychain-for-secrets.md)).
- **Linux** — encrypted with Electron `safeStorage` and held as ciphertext in
  `ensemblr.db`, because there is no one keyring API every desktop answers
  ([ADR 0056](../adr/0056-ship-a-linux-amd64-appimage.md)). `safeStorage` still
  takes its key from gnome-keyring or KWallet; if no daemon answers it degrades
  to obfuscation rather than encryption, and the **Secret storage** setup check
  says so instead of letting it pass silently.

Nothing secret is written to `~/.config/ensemblr/config.json`, to the committed
`.ensemblr/settings.toml`, or — on macOS — to the local database.

A secret is bound to one of three scopes:

| Scope | Applies to |
| --- | --- |
| `app` | everything you do in Ensemblr |
| `repository` | one project |
| `workspace` | one workspace |

Only the key name, its scope, and its masked display state are kept in the
clear, so the app can list your secrets without reading them.

Two credentials are deliberately **not** Ensemblr's:

- **GitHub tokens belong to `gh`.** They are never copied into Ensemblr's own
  secret store.
- **Pi's provider credentials stay in the Pi user environment**, where Pi put
  them. Ensemblr duplicates none of it unless you explicitly configure an
  Ensemblr-owned secret of your own.

**Infisical secrets are not stored at all** — they resolve live at launch. What
does reach the Keychain is the Machine Identity's client secret, plus a copy of
each resolved value kept solely so an unreachable Infisical does not take a
workspace down with it.

## See also

- [`./02-requirements.md`](./02-requirements.md) — what has to be installed
  before any of this works.
- [`./11-app-settings.md`](./11-app-settings.md) — the Integrations,
  Environment, and Git settings sections.
- [`./14-troubleshooting.md`](./14-troubleshooting.md) — what to do when a check
  fails or a connection drops.
- [`../../CONTEXT.md`](../../CONTEXT.md) — the vocabulary this guide uses.
