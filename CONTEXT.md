<!-- TODO: Purge from git history when v1 is live -->
# Ensemblr

Ensemblr is a macOS workbench for running coding-agent work in isolated project workspaces. It borrows the workspace-and-review operating model from Conductor. **Pi** is its first-party agent runtime; third-party harnesses (Claude Code, Codex, Vibe) run alongside it, and a permission-gated control surface lets agents drive the app itself.

## Language

**Ensemblr**:
The product being built: a native desktop application for managing coding-agent work across projects and workspaces.
_Avoid_: Conductor clone, Pi Conductor

**Ensemblr Root Directory**:
The user-visible directory where Ensemblr stores managed repositories, workspaces, and archived workspace context.
_Avoid_: App support directory, project folder

**Conductor Parity Target**:
The product goal that Ensemblr should match Conductor's publicly observable workflows and capabilities, except where Pi-specific behavior requires a different implementation.
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

**Pi Session**:
A saved Pi coding-agent conversation associated with a project or workspace.
_Avoid_: Chat, terminal session

**Pi User Environment**:
The user's existing Pi configuration and resources, including credentials, model configuration, settings, packages, extensions, skills, prompt templates, themes, context files, and saved sessions.
_Avoid_: Ensemblr config, imported Pi settings

**Harness**:
A third-party coding-agent CLI — Claude Code, OpenAI Codex, or Mistral Vibe — that Ensemblr launches in a workspace terminal tab alongside first-party Pi, with auto-approve flags and exact-conversation resume.
_Avoid_: Plugin, integration, model

**Session Branch**:
A branch within Pi's tree-structured session history that lets a user continue from an earlier conversation point without losing the rest of the session history.
_Avoid_: Git branch, forked workspace

**Ensemblr Control**:
The permission-gated control surface that lets an agent running inside a workspace drive Ensemblr itself — spawn conversations, launch harnesses, run terminals, focus panels, and move the workspace across the board — through the `ensemblr_*` tools.
_Avoid_: Agent API, automation, remote control

**Orchestrator / Sub-agent**:
Roles in multi-agent work. The orchestrator is the root agent (lineage depth 0) that may delegate; a sub-agent is a spawned child that does its delegated unit of work itself and never delegates onward.
_Avoid_: Master/worker, parent/child thread

**Review Flow**:
The process of inspecting workspace changes, running checks, creating a pull request, merging accepted work, or archiving rejected work.
_Avoid_: Diff screen, done state
