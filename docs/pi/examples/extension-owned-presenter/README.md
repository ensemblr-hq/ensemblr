# Extension-owned presenter example

This is an ordinary Pi extension with its presenter logic in [`presenter.ts`](./presenter.ts). It emits complete v1 snapshots in `details.ensemblr.presentation` while preserving normal text output.

## Run locally

From the repository root, use the documented Pi development flag:

```bash
pi -e ./docs/pi/examples/extension-owned-presenter/extension.ts
```

The example registers `example_search`. Ask Pi to call it, then call it with `fail: true` to see the host error path. The initial, running, and final snapshots are emitted through Pi's `onUpdate` callback. The final result repeats its snapshot because final results are authoritative.

The adjacent `package.json` demonstrates Pi's normal `pi.extensions` manifest field. It is a local example, not a published npm package or website endpoint. Multi-file imports are ordinary relative source imports.

## What to verify

- `content` remains normal tool output; presentation-only updates use `content: []`.
- Every update replaces the previous snapshot completely; it is not a patch.
- Labels include English, Russian, and Greek. Ensemblr resolves the current language and falls back to English.
- The running and final snapshots use `arrow-up-right` and `audio-lines`, demonstrating runtime Lucide ids beyond the fixed host glyph set.
- With `fail: true`, the extension throws after sending a failure snapshot. Host failure and permission treatment wins over extension presentation.
- Remove, misspell, or oversize a descriptor to exercise safe fallback to the normal presenter.

## Reload and validation

For a quick iteration, rerun the `pi -e` command. When the file is loaded from Pi's auto-discovered extension directory, use `/reload` after changing it; CLI `-e` is the documented quick-test path. Validate emitted JSON against [`../../../../schemas/tool-presentation.v1.schema.json`](../../../../schemas/tool-presentation.v1.schema.json) and keep the descriptor under the v1 limits: 64 KiB serialized, 160-character titles, 512-character previews, 32 KiB body strings, 100 list entries, and 16 labeled sections. Those limits do not replace Pi's 1 MiB RPC-frame limit.

## Troubleshooting

- **No custom presentation:** confirm the key is exactly `details.ensemblr.presentation`, the version is `1`, and the title is nonempty. Invalid or missing snapshots clear the custom snapshot and use the normal presenter.
- **Final view changed back:** repeat the desired descriptor in the final result; a final result without one is authoritative and selects the existing presenter.
- **Output is duplicated:** use `content: []` for presentation-only updates and keep accumulated text in the ordinary final `content`.
- **Large or missing updates:** throttle updates and keep them small. A whole Pi RPC JSONL frame over 1 MiB can be discarded before Ensemblr sees the descriptor.
- **Error looks friendly:** this is expected. Host failure status is authoritative and cannot be replaced by a custom title or body.
