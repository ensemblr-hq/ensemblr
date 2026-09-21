# 0076. Adopt Bun Workspaces Without Moving the Desktop App

Date: 2026-09-21

## Status

Accepted

Builds on [0073](./0073-move-the-package-manager-from-npm-to-bun.md), which
made Bun 1.4.2 the package manager while keeping Node 24 as the runtime.

## Context

A website will live in this repository and needs to share React components with
the Electron renderer. The repository therefore needs package boundaries and one
lockfile, but the existing desktop package is deeply rooted at the checkout root:
Electron Forge, Vite, native `node-pty` rebuilding, release automation, assets,
and tests all resolve paths from there.

Moving the desktop application into `apps/desktop` would be a large relocation
whose main effect is path churn. It would also put the hoisted `node_modules`
layout behind Forge's package filters at risk without making shared components
more reusable.

Bun's workspace contract supports root `workspaces`, internal dependencies via
`workspace:*`, and filtered commands. The current official reference is
<https://bun.sh/docs/pm/workspaces>.

## Decision

Use the repository root as both the Bun workspace root and the Electron desktop
package.

- `apps/*` is reserved for additional deployable applications, beginning with the
  website once its framework and deployment target are chosen.
- `packages/*` contains runtime-neutral libraries.
- Internal consumers declare `workspace:*` dependencies.
- `packages/ui` is the first shared package. It exports TypeScript source through
  one public entrypoint and starts with the existing `Skeleton` primitive.
- Shared UI cannot import Electron, `window.ensemblr`, desktop Jotai state, or
  cross-process IPC contracts. Consumers own application-specific copy and
  semantic theme tokens.
- The desktop stylesheet registers `packages/ui/src` as a Tailwind source, and
  root checks type-check and lint the package with the desktop code.
- `bunfig.toml` keeps the hoisted linker and `bun.lock` remains at lockfile version
  1, preserving the Forge and Dependabot constraints recorded in ADR 0073.

## Rejected alternatives

### Move desktop into `apps/desktop`

Rejected for now. It would require coordinated changes to Forge, every Vite and
TypeScript config, native rebuild scripts, package/version reads, CI release
artifacts, Ensemblr run scripts, and documentation. None of that is necessary to
share a package.

### Wait until the website exists

Rejected. A declared workspace with one extracted primitive proves the package
link, TypeScript resolution, Tailwind scanning, and desktop consumption now. It
avoids discovering those integration problems while scaffolding the website.

### Scaffold the website in this decision

Rejected. The website framework, deployment target, routing, and i18n boundary
are not chosen. Its eventual scaffold must come from the selected framework's
current official generator rather than a speculative hand-written shell.

## Consequences

- Existing desktop commands and release paths remain stable.
- The repository has one Bun lockfile and a working shared-package consumer.
- Shared components move incrementally only when their dependencies can remain
  runtime-neutral.
- A future website is added under `apps/*` and consumes `@ensemblr/ui` without a
  second copy of the components.
- If root orchestration eventually becomes cumbersome, moving the desktop app is
  a separate migration justified by measured pressure rather than directory
  symmetry.
