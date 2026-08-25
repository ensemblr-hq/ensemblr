# Ensemblr

Ensemblr is a macOS orchestrator for multi-agent coding work, driving the Pi CLI or the Claude Code CLI — **Pi** and **Claude Code** are its two first-class agent runtimes, each driving native chat tabs behind one adapter contract, and third-party CLIs run alongside them as terminal harnesses. A permission-gated control surface — **Ensemblr Control** — lets an agent drive the app itself: spawn sub-agents, delegate, wait on them, and integrate what they report. Isolation is what makes that safe rather than reckless: every stream of work gets its own worktree, branch, and review path, so a fan-out of agents cannot collide.

## Language

**Ensemblr**:
The product being built: a native desktop application for managing coding-agent work across projects and workspaces.
_Avoid_: Workspace manager clone, Pi wrapper

**Ensemblr Root Directory**:
The user-visible directory where Ensemblr stores managed repositories, workspaces, and archived workspace context.
_Avoid_: App support directory, project folder

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

**Concierge**:
The one agent that belongs to no workspace. It runs above every project, in a folder of its own
under the Ensemblr root, and can read across every workspace at once — but writes only inside that
folder, delegating any actual change to an orchestrator it spawns into the workspace that needs it.
Its memory is a directory of markdown files it searches and writes between conversations, since its
context does not survive a clear.
_Avoid_: Assistant, app agent, root agent (that names a per-workspace orchestrator)

**Artifact**:
A report or note the Concierge writes for you, under `artifacts/` in its own folder. It belongs to no
workspace and is not part of any repository, so it is addressed by its path relative to the Concierge
home and read in the panel's own reader rather than opened as a file tab.
_Avoid_: Output, document, deliverable, attachment (that names a file added to a prompt)

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

**Attachment**:
Anything the user pins into a composer draft as a chip — a workspace file or folder, a pasted image or long text block, a Linear or GitHub issue, a review-comment thread, a changed file's diff. Attachments form one ordered list, and the outgoing prompt carries each one at the position its chip sat in the sentence. A thing that exists on disk is attached by reference; a thing that does not — a diff, an issue — is written out as a document the chip points at.
_Avoid_: Upload, mention, context block

**Linked Directory**:
A read grant over a directory outside the workspace, held per chat, sticky across sends, and handed to the runtime when the session opens. It is a grant, not an attachment — nothing is copied or serialized, and symlinks are deliberately left unresolved.
_Avoid_: Mounted folder, external workspace

**Follow-Up Queue**:
The per-tab list holding messages the user sent while a turn was still running. It stays listed, reorderable, editable, and removable until it drains, rather than disappearing into a runtime frame nobody can read back.
_Avoid_: Message backlog, pending prompts

**Unread Mark**:
A record that agent activity landed in a chat the user was not reading. Marks are per chat, not per workspace, so reading one tab does not silence its siblings, and a mark is dropped once its chat becomes unreachable.
_Avoid_: Notification, badge

**Backlog Issue**:
A tracker issue on the dashboard board that no workspace has been started from yet — an unstarted Linear issue or an unassigned open GitHub issue. It sits in Backlog beside workspace cards; dragging it rightward is what creates the workspace. Nothing the board does is written back to the tracker.
_Avoid_: Ticket card, todo, task card

**Linked Issue**:
The tracker issue a workspace was created from, persisted on the workspace and surfaced to its agent as a standing block naming the issue and the moments the ticket is expected to move. It is what lets an agent keep the ticket current instead of the user asking for each transition by hand.
_Avoid_: Attached issue (that names a composer attachment), parent ticket

**Linear Account**:
One connected Linear organization. Several can be connected at once; each syncs independently, owns its cached issues, and keeps its tokens in the Keychain under its own account id. A read may merge accounts, a write is always scoped to exactly one, and an ambiguous target is refused rather than guessed.
_Avoid_: Linear connection, workspace (that is Linear's own word for an organization, and Ensemblr's for something else)

**Secrets Link**:
The binding between a repository and an Infisical project, split by sensitivity: the project half — instance URL, project id, environment, path — is committed to `.ensemblr/settings.toml`, while the Machine Identity that resolves it is per-machine state with its client secret in the Keychain. Values resolve live at every launch as an environment layer and are never materialized into the repository.
_Avoid_: Secret sync, vault import, secret store (that names Ensemblr's own Keychain-backed store)

**Agent Skill**:
The reference Ensemblr ships inside its own app bundle and hands to every agent it starts — the workspace and worktree model, the `ensemblr_*` tool surface, and every `.ensemblr/settings.toml` block. It is read on demand rather than held in context, which is what separates it from the playbook: the playbook is what an agent always knows, the skill is what it can look up. Nothing is installed into the user's repository or home directory.
_Avoid_: Prompt, system prompt, playbook (that names the always-in-context text), plugin

**Menu Command**:
A named action the native menu bar can invoke, defined once in `src/shared/menu-commands.ts`. The renderer owns the handler and reports which commands are live; the main process enables items from that report. A command with no registered handler renders as a disabled item.
_Avoid_: Menu item, shortcut, accelerator

**App Language**:
The language Ensemblr renders in — English, Russian, or Greek. It governs the window, the native menu bar, and the prose agents write back (replies, tab names, workspace summaries, review comments), which is steered by a language directive appended to every playbook rather than by a translated prompt.
_Avoid_: Locale, translation setting
