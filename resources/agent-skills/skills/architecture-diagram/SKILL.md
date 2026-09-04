---
name: architecture-diagram
description: How to read and refine the architecture diagram Ensemblr keeps for a workspace — ensemblr_get_architecture_diagram to fetch it (it scans one on the spot when the workspace has never shown one, so there is never nothing to read), the IR shape, what the scanner already got right, what only you can fix, and ensemblr_update_architecture_diagram to store the edit. Read this when asked to improve, correct, annotate, generate, or explain the workspace architecture diagram.
---

# Refining the architecture diagram

Ensemblr keeps an architecture diagram of every workspace at
**`.ensemblr/architecture.json`**, committed alongside the code it describes. It
is **already built** before you arrive: when the workspace was created, a scanner
walked the source tree, aggregated it to directory-level nodes, derived
cross-module import edges, and laid them out as an Euler drawing — nested
regions per directory, with a curve around each. The user opens it from the tab
strip.

That scan runs **once**. Nothing re-derives the diagram afterwards, so keeping it
true to the code is agent work — yours — and what you store is what the user
sees until somebody stores something else.

Read and write it through the two ops below rather than by editing the file
directly — they validate the document, and the update op refreshes any diagram
tab the user has open.

Your job is never to author one from nothing. It is to **edit the one that
exists** so it reads like a drawing a maintainer would make rather than a dump
of the folder tree.

## It is a drawing for people, not a map for you

The diagram exists so a human can see the shape of the repository at a glance.
It is **not a source of truth about the code, and you must never treat it as
one.** You curate it; you do not consult it.

Concretely: never answer a question about the codebase from the diagram, never
decide what to edit or where something lives because a node says so, and never
report its contents as fact. It is lossy by design — nodes are dropped as noise,
edges are omitted, labels are renamed to concepts that appear nowhere in the
source — and it is only as current as the last agent who bothered to update it,
which may be nobody since the code moved.

**The codebase is the truth.** Read the files. If the diagram and the source
disagree, the diagram is wrong, and fixing it is the only thing that
disagreement licenses you to do.

## The two calls

```
ensemblr_get_architecture_diagram({})          → the document to edit
ensemblr_update_architecture_diagram({ diagram })  → store your edit
```

Read first, change what is wrong, store the whole document back. There is no
patch operation: a partial edit against a document another agent may have
refined in the meantime is a merge nobody can adjudicate.

**The read always answers with a diagram.** A repository with no
`.ensemblr/architecture.json` yet is not an empty case — the seed scan runs on
the spot, writes the file, and returns it, marked `source: "scan"`. So there is
nothing to go hunting for and no scanner to invoke yourself.

The one thing the read *can* refuse is a stored file it cannot parse — a hand
edit, a merge conflict, a document with one bad field. It says so and names the
problem rather than scanning a replacement over the top, because that file is
tracked and overwriting it would delete work out of the user's diff. Repair or
delete it; do not work around it.

What comes back is a document to **edit**, not evidence to reason from — see
*It is a drawing for people* above. `source` tells you what you are holding:

- `scan` — the deterministic seed. Correct, but named after directories rather
  than concerns. This is the interesting case: everything under *What only you
  can fix* is still undone.
- `agent` — a previous refinement. Edit it; do not replace it wholesale, or you
  discard whatever the last pass got right.

## What the scanner already gets right

Do not spend a turn redoing any of this:

- **Which directories exist**, and how many source files each holds.
- **Which directories import from which**, and how heavily.
- **Placement.** Under `organic` there is none to get wrong: a node is placed by
  the regions that enclose it, and the renderer packs and outlines them.
- **Nested regions per directory** — `src`, `src/main`, `src/main/storage`, each
  wrapping everything beneath it, so the curves nest the way the tree does.
- **`sources`** — every node points at the directory it stands for, so a click
  opens it.

## What only you can fix

- **Boundary labels.** The scanner names a region after its directory path:
  `src`, `src/main`. You know the concern — *Main process*, *Renderer*,
  *Cross-process contracts*. Rename them.
- **Node types.** The scanner guesses from path vocabulary and gets the obvious
  ones (`storage` → database, `renderer` → frontend). It cannot tell that a
  directory called `lib` is really the permission gate. Fix the wrong ones.
- **Noise.** A repository has directories that are true but not interesting —
  fixtures, generated output, a one-file shim. Drop the nodes that do not help a
  reader, and drop the edges that only exist because everything imports the
  types module.
- **Membership.** Which nodes belong in which region is the whole layout under
  `organic`. Move a node into the region that owns it conceptually rather than
  the directory it happens to sit in, and add a **cross-cutting set** — a
  boundary wrapping nodes from more than one region — where one genuinely exists.
  That is what draws as an overlapping lens, and it is the one thing a folder
  tree cannot say.
- **Edge labels.** An unlabelled arrow says "imports". A labelled one can say
  what actually crosses — `IPC`, `reads`, `spawns`. Label the few that carry
  meaning and leave the rest bare.

## The document

```jsonc
{
  "schemaVersion": 1,
  "meta": { "title": "my-repo" },
  "layout": { "mode": "organic" },        // or "grid" with "cols"; see Placement
  "components": [
    {
      "id": "src-main-storage",          // ^[a-zA-Z][a-zA-Z0-9_-]*$, unique
      "type": "database",                // frontend|backend|database|cloud|
                                         // security|messagebus|external
      "label": "storage",                // the box's first line
      "sublabel": "src/main",            // optional second line
                                         // no placement under "organic";
                                         // "row"/"col" only under "grid"
      "sources": [{ "path": "src/main/storage" }]   // at most 3 entries
    }
  ],
  "boundaries": [
    { "kind": "region", "label": "Main process", "wraps": ["src-main-storage"] },
    // wraps members of more than one region → drawn as an overlapping lens
    { "kind": "security-group", "label": "Permission gate",
      "wraps": ["src-main-storage", "src-renderer-auth"] }
  ],
  "connections": [
    {
      "id": "e-ipc-to-storage",          // always emit one; the delta
                                         // comparator matches edges by it
      "from": "src-main-ipc",
      "to": "src-main-storage",
      "label": "reads",                  // optional
      "variant": "emphasis"              // default|emphasis|security|dashed
    }
  ]
}
```

Ceilings: **64 components, 160 connections, 24 boundaries**, **3 `sources` per
component**, and **`layout.cols` at most 12**. A diagram at the ceiling is
already too dense to read — treat those as limits you never approach, not
targets. A node that wants a fourth source is a node that should have been two.

Every `from` and `to` must name a component that exists in the same document,
and every `wraps` entry likewise. A dangling reference is reported as a problem
on the panel rather than drawn.

## Placement

Two modes. The scanner seeds `organic`; a document archify authored, or one you
place by hand, uses `grid`.

### `organic` — the Euler drawing

Components carry **no placement at all**. The renderer reads `boundaries` as
*sets* and derives the whole layout from how they relate:

| Two boundaries | Relation | Drawn as |
| --- | --- | --- |
| one `wraps` a subset of the other | nesting | the smaller curve inside the larger |
| they share members, neither contains the other | crossing | two curves overlapping in a lens |
| no shared members | siblings | two curves side by side |

So membership *is* placement. Three things follow:

1. **Nest a region by wrapping a subset.** `src/main` wrapping some of what `src`
   wraps draws inside it. Nothing else declares the nesting.
2. **A lens has to be small and local.** A crossing set is only drawn when its
   outline encloses at most one node it does not wrap; otherwise the renderer
   reports it as a problem and draws nothing. A role scattered over the whole
   repository is not a lens — that information is already in the node colours.
3. **Of a crossing pair, the larger set becomes the region and the smaller the
   lens**, ties going to whichever is declared first. If you want a particular
   one drawn as the region, make it the larger.

### `grid` — fixed cells

`layout.mode: "grid"` resolves `row`/`col` into coordinates. Two rules:

1. `col` must be less than `layout.cols`, and no two components may share a
   cell. Both are reported as problems, not silently drawn.
2. A boundary is sized to the bounding box of what it `wraps`. **Give each
   boundary its own rows** — a group that ends mid-row leaves its frame
   overlapping the next one.

Free placement (`pos: [x, y]` per component, no `layout`) exists too, and is
what an archify-authored document uses. Do not convert a document from one mode
to the other unless the user asked for it: `row`/`col` is dead weight under
`organic`, and `organic` throws away a hand-placed grid.

## Storing it

`ensemblr_update_architecture_diagram({ diagram: { ...the whole document... } })`
writes `.ensemblr/architecture.json` in the workspace you are running in — a
tracked file, so it lands in the diff like any other edit and is worth
mentioning in your answer. Pass `diagram` as an **object**, not as a string
containing JSON.

What you store is the diagram from then on. Nothing re-scans over it, so a
refinement is never undone by the app — and equally, a diagram left stale after
a refactor stays stale until somebody fixes it.

The op answers with the component and connection counts it stored. A document
that does not validate comes back with the **field paths** that failed
(`components.0.type: Invalid option…`); fix those and resubmit the whole
document rather than dropping the fields it complained about or guessing at a
different shape.

## When not to touch it

- The user asked about something else. A diagram that is roughly right is not
  worth a turn of its own; it is not upkeep you owe on every task.
- You have not called `ensemblr_get_architecture_diagram`. Guessing at a
  replacement discards whatever the last refinement got right, and re-deriving
  the module graph by hand is work the scanner already did.
- The repository is mid-refactor and the shape is about to move again.
- You wanted to *look something up*. The diagram is not a lookup surface; read
  the code.
