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
| **Pi CLI** | First-party agent runtime, spawned in RPC mode | `pi --version` |
| **GitHub CLI** | PR and check data; Ensemblr stores no GitHub token | `gh auth status` |
| `claude` / `codex` / `vibe` _(optional)_ | Third-party harnesses; each appears only when its binary is on `PATH` | `which claude` |

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
   concern, and the two request paths (IPC, and agent → app control).
3. [`../AGENTS.md`](../AGENTS.md) — the binding contributor policies, plus the
   scoped `AGENTS.md` for whichever subtree you are editing.
4. [`adr/`](./adr) — 42 Architecture Decision Records. When something looks odd,
   the ADR usually explains it.

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
npm run check       # Biome check + the Tailwind class check
npm run check:fix   # apply safe fixes (format + import organization)
npm run typecheck   # tsc --noEmit across app, scripts/, and tests/
npm run test
```

`npm run typecheck` covers **three** projects — `tsconfig.json`,
`tsconfig.scripts.json`, `tsconfig.tests.json` — because `npx tsx` and Vitest
strip types without checking them. A `scripts/*.ts` type error only surfaces
here.

For changed renderer code, also run the `react-doctor` skill and `fallow` on the
changed set, per [`../.claude/rules/code-review.md`](../.claude/rules/code-review.md).
CI runs a `react-doctor` scan against `master` on every push and PR
(`.github/workflows/checks.yml`), failing on `error`.

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
| New main-process concern | A folder under `src/main/` with an `index.ts`; add it to `src/main/AGENTS.md` |
| New agent control op | A service first, then a port in `src/main/agent-control/ports.ts` — control never adds capability code of its own |
| A decision worth recording | The next numbered ADR in `docs/adr/`, and bump the count in `docs/README.md` |
