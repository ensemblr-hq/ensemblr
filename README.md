<p align="center">
  <img alt="Ensemblr" src="./apps/desktop/assets/wordmark.gif" width="588">
</p>

# Ensemblr™

**A desktop orchestrator for multi-agent coding work, driving the Pi CLI or the Claude Code CLI — whichever
you already run.**

This is the Ensemblr monorepo. The app itself — what it does, how to install it, and its documentation — lives
in [`apps/desktop/`](./apps/desktop). Start with its [README](./apps/desktop/README.md).

## Install

- **macOS** (Apple silicon or Intel): `brew install --cask ensemblr-hq/tap/ensemblr`, or download the `.dmg`
  from the [latest release](https://github.com/ensemblr-hq/ensemblr/releases/latest).
- **Linux** (x86-64): `curl -fsSL https://www.ensemblr.dev/install.sh | sh`, or take the `.AppImage` from the
  [latest release](https://github.com/ensemblr-hq/ensemblr/releases/latest).
- **NixOS**: `nix run github:ensemblr-hq/ensemblr`.

The [install guide](./apps/desktop/docs/guide/01-install.md) covers requirements, channels, and building from
source.

## Repository layout

| Path | What lives there |
| --- | --- |
| [`apps/desktop/`](./apps/desktop) | Ensemblr, the Electron desktop app: source, tests, docs, JSON Schemas, packaging, changelog. |
| [`apps/website/`](./apps/website) | The marketing and documentation site. Not started yet. |
| [`packages/shared/`](./packages/shared) | Code the apps share, such as UI pieces lifted out of the desktop app. Not started yet. |

The root holds only what every workspace shares: the Bun workspace manifest and lockfile, the toolchain pins,
the house Biome config, CI, agent tooling, the Nix flake entrypoint, and the community files.

## Development

Node **24.x** and [Bun](https://bun.sh) 1.4 — `mise install` sets up both. Bun installs packages and runs
scripts; Node stays the runtime.

```bash
bun install          # every workspace, from one lockfile
bun run check        # lockfile check, Biome, then every workspace's own checks
bun run typecheck    # every workspace's type check
bun run test         # every workspace's tests

cd apps/desktop
bun run dev          # the desktop app
```

[`CONTRIBUTING.md`](./CONTRIBUTING.md) covers how to propose a change and which gates must pass;
[`AGENTS.md`](./AGENTS.md) holds the repository's binding policies. Security reports go to
[`SECURITY.md`](./SECURITY.md), never to a public issue.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). Copyright 2026 Philipp Soldunov. Bundled
third-party components and their licenses are listed in [`NOTICE`](./NOTICE).

Ensemblr™ is a trademark of Philipp Soldunov; the license does not grant use of the name or logo. See
[Trademark](./apps/desktop/README.md#trademark).
