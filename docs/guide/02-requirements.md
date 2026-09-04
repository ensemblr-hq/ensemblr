# Requirements

Ensemblr does not ask you to trust a checklist. It ships setup checks that probe
the machine directly — fifteen on macOS, sixteen on Linux — and this page is that
list. Every row below is
a check the app runs, in the order it runs them, with the fix it offers when the
check fails.

You can see the same list at any time in **Settings → Diagnostics**.

![Settings → Diagnostics, with the core-runtime and storage checks listed under a green rollup and shell environment resolution reporting a warning with its retry action.](./images/02-settings-diagnostics.png)

## Short answer

You need three things on the machine:

| | |
| --- | --- |
| **git** | Every workspace is a git worktree. |
| **gh**, authenticated | Branch, pull request, review, and merge workflows shell out to the GitHub CLI. |
| **`pi` or `claude`** | At least one agent runtime. Either one alone is enough — see [The either-or gate](#the-either-or-gate). |

Plus macOS Ventura or later on Apple silicon, or Linux on x86-64. Everything
else on this page Ensemblr either provides, creates, or treats as optional.

## The checks

**Fifteen on macOS, sixteen on Linux** — the keyring check below exists only
where the secret store depends on one.

Statuses are `success`, `warning`, `failure`, and the two in-flight states
`pending` and `running`. **A `warning` counts as passing** — it marks a degraded
but usable result, such as a Pi binary that runs while its version probe needs
attention. A check at `warning` never holds a gate closed.

Actions labelled *copy* place a command on the clipboard; Ensemblr never runs a
command on your behalf. Actions labelled *open* navigate to a settings screen or
open a URL in your browser. Every check also offers a plain retry.

| # | Check | Requires | On failure, the app offers | Blocks? |
| --- | --- | --- | --- | --- |
| 1 | Declarative config | `~/.config/ensemblr/config.json` parses, if it exists | Open config diagnostics | yes |
| 2 | SQLite database | The app-support database opens and its migrations completed | Retry only | yes |
| 3 | Root directory | The configured root resolves, exists, and is writable | Choose another root | yes |
| 4 | Managed directories | `repos/`, `workspaces/`, `archived-contexts/` present and writable under the root | Retry only | yes |
| 5 | Shell and process launch | Ensemblr can run a command through your login shell | Retry only | yes |
| 6 | Secret storage — **Linux only** | A keyring daemon (gnome-keyring or KWallet) answers, so `safeStorage` encrypts rather than obfuscates | Retry only | no |
| 7 | Environment variables | Every variable you marked required is set | Open environment settings | only if you marked one required |
| 8 | Git executable | `git --version` succeeds | macOS: copy `xcode-select --install`; open <https://git-scm.com/download/mac>. Linux: open <https://git-scm.com/download/linux> | yes |
| 9 | GitHub CLI installed | `gh --version` succeeds | open <https://cli.github.com/> | yes |
| 10 | GitHub CLI authenticated | `gh auth status --hostname github.com --active` succeeds | copy `gh auth login --hostname github.com` | yes |
| 11 | Pi executable | A Pi-compatible binary resolves | Select Pi executable | gated |
| 12 | Pi agent directory | Pi's agent directory resolves and is readable | Retry only | gated |
| 13 | Pi RPC startup | `pi --mode rpc` starts and emits a valid JSONL frame | Select Pi executable | gated |
| 14 | Pi provider and model readiness | `pi --list-models` returns providers and models | Open Pi provider settings | gated |
| 15 | Claude Code executable | A `claude` binary resolves | copy `curl -fsSL https://claude.ai/install.sh \| bash`; open <https://code.claude.com/docs/en/setup>; Select Claude Code executable | gated |
| 16 | Linear connection | A live Linear OAuth session | Open integration settings | no |

On macOS the keyring row is absent and the numbering closes up, because there is
nothing to report: the Keychain is reached directly and surfaces its own
failures, so the row would be a permanently green no-op.

Checks 1–7 are about Ensemblr's own state. Ensemblr creates the config file,
the database, the root directory, and the three managed subdirectories itself —
they appear on the list because a failure there is worth naming, not because
you have to set them up.

A few details the table compresses:

- **Declarative config** passes when the file is *missing* as well as when it
  parses; a missing file means built-in defaults are active.
- **Shell and process launch** reports `warning` rather than `success` when
  Ensemblr had to fall back to a synthesised environment instead of reading
  your shell's. Commands still run.
- **Secret storage** never blocks and never fails — a Linux session with no
  keyring daemon still runs, it just obfuscates stored secrets instead of
  encrypting them, and you are told rather than stopped. Start gnome-keyring or
  KWallet and restart Ensemblr to upgrade the backend.
- **Git executable** offers remediation matched to the platform. macOS gets
  `xcode-select --install` alongside the git-scm macOS download page; Linux gets
  the git-scm Linux download page on its own, because no single package-manager
  command is right across apt, dnf, pacman, and zypper. Both offer a retry. The
  message naming the Xcode command-line tools is macOS-only too — elsewhere the
  check just tells you to install Git.
- **Environment variables** ships with no required variables, so it does not
  block by default. It becomes blocking the moment you mark one required.
- **Pi RPC startup** runs in a managed throwaway workspace, not in one of your
  projects.
- **Pi agent directory** resolves from `PI_CODING_AGENT_DIR` when that is set,
  and from Pi's default location otherwise. Ensemblr reads it; it does not
  redirect Pi's resource discovery.

## The either-or gate

**You do not need both Pi and Claude Code. Either one alone satisfies setup.**

This is the single most misunderstood part of Ensemblr's requirements, so it is
worth being precise about how the gate works.

Ensemblr groups the runtime checks by runtime:

| Runtime | Checks in its group |
| --- | --- |
| Claude Code | `claude-executable` |
| Pi | `pi-executable`, `pi-agent-directory`, `pi-rpc`, `pi-provider-model` |

A group is satisfied when **every** check inside it passes. The gate is
satisfied when **any** group is satisfied. The consequences:

- **Claude Code installed, Pi absent** → the Claude group is satisfied, so the
  gate is open. All four Pi checks are demoted to optional. They still show as
  failing in Diagnostics, and they no longer block anything: a broken install of
  a runtime you never chose is not the app's problem.
- **Pi installed and working, Claude absent** → the Pi group is satisfied, the
  gate is open, and `claude-executable` is demoted to optional.
- **Both working** → both groups satisfied, nothing blocks.
- **Neither working** → *every* runtime check is promoted to blocking. Ensemblr
  genuinely cannot open a chat, and either runtime would fix it, so neither
  should read as merely optional.

Note the asymmetry: Claude Code needs one check to pass, Pi needs four. That is
not favouritism — Ensemblr drives Claude Code through an SDK against your own
binary, so discovering that binary is the whole story, while Pi is spawned as an
RPC process whose startup and model catalogue are each worth probing separately.

The first-run wizard applies a slightly looser version of the same rule: its
**Agent CLI** step passes as soon as either `pi-executable` or
`claude-executable` passes, without waiting on Pi's three deeper checks. So the
wizard can wave you through on a Pi install whose RPC startup later fails.
Diagnostics is the stricter of the two, and it is where the real answer lives.

## Optional: terminal harness CLIs

Ensemblr can also launch third-party coding-agent CLIs in a workspace terminal
tab. These are **not** setup checks and never block anything — each appears in
the harness menu only when its binary is found on `PATH`, and is silently absent
otherwise.

| Harness | Binary |
| --- | --- |
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Mistral Vibe | `vibe` |

`claude` therefore does double duty: as a first-class agent runtime driving a
native chat tab, and as a terminal harness running its own TUI. The two are
deliberately separate code paths with different permissions —
[`../harnesses.md`](../harnesses.md) covers the distinction and the launch flags
in full.

Install and authenticate each harness from its own vendor. Ensemblr manages none
of their credentials.

## Provider API keys

**Ensemblr itself needs no API key.** It calls no model provider. The runtimes
do, and they read their own credentials from their own configuration.

Ensemblr does keep a catalogue of environment variables it understands, visible
under **Settings → Environment**, so you can set one in one place rather than in
a shell profile. Provider keys in that catalogue:

`OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `GOOGLE_API_KEY` · `GEMINI_API_KEY` ·
`GROQ_API_KEY` · `MISTRAL_API_KEY` · `OPENROUTER_API_KEY` ·
`VERCEL_AI_GATEWAY_API_KEY`

Alongside them the catalogue carries `PI_CODING_AGENT_DIR`, the standard proxy
variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`), `DEBUG`, and
`CI`.

Setting a provider key here is an override, not a requirement. Pi-owned
credentials should stay in your Pi environment unless you deliberately want
Ensemblr to supply them.

## What Ensemblr stores, and what it does not

| Credential | Where it lives |
| --- | --- |
| GitHub | **Not stored.** Ensemblr shells out to `gh` and inherits whatever that CLI is authenticated as. |
| Claude Code | **Not stored.** You run `claude /login` yourself; the SDK uses your own binary's session. |
| Pi | **Not stored.** Pi keeps its own configuration and credentials. |
| Linear | OAuth token in the OS secret store — the macOS Keychain under service `dev.ensemblr.app.secret-store`, or on Linux `safeStorage` ciphertext held in `ensemblr.db`. |

The diagnostics bundle you can copy from **Settings → Diagnostics** redacts
secrets, account ids, and full paths before it reaches the clipboard, so it is
safe to paste into a bug report.

## Next

- [First run](./03-first-run.md) — the setup wizard walks these checks with you.
- [Troubleshooting](./14-troubleshooting.md) — what to do when a specific check
  is red.
- [Integrations](./10-integrations.md) — connecting GitHub and Linear.
