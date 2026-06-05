# 0003. Preserve the Pi User Environment

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble should make the user's existing Pi setup work the same way it works in the Pi CLI. The user's skills, extensions, prompt templates, themes, packages, model configuration, credentials, settings, project `.pi` files, context files, and saved sessions should not need to be imported, duplicated, or reconfigured for Ensemble.

Pi's default agent directory is `~/.pi/agent`, unless overridden by `PI_CODING_AGENT_DIR`. Pi also loads project-local resources and context files based on the process current working directory.

## Decision

Ensemble will preserve the Pi user environment as the compatibility baseline.

For the current v1 Pi CLI RPC integration, Ensemble will launch the selected Pi-compatible executable from the workspace directory with normal resource discovery enabled:

```bash
pi --mode rpc
```

Ensemble will not redirect Pi's agent directory, disable resource discovery, or reinterpret Pi's configuration files by default.

Compatibility requirements:

- Use the workspace path as process `cwd`.
- Preserve the user's shell-derived environment where practical.
- Do not set an Ensemble-specific `PI_CODING_AGENT_DIR` by default.
- Do not disable extensions, skills, prompts, themes, tools, sessions, or context file loading by default.
- Allow the selected executable to be the standard `pi`, a wrapper, or another compatible launcher such as `oh-my-pi`.

Any option that changes Pi resource discovery must be visible to the user and opt-in.

## Alternatives Considered

### Import Pi configuration into Ensemble

Ensemble could copy or parse `~/.pi/agent` configuration and store an app-specific version. This is rejected because it would drift from Pi, create sync problems, and make Ensemble responsible for interpreting Pi's configuration semantics.

### Use an Ensemble-specific agent directory

Ensemble could set `PI_CODING_AGENT_DIR` to isolate app state. This is rejected as the default because it would prevent the user's existing `~/.pi/agent` resources from working automatically.

### Disable Pi resource discovery and rebuild it in Ensemble

Ensemble could selectively load skills, extensions, prompts, themes, and context files through its own UI. This is rejected as the default because it would make Ensemble a partial Pi reimplementation and would weaken compatibility with the Pi CLI.

## Consequences

- Existing Pi credentials, settings, models, packages, extensions, skills, prompts, themes, and sessions remain the source of truth.
- Workspaces must use the correct `cwd` so project `.pi` resources and context files resolve as they do in the CLI.
- Runtime compatibility depends on the selected executable supporting Pi's CLI RPC contract.
- Compatibility tests should compare Ensemble behavior against the same selected executable run manually from the workspace.
- Future SDK sidecar pivots are valid only if they preserve this compatibility contract.
