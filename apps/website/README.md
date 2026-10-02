# Website

Reserved for the Ensemblr marketing and documentation site at <https://www.ensemblr.dev>. Nothing is built
here yet.

When it starts:

- Scaffold it with the framework's official generator, following the scaffolding rules in the root
  [`AGENTS.md`](../../AGENTS.md#app-scaffolding-requires-current-official-docs).
- Its `package.json` makes this directory a workspace — the root `workspaces` glob already matches
  `apps/*`. Name it `@ensemblr/website`, mark it `private`, and give it the `check`, `typecheck`, and `test`
  scripts the root fans out to.
- Its `biome.json` sets `"root": false` and `"extends": "//"` to inherit the house style.
- Take shared UI and logic from [`packages/shared/`](../../packages/shared) with `"workspace:*"`, never by
  importing from `apps/desktop/`.
- The desktop app's user guide lives in [`apps/desktop/docs/guide/`](../desktop/docs/guide), and the
  configuration schemas the site serves under `/schemas/` live in
  [`apps/desktop/schemas/`](../desktop/schemas).
