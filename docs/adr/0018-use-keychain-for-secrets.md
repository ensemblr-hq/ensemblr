# 0018. Use macOS Keychain for Secrets

Date: 2026-06-04

## Status

Accepted

## Context

Piductor settings include environment variables, optional integration credentials, provider/account metadata, and future tokens. Declarative config and SQLite are not appropriate places for raw secrets.

Piductor is a macOS app, and macOS Keychain is the native protected store for local application secrets.

## Decision

Piductor will store secret values in macOS Keychain from the start.

SQLite may store secret metadata such as key names, scopes, masked display state, and references to Keychain items. `~/.config/piductor/config.json`, `piductor.json`, and `conductor.json` must not store raw secret values by default.

Secrets include:

- Environment variable values marked secret.
- Optional GitHub tokens if direct API support is later added.
- Optional Linear tokens if direct integration requires them.
- Any Piductor-owned provider or account tokens.

Pi-owned secrets remain in the Pi user environment where Pi stores them. Piductor should not duplicate Pi provider secrets unless a user explicitly configures a Piductor-specific secret.

## Consequences

- Piductor avoids writing secrets to plain JSON or SQLite.
- The app needs a Keychain access abstraction in Electron main.
- Export/import and declarative config flows must distinguish secret references from secret values.
- Tests need a mock secret store.
