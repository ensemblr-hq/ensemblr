# 0014. Use a Conductor-Style Setup Gate

Date: 2026-06-04

## Status

Accepted

## Context

Conductor checks setup before users create workspaces or run agents. Public docs describe checks for GitHub authentication in the terminal environment and at least one authenticated agent provider.

Ensemblr targets Conductor parity and uses a selected Pi-compatible CLI executable as the agent runtime. Ensemblr also requires a local SQLite database, a managed root directory, git, shell/process execution, GitHub CLI, Linear OAuth for Linear workflows, and Pi RPC readiness.

## Decision

Ensemblr will use a Conductor-style setup gate adapted for Pi CLI RPC.

Required v1 checks:

- Git is installed and runnable.
- `gh` CLI is installed and `gh auth status` succeeds.
- A Pi-compatible executable is discoverable or explicitly configured.
- The selected executable can report version/help information where supported.
- The selected executable can start `--mode rpc` from a test workspace and produce valid JSONL RPC behavior.
- Pi provider/model readiness can be verified through Pi-compatible commands or a safe RPC smoke test where practical.
- Ensemblr root directory exists or can be created.
- `repos/`, `workspaces/`, and `archived-contexts/` exist or can be created under the root.
- SQLite database opens and migrations run.
- Electron can launch shell/process commands with the expected environment.

The app is not considered ready until required checks pass. Each failed check must show a concrete remediation path. Linear OAuth is required for Linear issue workflows but should not block local/GitHub-only flows unless the user chooses a Linear action.

## Alternatives Considered

### Let users enter the app with warnings

This would reduce first-run friction, but it diverges from Conductor's setup model and would produce confusing failures later in workspace creation, PR flow, or Pi session startup.

### Embedded Pi SDK readiness checks

This was accepted in ADR 0005 but superseded by ADR 0025. Ensemblr should validate the selected executable and RPC contract for v1, not SDK importability.

## Consequences

- Ensemblr's first-run experience closely matches Conductor's prerequisite model.
- Setup checks become a reusable diagnostics surface for troubleshooting.
- The implementation needs stable check identifiers, statuses, remediation copy, and logs.
- The setup gate must support executable override for users who want a wrapper or alternate launcher such as `oh-my-pi`.
