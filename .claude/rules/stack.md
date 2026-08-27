# Stack

The versions this repo is pinned to, and the constraints that are not obvious
from `package.json`. Policies for *how* to use the stack (npm, Biome, Jotai,
Tailwind scale, JSDoc) live in `AGENTS.md` — this file is the stack itself.

Verified against `package.json` at `0.1.0-beta.6` on 2026-08-17. Re-check before
asserting a version.

## Platform

| | |
| --- | --- |
| Target | macOS only, arm64 |
| Shell | Electron 43 (Node 24 runtime), Electron Forge 7 |
| Node | **exactly 24.x** (`.nvmrc`, `mise.toml`, `engines: >=24 <25`) |
| Package manager | npm 11.17.0 |

`scripts/require-node-version.mjs` gates both `preinstall` and
`build`/`package`/`make`. Do not route around it: installing under the wrong
major compiles `macos-alias` (V8-ABI-bound, via `nan`) for that major, so a later
Node 24 `make` dies on `NODE_MODULE_VERSION` mismatch. Node 24 is also the Active
LTS line the Electron 43 runtime embeds.

**`@types/node` stays on `^24`, tracking the runtime rather than the latest
release.** Electron 43 embeds Node 24, so typing against a newer major makes the
compiler accept APIs that do not exist at runtime — a green `npm run typecheck`
then ships a `TypeError`. Dependabot proposes the bump anyway, because it reads
`@types/node` as an ordinary devDependency rather than a mirror of `engines`;
decline it until the Electron major moves.

`.npmrc` sets `legacy-peer-deps=true` because `@electron-forge/plugin-fuses@7`
declares a stale peer range (`@electron/fuses@^1`) against the v2 this repo pins.
Leave it.

**`extract-zip` is aliased in `overrides` to
`npm:@electron-internal/extract-zip`.** Forge 7 reaches `extract-zip@2.0.1`
through `@electron/packager@18`, and that package is abandoned (last publish
2023) with an unpatched symlink path-traversal advisory,
[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) —
`electron-forge package` unzips the downloaded Electron bundle with it. The alias
is the same swap Electron made upstream in
[packager#1917](https://github.com/electron/packager/pull/1917), shipping in
Forge 8; it is a napi-rs module carrying prebuilds for every platform in the
tarball, so nothing compiles at install time. Drop the alias once Forge 8 is
stable.

## Language and build

- **TypeScript 7**, `strict: true`, `noImplicitAny: true`, `moduleResolution: "bundler"`,
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
| Composer editor | `lexical` + `@lexical/react` 0.49, plain-text mode only |
| Markdown | `streamdown` + Shiki, with the `@streamdown/{cjk,code,math,mermaid}` plugins wired in `src/renderer/components/message.tsx` |
| Diff rendering | `react-diff-view`, tokenized through Shiki |
| Layout / motion | `react-resizable-panels`, `motion` (imported as `motion/react`) |
| Drag and drop | `@atlaskit/pragmatic-drag-and-drop` (+ `-hitbox`), used by the dashboard board |
| Validation | Zod 4 |
| i18n | `i18next` 26 + `react-i18next` 17; catalogues bundled as JSON under `src/renderer/lib/i18n/locales/` |

**Lexical is confined to the composer editor.** Everything that imports it lives
under
`src/renderer/components/workbench-shell/conversation-panel/composer/editor/`,
behind that folder's `index.ts`. The editor publishes the draft back out as plain
text plus its runs and chips in document order, so the autocomplete engine and
the send pipeline never learn a rich-text editor is involved
([ADR 0047](../../docs/adr/0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md)).
A Lexical import outside that folder means the linearizer is missing a case.

The `ai` package (Vercel AI SDK 7) is a **type-only** dependency of the renderer:
the agent timeline models turns as `UIMessage` / `DynamicToolUIPart`. Every one
of its ~20 imports is an `import type` — nothing calls into it at runtime, and no
model provider is wired through it. Keep it that way; runtimes are reached
through `src/main/agent-runtime/`.

**Tailwind 4 is CSS-first — there is no `tailwind.config.js` and there must not
be one.** All configuration lives in `src/renderer/styles/index.css` via
`@import "tailwindcss"`, `@theme`, `@plugin`, `@source`, and `@custom-variant`.
That file also pulls in `tw-animate-css` and `shadcn/tailwind.css` as CSS
imports, which is why `tailwindcss`, `@tailwindcss/typography`, and `shadcn` sit
in `devDependencies` and are allowlisted in `.fallowrc.jsonc`
`ignoreDependencies` — Vite compiles them at build time and the renderer bundle
needs none of them at runtime. `components.json` reflects the CSS-first setup
with `"tailwind": { "config": "" }`. A v3-style JS config file will simply be
ignored.

`@source "../../../node_modules/streamdown/dist/*.js"` is required — Tailwind 4
does not scan `node_modules`, and without it fenced code blocks render unstyled.

shadcn aliases resolve into the renderer: `@/renderer/components`,
`@/renderer/components/ui`, `@/renderer/lib`, `@/renderer/hooks/ui` — the last
of which has no directory in the tree today. Vendored `ui/**`
primitives are quieted per-rule in fallow and react-doctor; treat them as
third-party. They are **not** excluded from Biome — `biome.json` ignores
`src/components/ui` and `src/hooks/ui`, neither of which exists, so re-vendoring
a primitive gets reformatted to house style.

## Data and integrations

- **SQLite via `node:sqlite` (`DatabaseSync`)** — Node 24's built-in. There is no
  `better-sqlite3` or `sql.js` dependency; do not add one.
- **TOML** — `js-toml`, read and written through `src/main/config/`, which owns
  the atomic writer both the scripts and the Infisical link writers share for the
  committed `.ensemblr/settings.toml`.
- **Secrets** — macOS Keychain, never a file or env var.
- **GitHub** — shells out to the `gh` CLI. Ensemblr stores no GitHub token.
- **Linear** — OAuth, with a loopback callback server. Many accounts at once
  (ADR 0052): identity in SQLite, tokens in the Keychain keyed per account.
- **Infisical** — a hand-written REST client against four endpoints, authenticated
  with a Machine Identity (Universal Auth), no `@infisical/sdk` (ADR 0051). It is
  an environment *layer*, resolved live per launch, never materialized to disk.
- **Agent control** — `@modelcontextprotocol/sdk` over a loopback HTTP server.
- **Agent runtimes** — Pi via CLI RPC; Claude Code via `@anthropic-ai/claude-agent-sdk`
  against the user's own `claude` binary (the SDK's ~260 MB per-platform binary is
  deliberately not packaged).

## Tooling

- **Biome 2.5.8** is the only linter and formatter — no ESLint, no Prettier.
  Tabs for indentation; single quotes for JS **and** JSX.
  Config uses `linter.rules.preset: "recommended"`; the older
  `linter.rules.recommended: true` was deprecated in Biome 2.5, so do not
  "fix" it back. Import organization runs through `assist.actions.source.organizeImports`.
- **Vitest 4** with `happy-dom` 20 and `@vitest/coverage-istanbul`. Never
  `bun:test`, Jest, or Mocha.
- **fallow** (`.fallowrc.jsonc`) and **react-doctor** (`doctor.config.jsonc`) run
  as review diagnostics; CI runs react-doctor against `master`.
- **i18next-cli** drives `npm run i18n:{extract,types,status,lint}`. `i18n:lint`
  runs inside `npm run check` and fails the build on hardcoded user-facing
  strings and on sentences concatenated across translations; suppress a false
  positive with an `i18next-instrument-ignore` directive at the call site.
  `i18n:extract` and `i18n:types` each re-run Biome over what they wrote —
  i18next-cli emits 2-space JSON and Biome formats with tabs, so without that
  the two rewrite each other on every run.
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
