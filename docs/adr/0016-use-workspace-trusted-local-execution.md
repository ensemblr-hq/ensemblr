# 0016. Use Workspace-Trusted Local Execution

Date: 2026-06-04

## Status

Accepted

## Context

Conductor's documented security model is local execution: agents run on the user's Mac with access to files, terminals, and tools available to the user's account. Some actions may ask for approval before continuing. macOS may also prompt when protected locations are accessed. Enterprise data privacy disables features requiring external AI providers.

Ensemblr targets Conductor parity and launches a selected Pi-compatible CLI executable in RPC mode for v1. Pi can run tools, load packages/extensions/skills/prompts/themes from the user's Pi environment, and supports restricting tool availability through allowed/excluded tools. The desired default UX is that once the user creates or opens a workspace, the agent can work freely inside that workspace without constant approval prompts.

## Decision

Ensemblr will use a workspace-trusted local execution model by default.

Default behavior:

- A workspace is treated as the user's explicit trust boundary for a task.
- Pi agents may read, write, edit, search, and run commands from inside the workspace without per-action approval by default.
- Setup scripts, run scripts, terminals, and Pi tool execution run with the user's local account permissions.
- Ensemblr should avoid interrupting normal in-workspace coding with approval prompts.

Approval or warning boundaries:

- Writes or destructive operations targeting paths outside the workspace.
- Root directory changes, workspace archive/delete, repository removal, or shared-root migration.
- PR merge actions and other externally visible irreversible actions.
- Actions that modify Ensemblr app settings, `~/.config/ensemblr`, or Ensemblr's app database.
- Actions that modify Pi global configuration under `~/.pi/agent`, unless initiated through an explicit settings/config flow.
- Optional stricter modes selected by the user or repository policy.

Permission modes:

- `workspace-trusted`: default; broad freedom inside the workspace.
- `approval-required`: pauses before sensitive shell/file/tool actions where detectable.
- `read-only`: restricts Pi tools to read/search/list-style tools where Pi supports that restriction.

Security principles:

- Ensemblr must clearly communicate that agents run locally with the user's account permissions.
- macOS permission prompts may still appear when protected locations are accessed.
- Ensemblr must preserve Pi environment compatibility by default, including user skills/extensions/plugins/configuration from `~/.pi`.
- Enterprise data privacy must be supported at user and repository levels, following Conductor-compatible semantics where possible.

Implementation guardrails:

- Prefer Pi CLI/RPC-supported tool allowlists/exclusions for stricter modes where available.
- Keep the `PiAgentClient` boundary ready to move from CLI RPC to SDK sidecar if deeper control becomes necessary.
- Treat embedded extensions/packages as trusted as the user's Pi environment for v1, but document that they execute locally.
- Log sensitive actions and decisions for troubleshooting without exposing secrets.

## Alternatives Considered

### Approval-required by default

This would reduce risk but would interrupt normal coding work and diverge from the desired Conductor-like workspace experience.

### Full sandboxing in v1

A strict sandbox would reduce risk but would likely break Pi compatibility, local development workflows, and Conductor parity. It is deferred.

### Disable Pi extensions by default

This would improve isolation but violate the requirement that `~/.pi` skills/extensions/plugins/configuration work inside Ensemblr as they do in Pi.

## Consequences

- Ensemblr matches the expected Conductor-like ergonomics: agents can work freely in a workspace.
- The workspace boundary becomes security-critical and must be explained clearly.
- CLI RPC v1 improves process isolation versus embedded SDK, but Ensemblr still runs local commands and tools with the user's account permissions.
- Stricter permission modes remain available for sensitive repositories or review-only workflows.
