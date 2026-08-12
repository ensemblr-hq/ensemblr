# Integrations

Ensemblr talks to four things outside itself: GitHub through the `gh` CLI,
Linear over OAuth, git through the native binary, and macOS through Launch
Services. Two of them need a one-time setup step; the other two need nothing.

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

GitHub is treated as the source of truth for remote state: Ensemblr caches what
it fetched so the panel paints instantly, then refreshes from GitHub, and tells
you when a refresh failed rather than showing you a stale result.

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

The access and refresh tokens go straight to the macOS Keychain; only non-secret
connection metadata is kept locally. Disconnecting from settings revokes the
token with Linear rather than just forgetting it. Ensemblr requests the `read`
and `write` scopes.

If you run your own Linear OAuth application — a self-hosted setup, or a
workspace whose admins will not approve a third-party app — set
`app.linear.clientId` in `~/.config/ensemblr/config.json`. It always overrides
the built-in one.

What the integration powers:

| Surface | What it does |
| --- | --- |
| Issue browsing | search and read issues visible to your account, with their comments, team, project, status, labels, and assignee |
| Workspace from an issue | create a workspace directly from an issue, seeding its name, branch, and initial prompt from the issue title and identifier |
| Attaching to a chat | pick an issue in the composer and attach it as a chip; the whole issue is serialized as a markdown document for the agent to read |
| Agent reads | agents can list and read issues and the metadata tables (teams, projects, states, labels, users) through Ensemblr Control |
| Agent writes | agents can update an issue and comment on it |

Agent writes are gated: an agent **cannot move an issue into a state Linear
classifies as completed or canceled**, and an unknown state id fails closed
rather than being attempted. That is enforced at the control boundary, not
merely instructed — see [`./09-agent-control.md`](./09-agent-control.md).

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

Every secret Ensemblr stores goes into the **macOS Keychain**, written through
`/usr/bin/security` under the service name `dev.ensemblr.app.secret-store`
([ADR 0018](../adr/0018-use-keychain-for-secrets.md)). Nothing secret is written
to `~/.config/ensemblr/config.json`, to the local database, or to the committed
`.ensemblr/settings.toml`.

A secret is bound to one of three scopes:

| Scope | Applies to |
| --- | --- |
| `app` | everything you do in Ensemblr |
| `repository` | one project |
| `workspace` | one workspace |

Only the key name, its scope, and its masked display state are kept outside the
Keychain, so the app can list your secrets without reading them.

Two credentials are deliberately **not** Ensemblr's:

- **GitHub tokens belong to `gh`.** They are never copied into Ensemblr's
  Keychain entries.
- **Pi's provider credentials stay in the Pi user environment**, where Pi put
  them. Ensemblr duplicates none of it unless you explicitly configure an
  Ensemblr-owned secret of your own.

## See also

- [`./02-requirements.md`](./02-requirements.md) — what has to be installed
  before any of this works.
- [`./11-app-settings.md`](./11-app-settings.md) — the Integrations,
  Environment, and Git settings sections.
- [`./14-troubleshooting.md`](./14-troubleshooting.md) — what to do when a check
  fails or a connection drops.
- [`../../CONTEXT.md`](../../CONTEXT.md) — the vocabulary this guide uses.
