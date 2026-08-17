# 0053. Ship A Bundled Ensemblr Skill To Both Runtimes

Date: 2026-08-17

## Status

Accepted

Extends [ADR 0040](0040-use-loopback-control-server-for-agent-app-control.md),
which stands: the control server is still how an agent drives the app, and the
playbook is still injected into every session. This ADR adds a second channel
beside it.

## Context

Everything an agent knows about Ensemblr arrives through one channel: the
playbook in `src/shared/agent-control/awareness.ts`, injected into every
session's system prompt. That channel is always-on, so its cost is paid on every
turn of every session, which has kept it to tool etiquette and nothing else.

The consequence is a gap the playbook cannot close. An agent asked to add a
dev-server run script does not know `.ensemblr/settings.toml` exists, that
`[scripts.run.<name>]` needs a `command`, that `icon` is drawn from a closed list
of 57 names, or that a `#:schema` directive belongs on line 1. It guesses, and a
guessed key in a committed file type-checks as a diagnostic nobody reads. The
same holds for the worktree model, the failure vocabulary, and the argument
naming conventions.

Putting any of that in the playbook means paying for it on every turn, including
the overwhelming majority of turns that never touch a config file.

Both first-class runtimes have since grown the mechanism built for exactly this
shape of content. Pi implements the [Agent Skills standard](https://agentskills.io/specification)
and loads skills from `--skill <path>`; Claude Code loads skills from a local
plugin, named as `plugins` in the Agent SDK and `--plugin-dir` on the CLI. In
both, only the skill's name and description sit in context — the body is read on
demand.

## Decision

**Ensemblr ships one Agent Skill inside its own app package, and every runtime
loads it per launch.**

The bundle is `resources/agent-skills/`, packaged through `extraResource` and
resolved by `src/main/agent-skills/`. It is shaped as a Claude Code plugin whose
inner skill directory Pi loads directly, because the two layouts nest rather than
conflict:

```
resources/agent-skills/
├── .claude-plugin/plugin.json       ← manifest only; components live at root
└── skills/ensemblr/
    ├── SKILL.md
    └── references/{control-tools,settings-toml,workspaces-and-git}.md
```

One directory, three flags:

| Runtime | How it loads |
| --- | --- |
| Pi (`pi --mode rpc`) | `--skill <bundle>/skills/ensemblr` |
| Native Claude (Agent SDK) | `plugins: [{ type: 'local', path: <bundle> }]` |
| Claude harness (TUI) | `--plugin-dir <bundle>` |

**The playbook keeps everything it had, and gains a pointer.** The skill is
additive: a skill is loaded on demand and the model may decline to load it, so
nothing that is guaranteed today may move into it. The playbook names the skill
so an agent is *told* where to look rather than left to infer it from a
description.

**Nothing is installed into the user's environment.** No write into the
workspace's `.claude/skills` — which would show up in the Changes panel as the
agent's own diff — and none into `~/.claude/skills` or `~/.pi/agent/skills`,
which would leak into every session the user runs outside Ensemblr and survive
uninstall.

**A missing bundle degrades to today's behaviour.** `resolveAgentSkillBundle`
returns nulls, every flag is dropped, and the session opens unchanged. A
documentation file is never worth failing a launch over.

Every playbook therefore names the skill *conditionally*. `awareness.ts` builds
one static string per role and cannot see whether a bundle resolved, so a
sentence promising the skill *is* loaded would be false on exactly the path
above — a session told to read a reference it does not hold. Phrased as a
conditional, each pointer reads as a fact where it is one and as silence where
it is not.

## Consequences

The skill is a second place that describes surfaces the code owns, so it can
drift. `tests/main/agent-skill-bundle.test.ts` holds it to them: every
`ensemblr_*` tool it names must exist in `AGENT_CONTROL_OPS`, and every
`settings.toml` key it names must exist in `schemas/settings.schema.json`. That
is the same stance `tests/main/published-schemas.test.ts` takes toward the
published schemas.

Both slash-command listers name the bundle as well as the session path
(`additionalSkillPaths` for Pi's `DefaultResourceLoader`, `plugins` for Claude's
discovery query). Discovery runs its own resource loader, so without this the
skill would load at runtime yet be absent from the composer's `/skill:` catalogue
— working and invisible, which is the worst of both.

The Agent SDK's sibling `skills` option stays unset. It is a context filter, not
a switch: naming ours would hide every skill the user already has.

**Codex and Vibe get nothing.** Codex plugins use their own manifest format and
Vibe exposes no skill surface. `HARNESS_AWARENESS` is written for all three
harnesses at once, so its conditional pointer is load-bearing rather than
defensive: without it a Codex session would go hunting for a skill it will never
find. Codex already receives no additive instructions channel at all, so this
changes nothing for it.

Adding a second skill later is a directory beside `skills/ensemblr/` and an entry
in `plugin.json`; Pi would need its own `--skill` flag, which is the one place the
two layouts stop being free.
