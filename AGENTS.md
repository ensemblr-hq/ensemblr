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

## Package Manager Policy

This repository enforces Bun for JavaScript and TypeScript package management.

- Use `bun install` instead of `npm install`, `pnpm install`, or `yarn install`.
- Use `bun run <script>` instead of `npm run <script>`, `pnpm run <script>`, or `yarn run <script>`.
- Use `bunx <package>` instead of `npx`, `pnpx`, or `yarn dlx`.
- Use `bun add <package>` and `bun remove <package>` for dependency changes.
- Do not create `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`.
- When creating or updating `package.json`, set `packageManager` to a Bun version and keep `bun.lock` as the lockfile.
- The local Codex hook in `.codex/hooks.json` blocks direct `npm`, `npx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, and matching `corepack` package-manager calls.
