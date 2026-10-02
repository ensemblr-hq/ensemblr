# Shared

Reserved for code the apps share — UI pieces lifted out of the desktop app for the website to reuse, and
logic both need. Nothing lives here yet.

When the first piece moves in:

- Its `package.json` makes this directory a workspace — the root `workspaces` glob already matches
  `packages/*`. Name it `@ensemblr/shared`, mark it `private`, and give it the `check`, `typecheck`, and
  `test` scripts the root fans out to.
- An app depends on it with `"@ensemblr/shared": "workspace:*"`. Bun links it into the root `node_modules`.
  Vite compiles a linked workspace package from source, so the desktop app needs no build step for it; check
  whether the website's framework has to be told to transpile it.
- Its `biome.json` sets `"root": false` and `"extends": "//"` to inherit the house style.
- Nothing here may import from an app. Code that needs Electron, Node, or the desktop app's IPC bridge stays
  in `apps/desktop/`.
- A component that uses Tailwind classes needs an `@source` entry in each consuming app's stylesheet, or
  Tailwind 4 will not generate its classes.
