# Scaffold Audit

Date: 2026-06-04

Scope:
Audit the initial `THE-101 / ENS-001` Electron app scaffold against the current official generator output and document every intentional deviation.

## Sources Used

Official documentation fetched through Context7:

- `/electron/forge`: Electron Forge `create-electron-app` and Vite plugin layout.
- `/vitejs/vite`: React TypeScript Vite setup and `@vitejs/plugin-react`.
- `/tailwindlabs/tailwindcss.com`: Tailwind CSS v4 Vite plugin and `@import "tailwindcss"`.

Reference generator command:

```sh
bunx create-electron-app@latest .context/electron-forge-vite-ts --template=vite-typescript --skip-git
```

Important note:
The generator internally resolved npm and ran npm installs inside `.context/electron-forge-vite-ts`. The repository root was kept Bun-managed and uses `bun.lock`.

## Generated Reference Files

The reference scaffold produced these relevant files:

- `.context/electron-forge-vite-ts/package.json`
- `.context/electron-forge-vite-ts/forge.config.ts`
- `.context/electron-forge-vite-ts/forge.env.d.ts`
- `.context/electron-forge-vite-ts/index.html`
- `.context/electron-forge-vite-ts/tsconfig.json`
- `.context/electron-forge-vite-ts/vite.main.config.ts`
- `.context/electron-forge-vite-ts/vite.preload.config.ts`
- `.context/electron-forge-vite-ts/vite.renderer.config.ts`
- `.context/electron-forge-vite-ts/src/main.ts`
- `.context/electron-forge-vite-ts/src/preload.ts`
- `.context/electron-forge-vite-ts/src/renderer.ts`
- `.context/electron-forge-vite-ts/src/index.css`

## Intentional Deviations

### Package Management

> **Historical (2026-06-04):** This dated snapshot predates the Bun→npm
> migration. The repository is now npm-managed: `package.json` sets
> `packageManager` to an npm version, the root lockfile is `package-lock.json`,
> and the guardrail hooks block direct `bun`/`bunx`/`pnpm`/`yarn` calls. See the
> "Package Manager → npm" entry in [`CHANGELOG.md`](../../CHANGELOG.md) and the
> Package Manager Policy in [`AGENTS.md`](../../AGENTS.md). The Bun details below
> (and the `bun` commands under Conductor Configuration and Verification) are
> retained as a record of the original scaffold.

- Root `package.json` sets `packageManager` to Bun and root dependencies were installed with `bun add` / `bun add -d`.
- Root lockfile is `bun.lock`.
- The generated reference includes npm-installed state only under `.context`, which is gitignored and not part of the project scaffold.

Reason:
Repository policy requires Bun and blocks direct npm, pnpm, and yarn package-manager calls.

### Package Scripts and Tooling

- Kept Forge scripts but mapped local workflow to Bun-friendly script names: `dev`, `start`, `build`, `package`, and `make`.
- Added Biome scripts: `check`, `check:fix`, `format`, and `lint`.
- Did not keep the generated ESLint setup.

Reason:
Repository policy uses Biome instead of ESLint and Prettier.

### Dependencies

- Kept Forge dependency family from the generated scaffold: `@electron-forge/*`, `@electron/fuses`, `electron`, `electron-squirrel-startup`, `typescript`, and `vite`.
- Added React dependencies from Vite React TypeScript documentation: `react`, `react-dom`, `@types/react`, `@types/react-dom`, and `@vitejs/plugin-react`.
- Added Tailwind dependencies from Tailwind Vite documentation: `tailwindcss` and `@tailwindcss/vite`.
- Pinned `@vitejs/plugin-react` to `5.2.0` instead of latest because `@electron-forge/plugin-vite@7.11.2` uses Vite 5, and `@vitejs/plugin-react@6` expects Vite 8.

Reason:
Electron Forge's official Vite TypeScript template is not a React template. React and Tailwind are required by ADR 0001 and were added from their official docs.

### Vite Configs

- Renamed Vite config files from `.ts` to `.mts`.
- Added React and Tailwind plugins to the renderer config.
- Added `CONDUCTOR_PORT` support with `strictPort: true`.

Reason:
Current React/Tailwind Vite plugins are ESM-only, and the `.mts` config avoids Vite's CommonJS config loading failure. `CONDUCTOR_PORT` lets Conductor run multiple workspaces concurrently.

### TypeScript Config

- Changed module settings to `module: "ESNext"` and `moduleResolution: "bundler"`.
- Added `jsx: "react-jsx"`, DOM libs, strict settings, and explicit includes.
- Removed deprecated `baseUrl` and old Node resolution defaults from the generated template.

Reason:
The root scaffold uses current TypeScript 6 and React TSX. The generated template's older TypeScript 4-era options produced deprecation errors under TypeScript 6.

### Source Layout

- Generated source files were split into clearer boundaries and later organized
  behind scoped public entrypoints:
  - `src/main/main.ts` remains the Electron main-process entrypoint, with
    implementation grouped by concern under `src/main/app/`, `src/main/ipc/`,
    `src/main/menu/`, and the existing main-process service folders.
  - `src/preload/preload.ts` remains the Electron preload entrypoint, with the
    typed context bridge API built under `src/preload/bridge/`.
  - `src/shared/ipc.ts` remains the public IPC contract entrypoint, with channel
    constants and contract types grouped under `src/shared/ipc/`.
  - `src/renderer/main.tsx` remains the renderer entrypoint, with renderer code
    organized under the scoped buckets documented in `src/renderer/AGENTS.md`.

Reason:
`ENS-001` requires typed main/preload/renderer boundaries and a typed IPC health endpoint. Keeping shared IPC types under `src/shared` gives later app services a stable place to grow.

### Main Process

- Kept the generated Electron lifecycle pattern: create a `BrowserWindow`, load Vite dev URL in development, load packaged renderer HTML otherwise, quit on non-macOS window close, and recreate on macOS activation.
- Added app name, min window size, delayed show on `ready-to-show`, context isolation, disabled node integration, IPC registration, and menu wiring.
- Added packaged roadmap resource handling via `extraResource` and `process.resourcesPath`.

Reason:
The generated lifecycle is preserved, while `ENS-001` requires native lifecycle/menu ownership and typed IPC.

### Preload and IPC

- Replaced the generated placeholder preload with `contextBridge.exposeInMainWorld('ensemblr', api)`.
- Added `window.ensemblr.health()` backed by `ipcMain.handle`.

Reason:
`ENS-001` acceptance criteria require the renderer to call a typed no-op IPC health endpoint.

### Renderer

- Replaced generated static HTML/console renderer with a React root and placeholder app routes:
  - Dashboard
  - Setup
  - Workspace
  - Settings
- Added Tailwind v4 CSS tokens and placeholder UI styling.

Reason:
`ENS-001` requires basic routing between app shell, setup gate placeholder, workspace shell placeholder, and settings placeholder. ADR 0001 requires React, Tailwind, and a compact Ensemblr-owned UI direction.

### Conductor Configuration

> **Historical (2026-06-04):** This dated snapshot predates the single-file
> repository config model. Ensemblr no longer reads `conductor.json` or
> `CONDUCTOR_*`; the sole on-disk repository config is the committed
> `.ensemblr/settings.toml`, and workspace variables are `ENSEMBLR_*` only. See
> [ADR 0030](../adr/0030-use-ensemblr-settings-toml-as-sole-repository-config.md).
> The `conductor.json` / `CONDUCTOR_PORT` details below are retained as a record
> of the original scaffold.

- Added `conductor.json` with:

```json
{
  "scripts": {
    "setup": "bun install",
    "run": "bun run dev"
  },
  "runScriptMode": "concurrent"
}
```

Reason:
Conductor setup/run commands should use the repository's Bun policy and the Vite renderer now honors `CONDUCTOR_PORT`.

## Verification

Commands run successfully:

```sh
bun run typecheck
bun run build
CONDUCTOR_PORT=5317 bun run dev
```

The dev smoke test showed the Vite renderer at `http://localhost:5317/` and launched Electron. The process was stopped afterward.

## Audit Findings

- The current scaffold is not a byte-for-byte official generated app. It is an adapted Electron Forge Vite TypeScript scaffold.
- The adaptation is justified by repository policy and product requirements, but it should have been documented before implementation.
- The highest-risk original misstep was manually reconstructing files after the generator's npm behavior conflicted with Bun policy.
- Future scaffolding must generate first, then adapt from generated output, and must record all deviations before or during implementation.

## Required Future Guardrail

When an official generator exists:

1. Run it in `.context/` or a disposable directory.
2. Inspect generated files.
3. Copy/adapt generated files instead of recreating structure from memory.
4. Stop and ask if generator behavior conflicts with Bun, hooks, or local policy.
5. Record docs source, exact generator command, generated files used, and intentional deviations.
