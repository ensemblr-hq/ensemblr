# Onboarding

Clone to first merged change. The root [`README.md`](../README.md) is the product
overview; this is the runbook.

## 1. Prerequisites

Ensemblr is **macOS-only** — it packages an arm64 `.app`, stores secrets in the
Keychain, and reads battery state through macOS APIs. There is no Linux or
Windows path.

| Requirement | Why | Check |
| --- | --- | --- |
| **Node 24.x** (exactly) | Native modules compile against the running major | `node -v` |
| **npm** | The enforced package manager | `npm -v` |
| **git** | Worktrees back every workspace | `git --version` |
| **Pi CLI** | Agent runtime, spawned in RPC mode | `pi --version` |
| **Claude Code CLI** | The other agent runtime, driven through `@anthropic-ai/claude-agent-sdk` against *your* binary — Ensemblr ships none | `claude --version` |
| **GitHub CLI** | PR and check data; Ensemblr stores no GitHub token | `gh auth status` |
| `codex` / `vibe` _(optional)_ | Terminal harnesses; each appears only when its binary is on `PATH` | `which codex` |

The two runtimes are gated differently. **Pi is part of the blocking setup gate**
(`src/main/setup/setup-checks-pi.ts` — executable, RPC startup, provider/model
readiness), so you need it to get past setup. **Claude Code is not** — it has a
readiness probe (`src/main/agent-providers/claude-readiness-probe.ts`) surfaced in
**Settings → Providers**, where you can also point at a binary that is not on
`PATH`, but a missing `claude` does not block the app.

### The Node 24 pin is load-bearing

`.nvmrc`, `mise.toml`, and `package.json#engines` all pin Node 24, and
`scripts/require-node-version.mjs` enforces it at two gates (`preinstall` and
`build`/`package`/`make`). Ignoring it fails in ways that do not look like a Node
problem:

- On Node 26, `electron-forge package` **exits 0 and produces no artifacts**.
- Installing under the wrong major compiles `macos-alias` / `fs-xattr` for that
  major, so a later Node 24 `make` dies on a `NODE_MODULE_VERSION` mismatch —
  long after the mistake.

`mise` users get the pin automatically. Otherwise `nvm use` reads `.nvmrc`.

## 2. Install

```bash
npm install
```

Two things happen that are worth knowing about:

- **`preinstall`** runs the Node-version gate above.
- **`postinstall`** runs `scripts/fix-node-pty-permissions.mjs`, which marks
  `node-pty`'s prebuilt `spawn-helper` binaries executable. They ship without the
  exec bit; skipping this surfaces much later as an opaque PTY spawn failure.

`.npmrc` sets `legacy-peer-deps=true`. That is deliberate:
`@electron-forge/plugin-fuses@7` declares a stale peer range (`@electron/fuses@^1`)
while the repo pins v2. Do not remove it without re-checking the resolution.

## 3. Run

```bash
npm run dev              # Electron app (electron-forge start)
npm run dev:playground   # component preview harness, no Electron
```

The playground (`playground/`) renders isolated component previews against
fixtures — the fast loop for UI work that does not need main-process services.

Environment variables are **only** needed for signed release builds. Copy
`.env.example` to `.env` and fill in the three App Store Connect values
(`APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) if you are
notarizing; day-to-day development needs none of them. See
[`build-and-release.md`](./build-and-release.md).

## 4. Find your way around

Read these in order:

1. [`../CONTEXT.md`](../CONTEXT.md) — the ubiquitous language. *Workspace*,
   *Project*, *Harness*, *Ensemblr Control*, *Session Branch* and the rest have
   precise meanings here, and each entry lists the terms to avoid.
2. [`architecture-map.md`](./architecture-map.md) — which directory owns which
   concern, and the three request paths (IPC, agent → app control, and the menu
   command bus).
3. [`../AGENTS.md`](../AGENTS.md) — the binding contributor policies, plus the
   scoped `AGENTS.md` for whichever subtree you are editing.
4. [`../.claude/rules/stack.md`](../.claude/rules/stack.md) — the pinned versions
   and the constraints that are *not* obvious from `package.json` (why two
   packages must stay unbundled, why `legacy-peer-deps` is set, why there is no
   `tailwind.config.js`), and
   [`../.claude/rules/patterns.md`](../.claude/rules/patterns.md) for the
   structural rules a change has to respect.
5. [`adr/`](./adr) — 47 Architecture Decision Records. When something looks odd,
   the ADR usually explains it. Start with
   [0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md) if
   you are touching the agent layer.
6. [`../.claude/rules/i18n.md`](../.claude/rules/i18n.md) — the app ships in
   English, Russian, and Greek, and a user-facing string your change adds is not
   finished until all three read it. The catalogues are at 100% in both `ru` and
   `el`, so a missing value is the only gap in the tree, not one of many.

## 5. Make a change

The house style is enforced, not suggested. Before writing code:

- **Immutability.** Return new objects; do not mutate inputs.
- **JSDoc on every function**, hook, component, atom, and IPC contract — see
  [`../.claude/rules/jsdoc.md`](../.claude/rules/jsdoc.md).
- **No comments inside function bodies.** A comment there means a name is wrong
  or the function is doing too much. The one exception is a non-obvious *why*
  the code cannot express — see [`../.claude/rules/comments.md`](../.claude/rules/comments.md).
- **Tailwind scale only.** No `w-[13px]`-style px utilities; `npm run check`
  fails on them.
- **Jotai** is the only app-level store. No Redux, Zustand, Valtio, or a
  hand-rolled global.
- **Every user-facing string is a catalogue key**, and `ru` and `el` ship filled
  in the same change: `t('<ns>:<surface>.<element>', 'Default English')`, then
  `npm run i18n:extract` → fill the empty values → `npm run i18n:types` →
  `npm run i18n:status`. Never hand-edit `locales/en/**`; it is generated from the
  call sites.

## 6. Running the tests

Two runners, split by what the test needs:

```bash
npm run test              # full Vitest suite (renderer + shared + pure-logic main)
npx vitest run <file>     # one Vitest file
npm run test:coverage     # Vitest with Istanbul coverage → coverage/coverage-final.json
npm run test:db           # a main-process suite (electron --test)
```

**Which runner does my new test use?**

- Testing pure logic (a formatter, a reducer, a slug function)? **Vitest.** If it
  lives under `tests/main/`, add its path to the `include` array in
  `vitest.config.mts` — that list is explicit, not a `tests/main/**` glob, because
  a glob would drag in the Electron-only suites.
- Testing a React component or hook? **Vitest**, under `tests/renderer/`, with a
  `// @vitest-environment happy-dom` docblock at the top of the file. Use
  `renderWithProviders` / `createTestQueryClient` from
  `tests/renderer/support/dom.tsx`. jest-dom matchers are already registered
  globally.
- Needs Electron or Node runtime APIs (SQLite, PTY, `app.getPath`)? **`electron --test`.**
  Add a `test:<name>` script to `package.json` following the existing
  `ELECTRON_RUN_AS_NODE=1 electron --test …` pattern.

Mocks use Vitest (`vi.fn`, `vi.spyOn`, `vi.mock` with `vi.hoisted`). Never import
from `bun:test` — Bun is not the runner and the enforcement hook blocks the CLI.

## 7. Before you push

```bash
npm run check       # Biome + the Tailwind class check + i18n lint + hardcoded-string scan
npm run check:fix   # apply safe fixes (format + import organization)
npm run typecheck   # tsc --noEmit across app, scripts/, and tests/
npm run test
npm run i18n:status # if you touched a user-facing string — must stay at 100% ru/el
```

`npm run typecheck` covers **three** projects — `tsconfig.json`,
`tsconfig.scripts.json`, `tsconfig.tests.json` — because `npx tsx` and Vitest
strip types without checking them. A `scripts/*.ts` type error only surfaces
here.

Run all four — CI does not. `.github/workflows/checks.yml` has exactly one job: a
`react-doctor` scan diffed against `master`, failing on `error`, on pushes to
`master` and PRs targeting it. Nothing in CI runs Biome, `tsc`, or the tests, so
a red `npm run check` only surfaces on someone else's machine.

For changed renderer code, also run the `react-doctor` skill and `fallow` on the
changed set, per [`../.claude/rules/code-review.md`](../.claude/rules/code-review.md).

## 8. Branches, issues, and PRs

- Linear is the tracker: team **The Swiss Cheese**, project **Ensemble**, issue
  prefix **THE**. Local roadmap ids like `ENS-006` are *not* Linear keys — use
  `THE-106` style identifiers in branches, commits, and PR titles.
- Conventional Commits: `<type>: <description>` with types `feat`, `fix`,
  `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- Move a finished ticket to **In Review**, never to **Done**.
- Do not open a PR unless it was explicitly asked for.

## 9. Adding something new — quick reference

| Task | Files to touch |
| --- | --- |
| New IPC call | `src/shared/ipc/channels.ts` → `src/shared/ipc/contracts/<concern>.ts` → `src/main/ipc/request-schemas/<concern>.ts` → `src/main/ipc/handlers/<concern>.ts` → `src/preload/bridge/ensemblr-api.ts` → `src/renderer/api/` |
| New route | A file under `src/renderer/routing/routes/`; let the Vite plugin regenerate `routeTree.gen.ts` |
| New durable UI state | `src/renderer/state/<concern>/`, re-exported from that folder's `index.ts` |
| New DB table or column | A numbered migration in `src/main/storage/database.ts`, plus its id in `tests/main/database.test.ts` |
| New main-process concern | A folder under `src/main/` with an `index.ts`; add it to `src/main/AGENTS.md`. Main-process barrels are deliberately **not** listed in `.fallowrc.jsonc` — they are reachable from `src/main/main.ts`, so a genuinely unused export in one should still surface. Shared and renderer concern barrels *are* listed there |
| New user-facing string | A `t('<ns>:<key>', 'Default English')` call site, then `npm run i18n:extract` and hand-fill `locales/ru/**` and `locales/el/**`; add the term to `docs/i18n-glossary.md` if it is new |
| New native menu item | An id in `src/shared/menu-commands.ts` → a label in all three languages in `src/main/menu/menu-strings.ts` → an entry in the relevant `src/main/menu/<name>-menu.ts` → a `useMenuCommand` registration in the renderer surface that owns the action ([ADR 0046](./adr/0046-drive-the-native-menu-bar-from-a-renderer-command-bus.md)) |
| New agent runtime | A sibling adapter folder under `src/main/` implementing the `src/main/agent-runtime/` contract — never a branch inside `pi-agent/` or `claude-agent/` ([ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)) |
| New agent control op | A service first, then a port in `src/main/agent-control/ports.ts` — control never adds capability code of its own |
| New pure-logic test under `tests/main/` | The explicit `include` array in `vitest.config.mts` — it is not a glob |
| A decision worth recording | The next numbered ADR in `docs/adr/`, and bump the count in all four places it appears: `docs/README.md`, both places in `README.md` (the project-structure block and the further-reading list), and §4 of this file |
