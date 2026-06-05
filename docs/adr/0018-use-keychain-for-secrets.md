# 0018. Use macOS Keychain for Secrets

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble settings include environment variables, optional integration credentials, provider/account metadata, and future tokens. Declarative config and SQLite are not appropriate places for raw secrets.

Ensemble is a macOS app, and macOS Keychain is the native protected store for local application secrets.

## Decision

Ensemble will store secret values in macOS Keychain from the start.

SQLite may store secret metadata such as key names, scopes, masked display state, and references to Keychain items. `~/.config/ensemble/config.json`, `ensemble.json`, and `conductor.json` must not store raw secret values by default.

Secrets include:

- Environment variable values marked secret.
- Optional GitHub tokens if direct API support is later added.
- Optional Linear tokens if direct integration requires them.
- Any Ensemble-owned provider or account tokens.

Pi-owned secrets remain in the Pi user environment where Pi stores them. Ensemble should not duplicate Pi provider secrets unless a user explicitly configures an Ensemble-specific secret.

## Consequences

- Ensemble avoids writing secrets to plain JSON or SQLite.
- The app needs a Keychain access abstraction in Electron main.
- Export/import and declarative config flows must distinguish secret references from secret values.
- Tests need a mock secret store.
