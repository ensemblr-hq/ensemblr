# 0005. Use Embedded Pi SDK for V1

Date: 2026-06-04

## Status

Superseded by [0025. Use Pi CLI RPC with Executable Discovery](./0025-use-pi-cli-rpc-with-executable-discovery.md)

## Context

Ensemblr needs a Pi-native agent experience with structured events, session control, model control, tool/result visibility, and a path to richer UI around Pi features. The original runtime direction was to launch the user's installed `pi --mode rpc` process. That maximized parity with the terminal CLI but constrained Ensemblr to the public RPC surface and required users to install Pi separately.

The Pi SDK can create sessions with an explicit workspace `cwd` and agent directory. Using Pi's `getAgentDir()` preserves the normal `~/.pi/agent` location unless the user has intentionally overridden it with `PI_CODING_AGENT_DIR`. `DefaultResourceLoader` can discover the user's extensions, skills, prompt templates, themes, and context files using the workspace `cwd` and agent directory.

## Historical Decision (Superseded)

This ADR previously selected embedded SDK for v1. ADR 0025 supersedes this with Pi CLI RPC and executable discovery.

Under this historical decision, Ensemblr v1 would embed `@earendil-works/pi-coding-agent` in the Electron main process as the initial Pi runtime boundary.

The SDK integration must preserve the Pi user environment by default:

- Use the workspace path as `cwd`.
- Use `getAgentDir()` for the Pi agent directory.
- Use Pi's normal auth, model, settings, resource, and session discovery paths.
- Do not set an Ensemblr-specific `PI_CODING_AGENT_DIR` by default.
- Do not disable extensions, skills, prompts, themes, or context file loading by default.

The application code will still define a `PiAgentClient` boundary so the runtime can pivot later:

- Up to an SDK sidecar if process isolation becomes necessary.
- Down to `pi --mode rpc` if exact system-CLI parity or runtime version matching becomes more important.

## Alternatives Considered

### CLI RPC subprocess

Launching `pi --mode rpc` uses the exact executable the user runs in the terminal and provides strong process isolation. It is deferred because Ensemblr wants deeper SDK control in v1 and does not want first-run success to require a separately installed Pi executable.

### SDK sidecar

A sidecar process importing the Pi SDK would preserve SDK control while isolating crashes, memory leaks, and extension execution from Electron's main process. It is deferred because it adds a custom process protocol and packaging complexity before the product boundary is proven.

### Managed system Pi installer

Ensemblr could detect or install a system `pi` executable and then use CLI RPC. This was previously accepted in ADR 0004 but is superseded by the embedded SDK decision.

## Historical Consequences (Superseded)

- Ensemblr can offer a richer Pi-native UI earlier because it has direct SDK access.
- Users do not need a separately installed `pi` executable for v1 agent sessions.
- Ensemblr owns the Pi SDK version it ships with, so the embedded runtime may differ from a user's terminal `pi` version.
- Pi extensions and packages may execute inside Electron's main process, so the implementation must treat this as a risk and keep the runtime boundary easy to move to a sidecar.
- The app must test that SDK-loaded resources from `~/.pi/agent` behave like the Pi CLI for representative skills, extensions, prompts, themes, auth, models, settings, sessions, and project context files.
