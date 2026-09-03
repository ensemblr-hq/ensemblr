# Ensemblr User Guide

How to install, set up, and use Ensemblr. If you want to *work on* Ensemblr
rather than use it, start at [`../onboarding.md`](../onboarding.md) and
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) instead.

Ensemblr runs on macOS with Apple silicon and on Linux with x86-64. You bring
your own agent CLI — Pi or Claude Code, one is enough — plus `git` and an
authenticated `gh`. It is pre-1.0, and this guide describes version
[`0.1.0-beta.24`](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.24).
The app itself ships in English, Russian, and Greek; this guide is English only.

Where the two platforms differ — the installer, the secret store, keyboard
shortcuts, and whether the app updates itself — the difference is called out
where it comes up rather than split into a second guide. Shortcuts are written
with the macOS glyphs (`⌘`, `⌥`); on Linux read `⌘` as `Ctrl` and `⌥` as `Alt`,
which is what the app itself displays there.

## Read in order

1. [**Install**](./01-install.md) — the Homebrew cask, the Linux install script, downloading the signed build, building it yourself, build channels, and where Ensemblr keeps its data.
2. [**Requirements**](./02-requirements.md) — every setup check the app runs, what each one needs, and why you need only *one* agent runtime.
3. [**First run**](./03-first-run.md) — the setup wizard, choosing a root directory, adding a project, creating your first workspace.
4. [**Concepts**](./04-concepts.md) — workspace, base branch, runtime versus harness, permission modes, the board. The vocabulary the rest of the guide uses.
5. [**Workspaces**](./05-workspaces.md) — creating, adopting versus cutting a branch, branch names, setup scripts, the board and its issue backlog, archiving.
6. [**Agents**](./06-agents.md) — Pi and Claude Code, models and reasoning levels, the Concierge, permission modes, plan mode, checkpoints, attachments.
7. [**Terminals and run scripts**](./07-terminals-and-run-scripts.md) — the dock, named run scripts, the ⌘R default, terminal harnesses.
8. [**Reviewing changes**](./08-reviewing-changes.md) — Files, Changes, Checks; review comments; opening and merging a pull request.
9. [**Agent control**](./09-agent-control.md) — what an agent can do to the app itself, and what it is refused.
10. [**Integrations**](./10-integrations.md) — GitHub, Linear (one account or several), Infisical, git, and what Ensemblr stores about each.
11. [**App settings**](./11-app-settings.md) — every settings pane and what it controls.
12. [**Repository settings**](./12-repository-settings.md) — the `.ensemblr/settings.toml` reference.
13. [**Keyboard shortcuts**](./13-keyboard-shortcuts.md) — every shortcut, by scope.
14. [**Troubleshooting**](./14-troubleshooting.md) — by symptom.

## If you just want to…

| You want to | Go to |
| --- | --- |
| Get it running on your Mac or your Linux box | [01](./01-install.md), then [02](./02-requirements.md) |
| Work out why the app will not let you in | [02](./02-requirements.md) and [14](./14-troubleshooting.md) |
| Understand what "workspace" means here | [04](./04-concepts.md) |
| Configure a repository for your team | [12](./12-repository-settings.md) |
| Add a run script | [07](./07-terminals-and-run-scripts.md), syntax in [12](./12-repository-settings.md) |
| Stop an agent doing something | [06](./06-agents.md) (permission modes, plan mode) |
| Ask one agent about all your projects at once | [06](./06-agents.md#the-concierge) (the Concierge) |
| Ship the work | [08](./08-reviewing-changes.md) |

## Elsewhere in the repository

- [`../../CONTEXT.md`](../../CONTEXT.md) — the product definition and the precise vocabulary this guide draws on.
- [`../agent-control.md`](../agent-control.md) — the full `ensemblr_*` tool reference, for writing agent prompts.
- [`../harnesses.md`](../harnesses.md) — the two first-class runtimes versus the terminal harnesses, with install and resume details.
- [`../build-and-release.md`](../build-and-release.md) — packaging, signing, notarization, channels.
- [`../adr/`](../adr) — the Architecture Decision Records behind most of the behaviour described here.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — what changed, release by release.

## A note on screenshots

Screenshots are captured against a finished build. Where a page carries an
`<!-- screenshot: … -->` marker, the image is not in place yet. A UI change that
invalidates a screenshot invalidates the page it sits on — update both.
