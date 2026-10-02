---
name: architecture-diagram
description: How to draw and maintain the architecture diagram Ensemblr keeps for a workspace — ensemblr_get_architecture_diagram to fetch the stored one (it answers with null when nobody has drawn this workspace yet), the IR shape, how to derive it from the codebase, and ensemblr_update_architecture_diagram to store it. Read this when asked to draw, generate, improve, correct, annotate, or explain the workspace architecture diagram.
---

# Drawing the architecture diagram

Ensemblr keeps an architecture diagram of every workspace at
**`.ensemblr/architecture.json`**, committed alongside the code it describes. The
user opens it from the tab strip.

**Nothing derives it.** The app ships no scanner: a workspace nobody has drawn
has no diagram at all, and its pane shows an empty state whose button opens a
fresh chat and asks for one — which may well be how you got here. Producing it is
entirely your work, and what you store is what the user sees until somebody
stores something else.

Read and write it through the two ops below rather than by editing the file
directly — they validate the document, and the update op refreshes any diagram
tab the user has open.

So the job is one of two, depending on what the read answers: **draw one from
the codebase** when there is none, or **edit the one that exists** when there
is. Either way the target is a drawing a maintainer would make, not a dump of
the folder tree.

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

**The read answers `diagram: null` when nobody has drawn this workspace.** That
is an ordinary answer, not a failure and not something to retry: there is no
scanner to invoke and nothing to go hunting for. Read the codebase and author
the document yourself.

The one thing the read *can* refuse is a stored file it cannot parse — a hand
edit, a merge conflict, a document with one bad field. It says so and names the
problem rather than inviting a replacement over the top, because that file is
tracked and overwriting it would delete work out of the user's diff. Repair or
delete it; do not work around it.

A document that *does* come back is a thing to **edit**, not evidence to reason
from — see *It is a drawing for people* above. Edit it rather than replacing it
wholesale, or you discard whatever the last pass got right.

## Drawing one from nothing

Read the repository first. Its own documentation is the fastest route to the
concepts: a `README`, an `AGENTS.md` or `CLAUDE.md`, an architecture map under
`docs/`, and the top-level directory listing. Then:

1. **Pick the nodes.** One per directory that a maintainer would name out loud,
   at whatever depth that lands — usually two or three levels, not every folder.
   A directory nobody would mention is not a node.
2. **Give each one `sources`**, pointing at the directory it stands for, so a
   click in the pane opens it.
3. **Derive the edges** from what actually imports what. Sample the imports
   rather than exhaustively parsing the tree; the drawing wants the edges that
   carry meaning, not every one that exists.
4. **Group them into regions** by concern, and use `organic` unless the user
   asked otherwise.

Then apply everything below — it is the difference between a folder tree and a
drawing.

## What only you can do

- **Boundary labels.** Name a region for its concern — *Main process*,
  *Renderer*, *Cross-process contracts* — rather than for its directory path.
- **Node types.** `storage` is a database, `renderer` a frontend; but a
  directory called `lib` may really be the permission gate. Only reading the
  code settles it.
- **Noise.** A repository has directories that are true but not interesting —
  fixtures, generated output, a one-file shim. Leave out the nodes that do not
  help a reader, and leave out the edges that only exist because everything
  imports the types module.
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

Two modes. Prefer `organic`, which needs no coordinates; `grid` is for a
document that was hand-placed, or one archify authored.

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

What you store is the diagram from then on. Nothing in the app derives or
regenerates one, so your work is never undone by it — and equally, a diagram
left stale after a refactor stays stale until somebody fixes it.

The op answers with the component and connection counts it stored. A document
that does not validate comes back with the **field paths** that failed
(`components.0.type: Invalid option…`); fix those and resubmit the whole
document rather than dropping the fields it complained about or guessing at a
different shape.

## When not to touch it

- The user asked about something else. A diagram that is roughly right is not
  worth a turn of its own; it is not upkeep you owe on every task.

  The exception is when the app says otherwise. Ensemblr checks each turn
  whether your change set landed inside a component's `sources` and whether
  those files moved after the document was drawn; when both hold it adds a
  diagram line to the session upkeep block naming the nodes involved. That line
  is the app telling you this drawing is now wrong about code you touched, so
  act on it rather than reading this bullet as a reason not to. It appears only
  where a diagram already exists — a workspace nobody has drawn is never nudged
  into having one.
- You have not called `ensemblr_get_architecture_diagram`. Guessing at a
  replacement discards whatever the last pass got right — and the read is one
  call, so there is no reason to skip it.
- The repository is mid-refactor and the shape is about to move again.
- You wanted to *look something up*. The diagram is not a lookup surface; read
  the code.
