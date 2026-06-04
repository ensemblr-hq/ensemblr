# Piductor

Piductor is a Pi-native macOS workbench for running coding-agent work in isolated project workspaces. It borrows the workspace-and-review operating model from Conductor while using Pi as the agent runtime.

## Language

**Piductor**:
The product being built: a native desktop application for managing Pi coding-agent work across projects and workspaces.
_Avoid_: Conductor clone, Pi Conductor

**Piductor Root Directory**:
The user-visible directory where Piductor stores managed repositories, workspaces, and archived workspace context.
_Avoid_: App support directory, project folder

**Conductor Parity Target**:
The product goal that Piductor should match Conductor's publicly observable workflows and capabilities, except where Pi-specific behavior requires a different implementation.
_Avoid_: Copying Conductor, visual clone

**Project**:
A tracked codebase that Piductor can open, configure, and use as the source for isolated workspaces.
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
_Avoid_: Piductor config, imported Pi settings

**Session Branch**:
A branch within Pi's tree-structured session history that lets a user continue from an earlier conversation point without losing the rest of the session history.
_Avoid_: Git branch, forked workspace

**Review Flow**:
The process of inspecting workspace changes, running checks, creating a pull request, merging accepted work, or archiving rejected work.
_Avoid_: Diff screen, done state
