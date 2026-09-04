# Architecture diagram fixtures

Golden fixtures for the port-fidelity tests in
`tests/renderer/architecture-layout-fidelity.test.ts`.

| File | What it is |
| --- | --- |
| `web-app.architecture.json` | archify's own `examples/web-app.architecture.json`, verbatim. Free placement (`pos` per component), two boundaries, nine connections. |
| `grid.architecture.json` | archify's own `examples/archify-repo-grid.architecture.json`, verbatim. Grid placement (`row`/`col`, non-default cell metrics), which is what exercises `grid.ts`. |
| `*.layout.json` | The upstream layout report for the matching document, produced by archify's own renderer and trimmed to the fields this app compiles. |

Both documents and both reports come from archify at commit `5769ace`
(MIT-licensed). The reports were generated with:

```
node renderers/architecture/render-architecture.mjs --layout-json <document>
```

and then reduced to `viewBox`, component rects, boundary rects, and connection
points — the geometry `compileArchitectureLayout` is a port of. Everything else
in the upstream report (labels, route quality diagnostics, brand metadata)
belongs to the parts of the renderer this app deliberately did not take.

Regenerate them only against a *known-good* archify checkout: they are the
oracle, so a drift in them is only meaningful if it came from upstream rather
than from this app.
