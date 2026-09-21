# Shared UI Agent Instructions

These instructions apply to everything under `packages/ui/`.

- Keep components runtime-neutral: no Electron, `window.ensemblr`, Node APIs,
  desktop Jotai state, or `src/shared` IPC imports.
- Export the public surface only through `src/index.ts` and import it from
  `@ensemblr/ui` outside this package.
- Use semantic Tailwind utilities. Consuming applications own theme tokens and
  must register `packages/ui/src` as a Tailwind source.
- Keep application-specific translated copy in consumers until both applications
  share an i18n contract; accept labels through props when a primitive needs text.
- Add a concise JSDoc block to each function and React component. Pure barrel
  files and tests are exempt.
