# 0045. Unify the File Viewer, Diff Viewer, and Timeline Previews Behind One Code Surface

Date: 2026-08-08

## Status

Accepted

Records a consolidation that shipped without a decision record. There is no
superseded ADR, because none of the four viewers it merged ever had one — which
is most of why they diverged.

## Context

**Be clear about what this is.** This is not a decision taken at a fork in the
road. Nobody weighed one architecture against another; four surfaces that should
always have been one had drifted apart, and the change put them back together.
The reason it is written down is not that the decision was hard, but that the
divergence is the default state — each of the four viewers was, at the time it
was written, the reasonable local choice — and the next person to need "just a
small diff preview here" will reach for a fifth unless something says not to.

By the time of the change, the app rendered code in four places that had no
structural relationship:

| Surface | File |
| --- | --- |
| File preview | `src/renderer/components/conversation-panel/file-preview-panel.tsx` |
| Turn diff | `src/renderer/components/conversation-panel/turn-diff-panel.tsx` |
| Workspace file diff | `src/renderer/components/workbench-shell/workspace-file-diff-panel.tsx` |
| Tool diff preview | `src/renderer/components/tool-collapsible/tool-diff-preview.tsx` |

The shared piece was `src/renderer/components/code-surface.tsx`: 149 lines that
were only the scroll shell. Everything above it — gutters, line rendering, the
header naming the file, the band marking skipped lines, the type scale, the
palette — each surface did for itself. The user-visible result was that the same
file looked like four different files: gutters at different widths, the path
formatted three ways, a hunk boundary drawn one way in the diff viewer and
another inside a tool row. Switching from a file to its diff moved everything on
screen, though only the body had changed.

That is a cosmetic complaint, which is exactly why it never got fixed on its own.
The structural complaint is the one that matters: with no shared surface, a fix
to any of it — a gutter that over-counts, a scrollbar that behaves differently in
chat than in a panel — had to be made four times and in practice was made once.

## Decision

### 1. One code surface, split by role rather than by call site

`src/renderer/components/code-surface/` replaces the single file, with a barrel
at `index.ts` and five parts:

- **`code-surface.tsx`** — the scroll shell. Rounded border, the `code` tokens, a
  20rem cap, both axes scrollable, an optional copy control.
- **`code-lines.tsx`** — `CodeGutter` and `CodeLineTokens`: the line-number cell
  and one Shiki-tokenized line. `CodeLineTokens` takes a raw-text `fallback`, so
  a line paints unstyled before the grammar loads and swaps in colour with no
  reflow.
- **`viewer-header.tsx`** — `CodeViewerHeader`: file on the left, controls on the
  right, one bar for the file viewer, the diff viewer, and the turn diff. The
  icon defaults to the file-type icon for the path, which is what makes a path
  look the same here as it does in the workspace file tree.
- **`hunk-gap.tsx`** — `CodeHunkGap`: the band marking skipped lines. Set in the
  sans face against the mono around it, because the band is chrome describing the
  diff rather than a line of it. Shared by the full diff viewer and the compact
  preview inside a tool row.
- **`code-style.ts`** — the class recipes (`CODE_SURFACE_CLASSES`,
  `CODE_GUTTER_CLASSES`, `CODE_GUTTER_DIVIDER_CLASSES`, `CODE_CONTENT_CLASSES`,
  `DIFF_GUTTER_TINT`, `DIFF_ROW_SURFACE`, and the two type scales).

The split is by **role in the composition**, not by which viewer needed it. A
part named after its caller would have re-created the original problem one level
down.

### 2. Two densities, one row height

`CODE_PANEL_TEXT_CLASSES` (`text-code-body`) for a surface filling a panel or a
tab; `CODE_CHAT_TEXT_CLASSES` (`text-xs`) for one embedded in a conversation row.
Both sit on `leading-code`, so surfaces of different sizes still stack their
lines on one grid and a snippet in chat reads as the compact cut of the same
component rather than as a different component.

`code-style.ts` is also the place the `react-diff-view` overrides in
`styles/index.css` are kept honest: that library owns its own cells, so the CSS
restates the same values rather than importing them, and the module's JSDoc says
so.

### 3. Native scrolling, not an overlay scroll area

The shell scrolls natively under `sleek-scrollbar` rather than through a Radix
overlay scroll-area. An overlay bar that fades while idle would leave a chat
snippet looking unscrollable next to a panel that always shows how much more
there is — and the whole point of the consolidation is that the two read as one
surface.

### 4. Measurements are design tokens, not arbitrary Tailwind values

The consolidation initially spent the runtime gutter measurement and the diff
pane's container width as arbitrary Tailwind values, bypassing the token system
the rest of the surface already used. #212 named them in `@theme inline`:

- `--spacing-code-gutter` and `--spacing-code-gutter-indent`, set per surface so
  `w-code-gutter` resolves against whichever surface a line lands on
- `--spacing-container-inline` (`100cqi`), spent as `w-container-inline`, so a
  comment thread fills the pane it sits in
- a `code-line-counter` utility for the CSS-counter line number, so it stays
  spendable through `before:`

**The compiled CSS was unchanged** — every replacement generated the same rule
the arbitrary value did. The change bought nothing visually and was made anyway,
because a measurement that varies per surface is precisely the thing that has to
be nameable: the gutter width is set by the surface and read by every line inside
it, and an arbitrary value cannot express that indirection. It also keeps the
surface inside the repository's Tailwind policy, which `npm run check` enforces
through `scripts/check-tailwind-classes.mjs`.

### 5. What came with it

Three supporting pieces were extracted rather than left inline, because each was
about to be duplicated across the merged viewers:

- `src/renderer/components/file-path-label.tsx` — one path rendering
- `src/renderer/lib/code/gutter.ts` — `codeGutterDigits`, the gutter-width helper
- `src/renderer/state/workspace/viewed-changes.ts` — per-file viewed marks,
  backed by workspace-git status

Viewed marks are bounded **per workspace** rather than pruned against a single
source's change set. The same workspace is reviewed through several diff scopes,
so a path missing from one scope is routinely present in another, and pruning
against one would drop marks the user had made in another.

## Consequences

- **This ADR's value is preventative, not explanatory.** It exists so that the
  next person who needs a code view finds `code-surface/` and composes from it
  instead of writing a fifth viewer. If you are reading this while about to add
  one: add a part, or a prop, or a density — not a sibling.
- **The barrel is the boundary.** Import from
  `@/renderer/components/code-surface`; the parts are siblings inside the
  concern. A consumer reaching past the barrel to a part is reintroducing the
  coupling the split removed.
- **`react-diff-view` remains a second styling authority.** It renders its own
  cells, so `styles/index.css` restates the shared values for them. That is a
  known duplication with no owner in code — a change to the code palette or the
  row height has to be made in `code-style.ts` and in the diff-view overrides
  together, and only a visual check catches a miss.
- **A consolidation this wide carries its own regressions.** Gutter width
  over-counted a hunk's last line, the `+`/`−` counts
  read from the status palette rather than the diff one, and the highlight
  effects redid work a warm sync cache had already served. All three were caught
  in review of the same change, which is a fair signal of how much behaviour was
  moving at once. `tests/renderer/code-gutter-width.test.tsx`,
  `diff-viewer-state-per-file.test.tsx`, `diff-viewer-viewed-toggle.test.tsx`,
  `file-path-label.test.tsx`, and `review-files-viewed.test.tsx` are the guard.
- **The playground carries a preview of the merged surface.**
  `playground/viewers-preview.tsx` renders the viewers against a seeded file
  client, so a change to shared chrome can be seen across all of them without
  driving the app into four different states.
