# Contributing to Ensemblr

Thanks for looking. Ensemblr is pre-1.0 and the structure is opinionated, so the fastest route to a merged
change is a conversation before a diff.

- **Issues are welcome** — bugs, reproductions, and feature requests. Use the templates; the bug template
  asks for your build channel and agent runtime because most reports are unactionable without them.
- **Pull requests: open an issue first.** Describe what you want to change and why, and wait for a reply
  before writing code. A large unsolicited diff against a codebase in this state usually cannot be merged,
  and that is a bad outcome for the time you spent on it.
- **Security issues never go in a public issue.** See [`SECURITY.md`](./SECURITY.md).

Contributions are accepted under the [MIT license](./LICENSE). There is no CLA and no DCO sign-off.

## Getting set up

[`docs/onboarding.md`](./docs/onboarding.md) is the runbook: prerequisites, install, run, first change,
first PR, and which test runner a new test belongs to. [`docs/architecture-map.md`](./docs/architecture-map.md)
is the directory-level index of which subtree owns which concern.

The short version: macOS on Apple silicon, Node **exactly 24.x**, npm.

```bash
npm install          # postinstall fixes node-pty native-module permissions
npm run dev          # the app
npm run dev:playground   # the component preview harness, Vite only
```

## The gates

Run these before you push. **CI does not run them** — `.github/workflows/checks.yml` runs a `react-doctor`
scan and a verification job; anything it misses surfaces on someone else's machine.

```bash
npm run check       # Biome + Tailwind class check + i18n lint + hardcoded-string scan
npm run typecheck   # tsc --noEmit across tsconfig.json, tsconfig.scripts.json, tsconfig.tests.json
npm run test        # Vitest: renderer, shared, and pure-logic main suites
npm run doctor      # react-doctor diagnostics
```

The `electron --test` suites (`npm run test:db`, `test:workspace`, `test:github`, `test:linear`,
`test:agent-runtime`, …) need the Electron runtime and are not part of `npm run test`. Run the ones your
change touches. `package.json` has the full list.

## House rules

The binding policies live in [`AGENTS.md`](./AGENTS.md) and [`.claude/rules/`](./.claude/rules) — those
files are normative and this section is a pointer, not a second copy.

- **npm only.** No `bun.lock`, `pnpm-lock.yaml`, or `yarn.lock`; hooks block the other package managers.
- **Biome** is the only linter and formatter. No ESLint, no Prettier.
- **Jotai** is the only app-level state solution.
- **Tailwind scale**, not px-based arbitrary utilities — `w-[13px]` fails `npm run check`.
- **JSDoc on every function**, and no comments inside function bodies. See
  [`.claude/rules/jsdoc.md`](./.claude/rules/jsdoc.md) and [`.claude/rules/comments.md`](./.claude/rules/comments.md).
- **Each `src/*` subtree has its own scoped `AGENTS.md`**, and it overrides the root file. `src/main` is
  organized concern-first and `src/renderer` type-first — deliberately opposite axes. Do not copy one
  layout into the other.
- **A decision that changes a contract or cuts across the codebase gets an ADR** under
  [`docs/adr/`](./docs/adr). Follow the format of the existing records.
- **Conventional Commits**: `<type>: <description>`, with types `feat`, `fix`, `refactor`, `docs`, `test`,
  `chore`, `perf`, `ci`.

### Two rules that are easy to miss

- **A new user-facing string ships translated.** Add the `t('ns:key', 'Default English')` call site, run
  `npm run i18n:extract`, then hand-fill the new empty values in `src/renderer/lib/i18n/locales/ru/**`
  **and** `src/renderer/lib/i18n/locales/el/**`. `locales/en/**` is generated — never hand-edit it. Check
  with `npm run i18n:status`. The full contract is [`.claude/rules/i18n.md`](./.claude/rules/i18n.md).
- **A new database migration registers its id in the test.** Migrations in
  `src/main/storage/database.ts` are numbered and append-only, and every id is asserted in
  `tests/main/database.test.ts`. Add to both in the same change, and never edit an existing migration.

## Project structure

```
src/
├── main/       Electron main process (Node), organized concern-first — one folder per
│               concern, each behind an index.ts. Entry: main.ts.
│                 agent-runtime · pi-agent · claude-agent · agent-providers · agents
│                 agent-control · plan-mode · chat-tabs · checkpoints · commands
│                 repository · workspace-git · workspace-files · review · github · linear
│                 terminal · scripts · storage · config · environment · secrets · setup
│                 ipc · app · menu · open-target · root · pi-ipc · pi-runtime
│                 linked-directories
├── preload/    Context-isolated IPC bridge (bridge/ensemblr-api.ts). Entry: preload.ts.
├── renderer/   React UI, organized type-first: api · components · config · fixtures ·
│               hooks · lib · routing · state · styles · types. Entry: main.tsx.
└── shared/     Cross-process contracts: Zod config, ipc/ (channels + contract modules),
                agent-control, harness registry (agents.ts), scripts, plan-mode, keymap,
                terminal, pi-rpc, menu-commands

resources/      Shipped Pi extensions (pi-extensions/ensemblr-control.mts)
playground/     Vite-only component preview harness (npm run dev:playground)
docs/           Guide, ADRs, runtime references — see docs/README.md
tests/          main/ · renderer/ · shared/ · fixtures/
scripts/        Build and maintenance scripts
```

## Adding something new

[`docs/onboarding.md`](./docs/onboarding.md) §9 has the quick-reference table: which files a new IPC call,
route, durable state slice, migration, menu item, agent runtime, control op, or user-facing string has to
touch. Read it before adding one of those — several of them have a registration step that fails silently
if you skip it.

## Generated files

Never hand-edit `src/renderer/routing/routeTree.gen.ts` (the TanStack Router plugin regenerates it),
`package-lock.json`, or `src/renderer/lib/i18n/locales/en/**`.
