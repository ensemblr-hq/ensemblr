# Agent Instructions

These instructions apply to this repository.

## App Scaffolding Requires Current Official Docs

When scaffolding an app, project, framework integration, SDK integration, CLI setup, or cloud-service setup, agents must not rely on training data, memory, or recalled commands.

Required workflow:

- Inspect the local repo first so generated files and commands fit the existing project direction.
- Use Context7 MCP before selecting install steps, package names, CLI flags, templates, or generated-file structure.
- Start with `resolve-library-id` for the relevant library, framework, SDK, CLI, or cloud service unless the exact Context7 library ID is already known.
- Call `query-docs` with the selected library ID and the full scaffolding question.
- If Context7 is unavailable, incomplete, or lacks the relevant tool, check the current official documentation online.
- Prefer official install directions, official starter templates, and official CLI tools such as documented `create`, `init`, or generator commands.
- Do not invent or guess package names, versions, CLI flags, templates, config keys, or setup steps.
- If official docs and local repo conventions conflict, preserve local conventions where possible and call out the tradeoff before making a risky change.
- In the final response, mention the documentation source and the exact official command or CLI path used.

Scaffold provenance guardrail:

- Do not hand-author generated app structure from memory when an official generator exists.
- Run the official generator in `.context/` or another disposable directory first, then copy or adapt from that generated output.
- If the generator conflicts with Bun, hooks, existing files, or other repo policy, stop and explain the conflict before choosing a workaround.
- Record scaffold provenance in the final response or a tracked audit note: documentation source, exact generator command, generated files used, and every intentional deviation.
- Treat manually added package names, versions, config keys, templates, or generated-file structure as invalid unless they are directly backed by current official docs, generator output, or an explicit user decision.

## Package Manager Policy

This repository enforces Bun for JavaScript and TypeScript package management.

- Use `bun install` instead of `npm install`, `pnpm install`, or `yarn install`.
- Use `bun run <script>` instead of `npm run <script>`, `pnpm run <script>`, or `yarn run <script>`.
- Use `bunx <package>` instead of `npx`, `pnpx`, or `yarn dlx`.
- Use `bun add <package>` and `bun remove <package>` for dependency changes.
- Do not create `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`.
- When creating or updating `package.json`, set `packageManager` to a Bun version and keep `bun.lock` as the lockfile.
- The local Codex hook in `.codex/hooks.json` blocks direct `npm`, `npx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, and matching `corepack` package-manager calls.

## Biome Policy

This repository uses Biome instead of ESLint and Prettier.

- Run `bun run check` before finishing changes that touch JavaScript, TypeScript, JSX, TSX, CSS, or JSON.
- Use `bun run check:fix` to apply safe Biome fixes, including formatting and import organization.
- Keep `bun run typecheck` as a separate verification step for TypeScript type errors.
- Do not add ESLint or Prettier configuration unless the user explicitly asks for it.

## Tailwind Policy

- Use Tailwind built-in scales instead of arbitrary pixel values.
- Never write square-bracket pixel utilities such as `w-[13px]`, `p-[18px]`, or `text-[13px]`.
- For spacing, sizing, radius, and layout values, convert pixels to the Tailwind scale where available: intended pixel value divided by 4 equals the Tailwind spacing token, for example `16px` -> `4`, `14px` -> `3.5`, `2px` -> `0.5`.
- Use canonical Tailwind classes before arbitrary values. For example, use `text-xs` instead of `text-[0.75rem]`, `rounded-2xl` instead of `rounded-[0.375rem]`, and `rounded-sm` instead of `rounded-[0.125rem]`.
- If a value is not available as a canonical Tailwind class, use rem-based arbitrary values instead of px-based arbitrary values, especially for typography: use `text-[0.8125rem]` instead of `text-[13px]`.
- Prefer semantic or existing tokenized utilities over new arbitrary values when the design system already exposes the needed value.
- `bun run check` runs `scripts/check-tailwind-classes.mjs`, which fails on square-bracket pixel utilities and known non-canonical arbitrary classes. Update that script when adding another canonical class equivalence that agents should preserve.

## Module And File Organization

- Check for shallow modules before adding new abstractions. Prefer deep modules: small public interfaces that hide meaningful implementation complexity.
- Avoid shallow modules: large interfaces, many props or methods, or wrappers that mostly pass values through without reducing complexity.
- Before introducing a helper, wrapper, hook, or component, ask whether it reduces the number of methods, simplifies parameters, or hides complexity inside the module. If not, inline it or consolidate it with a more appropriate module.
- Organize `lib`, `utils`, and `components` by scope or concern. Avoid catch-all files and directories that mix unrelated domains.
- Keep broadly reusable primitives in shared locations, and keep feature-specific helpers/components under the feature or concern that owns them.

## Type Organization

- If the project has a dedicated types folder or type module, use it for exported types that are shared across files or concerns.
- Co-locate types with implementation only when they are not exported and are not used elsewhere.
- Prefer inline prop types when a component has only a small number of props and the inline type remains readable.
- Avoid creating one-off exported `Props` or domain type names unless they are reused, part of a public module interface, or materially improve readability.
