<!-- TODO: Purge from git history when v1 is live -->
# Ensemblr

Ensemblr is a macOS workbench for running coding-agent work in isolated project workspaces. It borrows the workspace-and-review operating model from Conductor. **Pi** and **Claude Code** are its two first-class agent runtimes, each driving native chat tabs behind one adapter contract; third-party CLIs also run alongside them as terminal harnesses, and a permission-gated control surface lets agents drive the app itself.

## Language

**Ensemblr**:
The product being built: a native desktop application for managing coding-agent work across projects and workspaces.
_Avoid_: Conductor clone, Pi Conductor

**Ensemblr Root Directory**:
The user-visible directory where Ensemblr stores managed repositories, workspaces, and archived workspace context.
_Avoid_: App support directory, project folder

**Conductor Parity Target**:
The product goal that Ensemblr should match Conductor's publicly observable workflows and capabilities, except where runtime-specific behavior requires a different implementation.
_Avoid_: Copying Conductor, visual clone

**Project**:
A tracked codebase that Ensemblr can open, configure, and use as the source for isolated workspaces.
_Avoid_: Repo entry, app folder

**Workspace**:
An isolated project copy for one stream of work, with its own branch, working tree, agent sessions, local run state, and review path.
_Avoid_: Tab, chat, copy

**Workspace Task**:
The unit of work assigned to a workspace, such as a feature, bug fix, experiment, pull request, GitHub issue, or Linear issue.
_Avoid_: Prompt, request, job

**Agent Runtime**:
A coding agent Ensemblr drives natively in a chat tab — Pi or Claude Code — with its own executable discovery, readiness probe, model catalogue, and reasoning ladder (Pi steers _thinking_, Claude steers _effort_). A session is pinned to one runtime for its lifetime.
_Avoid_: Provider (that names the inference vendor a model is served by), model, backend

**Agent Session**:
A saved coding-agent conversation associated with a project or workspace, pinned to the runtime that opened it.
_Avoid_: Chat, terminal session, Pi session

**Pi User Environment**:
The user's existing Pi configuration and resources, including credentials, model configuration, settings, packages, extensions, skills, prompt templates, themes, context files, and saved sessions.
_Avoid_: Ensemblr config, imported Pi settings

**Harness**:
A third-party coding-agent CLI — Claude Code, OpenAI Codex, or Mistral Vibe — that Ensemblr launches in a workspace terminal tab, with auto-approve flags and exact-conversation resume. Claude Code is both: the harness is its terminal surface, the agent runtime is its native chat tab.
_Avoid_: Plugin, integration, model

**Session Branch**:
A branch within an agent session's history that lets a user fork from an earlier conversation point without losing the rest of the session history.
_Avoid_: Git branch, forked workspace

**Plan Mode**:
A per-chat mode that holds an agent to planning until the user approves what it proposes, enforced per tool call at the control channel rather than by instruction, and inherited by spawned sub-agents.
_Avoid_: Read-only mode, dry run

**Ensemblr Control**:
The permission-gated control surface that lets an agent running inside a workspace drive Ensemblr itself — spawn conversations, launch harnesses, run terminals, focus panels, read the diff and leave or resolve review comments, ask the user a question, and move the workspace across the board — through the `ensemblr_*` tools.
_Avoid_: Agent API, automation, remote control

**Orchestrator / Sub-agent**:
Roles in multi-agent work. The orchestrator is the root agent (lineage depth 0) that may delegate; a sub-agent is a spawned child that does its delegated unit of work itself and never delegates onward.
_Avoid_: Master/worker, parent/child thread

**Base Branch**:
The branch a workspace diffs against and opens pull requests into. It is the merge target only, distinct from the branch the workspace owns — which it may have cut fresh or taken over from an existing branch or pull-request head — and can be retargeted without touching the worktree.
_Avoid_: Fork point, source branch, upstream

**Run Script**:
A named command a repository declares under `[scripts.run.<name>]` in `.ensemblr/settings.toml` for running the project. A repository may declare several; one is the default that the dock's Run button and ⌘R target.
_Avoid_: Task, npm script, dev server

**Review Flow**:
The process of inspecting workspace changes, running checks, resolving merge conflicts, creating a pull request, merging accepted work, or archiving rejected work.
_Avoid_: Diff screen, done state
