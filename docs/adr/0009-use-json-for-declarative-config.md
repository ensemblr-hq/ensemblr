# 0009. Use JSON for Declarative Config

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble will support declarative user-managed configuration under `~/.config/ensemble/`. The format needs to be easy to validate, version, load from TypeScript, and manage with external tools.

Potential formats include JSON, TOML, and YAML.

## Decision

Ensemble will use JSON for declarative configuration.

Primary config path:

```text
~/.config/ensemble/config.json
```

Ensemble should provide a JSON Schema for this file once the first configuration surface is implemented.

## Alternatives Considered

### TOML

TOML is pleasant for hand-written configuration and common in developer tools, but JSON has simpler first-party TypeScript support and cleaner schema validation.

### YAML

YAML is flexible and readable, but its parsing edge cases and implicit typing are unnecessary for Ensemble's configuration needs.

## Consequences

- Config can be parsed without extra format dependencies.
- JSON Schema can provide editor autocomplete and validation.
- Comments are not supported in strict JSON, so documentation and examples must be clear.
- If comments become important, Ensemble can later support JSONC explicitly, but the accepted format remains JSON.
