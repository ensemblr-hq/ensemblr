# 0019. Defer Piductor Account for V1

Date: 2026-06-04

## Status

Accepted

## Context

Conductor has account/integration surfaces in settings. Piductor's v1 target is local Conductor-style workflow parity adapted for Pi: local workspaces, Pi CLI RPC runtime, `gh` CLI auth, repository settings, review flow, and local app metadata.

A Piductor cloud account would require auth, backend services, account lifecycle, token storage, and product scope that is not needed for v1 local workflow parity.

## Decision

Piductor v1 will not require or implement a Piductor account/sign-in.

V1 is local-first and relies on external auth mechanisms where needed:

- `gh` CLI for GitHub.
- Pi user environment for Pi provider/model auth.
- Linear OAuth for first-class issue integration.
- Optional future integration-specific auth beyond Linear.

Any Piductor-owned app account, cloud sync, team features, billing, or hosted service integration is deferred. This does not defer external integration login such as Linear OAuth.

## Consequences

- Setup is simpler and local-first.
- Piductor does not need account token storage in v1.
- Settings should not include a required account section unless it is clearly marked as future/deferred.
- Features that require a backend are out of v1 scope.
