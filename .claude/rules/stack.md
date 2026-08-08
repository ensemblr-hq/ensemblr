# Stack

The versions this repo is pinned to, and the constraints that are not obvious
from `package.json`. Policies for *how* to use the stack (npm, Biome, Jotai,
Tailwind scale, JSDoc) live in `AGENTS.md` — this file is the stack itself.

Verified against `package.json` at `0.1.0`. Re-check before asserting a version.

## Platform

| | |
| --- | --- |
| Target | macOS only, arm64 |
| Shell | Electron 43 (Node 24 runtime), Electron Forge 7 |
| Node | **exactly 24.x** (`.nvmrc`, `mise.toml`, `engines: >=24 <25`) |
| Package manager | npm 11.17.0 |

`scripts/require-node-version.mjs` gates both `preinstall` and
`build`/`package`/`make`. Do not route around it: under Node 26
`electron-forge package` exits 0 with an empty `out/`, and installing under the
wrong major compiles `macos-alias`/`fs-xattr` for that major so a later Node 24
`make` dies on `NODE_MODULE_VERSION` mismatch.

`.npmrc` sets `legacy-peer-deps=true` because `@electron-forge/plugin-fuses@7`
declares a stale peer range (`@electron/fuses@^1`) against the v2 this repo pins.
Leave it.

## Language and build

- **TypeScript 6**, `strict: true`, `noImplicitAny: true`, `moduleResolution: "bundler"`,
  `target`/`lib` ES2022, `allowImportingTsExtensions: true`. Path alias `@/*` → `./src/*`.
- **Vite 8** — four configs: `vite.main.config.mts`, `vite.preload.config.mts`,
  `vite.renderer.config.mts`, `vite.playground.config.mts`.
- Three tsconfig projects, all checked by `npm run typecheck`: app
  (`tsconfig.json`), scripts (`tsconfig.scripts.json`), tests
  (`tsconfig.tests.json`).

**Two packages are deliberately `external` and must not be bundled**
(`vite.main.config.mts`):

- `node-pty` — native module, resolved from `node_modules` at runtime.
- `@anthropic-ai/claude-agent-sdk` — calls `createRequire(import.meta.url)` at
  module load; Rollup rewrites `import.meta.url` to `{}.url` for the CJS main
  bundle, so bundling throws `ERR_INVALID_ARG_VALUE` before the app starts.

Both therefore need matching `PACKAGE_KEEP_*` entries in `forge.config.ts` or the
packaged app ships without them.

## UI

| | |
| --- | --- |
| Framework | React 19 (`jsx: "react-jsx"`) |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui — style `radix-nova`, base color `neutral`, CSS variables on |
| Icons | `lucide-react`, plus `@iconify/react` for logo/file-type sets |
| Routing | TanStack Router (file-based) |
| Async data | TanStack Query, TanStack Virtual |
| State | Jotai (+ `jotai-family` for parameterized atoms) |
| Terminal | `@xterm/xterm` 6 |
| Markdown | `streamdown` + Shiki |
| Validation | Zod 4 |

**Tailwind 4 is CSS-first — there is no `tailwind.config.js` and there must not
be one.** All configuration lives in `src/renderer/styles/index.css` via
`@import "tailwindcss"`, `@theme`, `@plugin`, `@source`, and `@custom-variant`.
`components.json` reflects this with `"tailwind": { "config": "" }`. A v3-style
JS config file will simply be ignored.

`@source "../../../node_modules/streamdown/dist/*.js"` is required — Tailwind 4
does not scan `node_modules`, and without it fenced code blocks render unstyled.

shadcn aliases resolve into the renderer: `@/renderer/components`,
`@/renderer/components/ui`, `@/renderer/lib`, `@/renderer/hooks/ui`. Vendored
`ui/**` primitives are excluded from Biome and from most fallow rules; treat them
as third-party.

## Data and integrations

- **SQLite via `node:sqlite` (`DatabaseSync`)** — Node 24's built-in. There is no
  `better-sqlite3` or `sql.js` dependency; do not add one.
- **Secrets** — macOS Keychain, never a file or env var.
- **GitHub** — shells out to the `gh` CLI. Ensemblr stores no GitHub token.
- **Linear** — OAuth, with a loopback callback server.
- **Agent control** — `@modelcontextprotocol/sdk` over a loopback HTTP server.
- **Agent runtimes** — Pi via CLI RPC; Claude Code via `@anthropic-ai/claude-agent-sdk`
  against the user's own `claude` binary (the SDK's ~260 MB per-platform binary is
  deliberately not packaged).

## Tooling

- **Biome 2.5.3** is the only linter and formatter — no ESLint, no Prettier.
  Tabs for indentation; single quotes for JS **and** JSX.
  Config uses `linter.rules.preset: "recommended"`; the older
  `linter.rules.recommended: true` was deprecated in Biome 2.5, so do not
  "fix" it back. Import organization runs through `assist.actions.source.organizeImports`.
- **Vitest 4** with `happy-dom` 20 and `@vitest/coverage-istanbul`. Never
  `bun:test`, Jest, or Mocha.
- **fallow** (`.fallowrc.jsonc`) and **react-doctor** (`doctor.config.jsonc`) run
  as review diagnostics; CI runs react-doctor against `master`.
- `scripts/check-tailwind-classes.mjs` runs inside `npm run check` and fails on
  px-based arbitrary utilities.

## Adding a dependency

1. `npm install` / `npm install -D` only — `bun`, `pnpm`, and `yarn` are blocked
   by hooks in `.claude/hooks/enforce-npm.sh` and `.codex/hooks/enforce-npm-package-manager.sh`.
2. If it is a native module or must stay unbundled, add it to `external` in the
   relevant Vite config **and** to `PACKAGE_KEEP_*` in `forge.config.ts`.
3. If fallow cannot see its import edges (CSS-only, or consumed solely from
   vendored `ui/**`), add it to `ignoreDependencies` in `.fallowrc.jsonc` with a
   comment saying why.
