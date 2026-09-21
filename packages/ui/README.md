# `@ensemblr/ui`

Runtime-neutral React primitives shared by Ensemblr applications.

The package exports TypeScript source for in-repository consumers. Add it with
`"@ensemblr/ui": "workspace:*"`, import from `@ensemblr/ui`, and register
`packages/ui/src` as a Tailwind source in the consuming application's stylesheet.
The host owns semantic theme tokens such as `--muted`.

Keep Electron APIs, `window.ensemblr`, desktop Jotai state, IPC contracts, and
application-specific translated copy out of this package. Accessible labels and
other copy belong to consumer props until both applications share an i18n
contract.
