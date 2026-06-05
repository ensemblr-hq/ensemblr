# 0004. Use the System Pi Runtime with Guided Install

Date: 2026-06-04

## Status

Superseded by [0025. Use Pi CLI RPC with Executable Discovery](./0025-use-pi-cli-rpc-with-executable-discovery.md)

Supersession note: this ADR is retained for historical context only. ADR 0005 temporarily superseded it with embedded SDK. ADR 0025 is the current v1 runtime decision: Pi CLI RPC with executable discovery and optional override.

## Context

Ensemble should preserve the user's existing Pi environment so skills, extensions, prompt templates, themes, packages, settings, credentials, model configuration, project `.pi` files, context files, and sessions work the same way they work in the Pi CLI.

That compatibility is easiest when Ensemble launches the user's installed `pi` executable. The tradeoff is onboarding: new users may not already have Pi installed.

## Historical Decision (Superseded)

This ADR previously selected the user's installed/system Pi runtime as the v1 default. ADR 0025 returns to a process-based Pi runtime but replaces this ADR's install-first framing with executable discovery and override support.

Under that superseded approach, startup or first-session setup would have detected whether `pi` was available and runnable. If Pi was missing, Ensemble would have guided the user through installation instead of silently failing or bundling a separate runtime by default.

The historical installer behavior was:

- Prefer the user's detected `pi` executable.
- Let the user configure an explicit Pi executable path.
- Show the detected Pi version when available.
- Preserve the normal Pi user environment and do not redirect `PI_CODING_AGENT_DIR` by default.
- Treat managed/bundled Pi runtime support as a later optional feature, not the v1 default.

## Alternatives Considered

### Bundle Pi as the only runtime

Bundling Pi would simplify first launch but risks version drift, packaging complexity, and weaker compatibility with the user's normal CLI setup. It would make Ensemble feel like a separate Pi distribution rather than a controller around the user's Pi environment.

### Require users to install Pi manually

Requiring a manual install is simple for implementation but creates poor onboarding. Ensemble should detect the missing dependency and guide the user through installation.

### Managed Pi runtime in app support

Ensemble could install and update Pi inside its own app support directory. This may be useful later, especially for users who do not want global npm installs. It is deferred because it adds runtime update ownership and packaging complexity.

## Historical Consequences (Superseded)

These consequences no longer describe current v1 behavior. ADR 0025 replaces this install-first framing with Pi CLI RPC executable discovery.

- The historical default runtime behavior would have matched the user's normal Pi CLI behavior.
- First-run UX would have included Pi detection and missing-runtime guidance.
- The app would have needed to preserve PATH and shell-derived environment well enough to find `pi` as users expect.
- Settings would have supported overriding the Pi executable path.
- Compatibility testing would have compared the detected executable in Ensemble with manual `pi --mode rpc` execution from the same workspace.
