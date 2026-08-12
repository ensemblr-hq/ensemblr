# 0047. Model Composer Attachments as One Ordered List Inside a Lexical Draft

Date: 2026-08-12

## Status

Accepted

Supersedes the pasted-image attachment model from `1cbf07c` (#99) and the
Linear-only issue picker that inlined a one-line context block.

## Context

The composer had accumulated three parallel ways to give an agent something to
read, each added on its own and none aware of the others:

| Kind | State | How it reached the prompt |
| --- | --- | --- |
| Pasted image | uploads atom family | appended after the draft |
| `@`-mentioned workspace file | mentions atom family | appended after the draft |
| External path | externals atom family | appended after the draft |

Three consequences followed from that shape:

- **Order was lost.** All three families flushed into the outgoing prompt at one
  end, so "compare this screenshot against that file" arrived as prose with two
  blocks hoisted below it, and the agent had to re-derive which was which.
- **Chips stacked above the text rather than sitting in it.** A `<textarea>` can
  hold no inline object, so the visual model contradicted the mental one: the
  user thought of an attachment as *a word in the sentence*, and the UI drew it
  as a tray.
- **Anything new meant a fourth family.** Handing the agent a Linear issue, a
  review-comment thread, or a directory outside the workspace each wanted its own
  atoms, its own prompt-flush branch, and its own chip rendering.

Separately, the paste path wrote nothing to disk: image bytes lived in renderer
memory and were inlined into the prompt, so an attachment had no path an agent
could re-read and no identity across sends.

## Decision

### 1. One `ComposerAttachment` list, in document order

The three atom families collapse into one ordered `ComposerAttachment` list. The
order the user attached things in is the order the outgoing prompt carries, and
`<attached_file>` blocks are **interleaved at the position their chip occupies**
rather than hoisted to one end. The persisted prompt is read back the same way,
so a message bubble shows what was actually sent.

Adding a kind is adding a variant to that list — not a fourth parallel family.
Issues, review-comment threads, pasted text, and linked directories all landed
afterwards as variants.

### 2. A Lexical editor, because a chip has to be a node

The `<textarea>` is replaced by a **Lexical** plain-text editor
(`lexical` + `@lexical/react`, `^0.49`). A chip is a decorator node, which buys
exactly the two behaviours the tray model could not express: the caret steps
over it as one unit, and Backspace deletes it whole. The explicit "remove last
mention" shortcut is gone because it no longer describes anything.

**Lexical does not leak past the editor.** `editor/` publishes the draft back out
as plain text plus its runs and chips in document order (`draft-linearizer.ts`),
so the autocomplete engine, the send pipeline, and the follow-up queue never
learn that a rich-text editor is involved. That boundary is what keeps the
dependency swappable and what kept the change from touching the send path.

### 3. Attachments are content-addressed on disk, written at attach time

Pastes, drops, and picked files are written to `.context/attachments/<digest>/`
**the moment they are attached**, not at send. Every chip therefore carries a
real path from the instant it appears, re-attaching the same bytes costs
nothing, and an agent can re-read an attachment on a later turn.

Placement uses `link` rather than a write-in-place, so a concurrent reader never
observes a partial file and two writers racing on one payload converge on the
same path instead of corrupting it.

Pasted images are validated by **magic bytes against the declared MIME type**
before being persisted. A mislabeled payload is refused rather than announced to
the agent as an inspectable image. `list-workspace-files.ts` gave up its
path-safety and image-signature helpers to `workspace-paths.ts` and
`workspace-images.ts` so the attachment store and the file lister agree on what
"inside the workspace" means.

A paste over 5k characters becomes a `.txt` attachment with a preview chip
instead of burying the draft.

### 4. A referenced thing is written out as a document, not summarized

An issue and a review-comment thread are both serialized to a markdown document
and attached as a chip — metadata, body, and every comment. The agent reads the
whole thing as a file.

This replaces two summarizers (`formatCommentContext`,
`formatAllCommentsContext`, and the issue picker's one-line context block) that
flattened a thread to a single line and, in the comment case, told the agent
every non-local comment came from GitHub. A summary is a lossy answer to a
question the agent has not asked yet.

Budgets bound it: at most ten comments per "add all" with the shortfall named,
and up to 8k characters inlined per comment. The old path was bounded only
because it carried summaries.

### 5. The attachment channel is addressed, never broadcast to "the composer"

Attaching from outside the composer — a review comment, a file row — goes through
an app-global channel. An entry addressed to "whichever composer is mounted"
could outlive a workspace switch and drain a workspace-relative path into a chat
on another root, where the send then fails on a chip the user never added.

Entries are addressed to **one chat tab or one workspace root**, and only a
composer editing that root takes a broadcast.

### 6. Linked directories are a grant, not an attachment

A directory outside the workspace is not serialized. It is a **read grant**,
per chat and sticky across sends, backed by an app-global recents list and
carried into the Claude SDK's `additionalDirectories` on `openAgentSession`.

Two properties are deliberate:

- **Symlinks are not resolved.** The path the user picked is the path that is
  granted. Resolving would silently widen or narrow the grant relative to what
  the user chose.
- **A directory linked mid-session is marked pending**, and the composer says the
  chat has to reopen. Claude takes those roots only at launch, so the honest
  answer is to say so rather than let the agent hit an unexplained permission
  denial.

## Consequences

- **Lexical is a renderer dependency with a hard boundary.** Everything Lexical
  touches lives under
  `src/renderer/components/workbench-shell/conversation-panel/composer/editor/`
  behind its `index.ts`. Reaching for a Lexical import outside that folder is the
  signal that the linearizer is missing a case.
- **`.context/attachments/` grows and is not garbage-collected.** It is inside
  the workspace's gitignored `.context/`, so it archives with the workspace and
  disappears with it, but a long-lived workspace accumulates every payload ever
  pasted into it. Content addressing bounds the duplicate cost, not the total.
- **A chip's identity is its digest, not its filename.** Two different files with
  identical bytes are one attachment. That is correct for re-attachment and
  surprising for a user who renames a file and expects a new chip.
- **The composer now has a per-chat body key.** Because the editor and
  `useComposerState` mount at different levels, `ComposerPanel` keys its own body
  rather than asking the call site to — otherwise the editor remounts on a chat
  switch while the state hook survives and re-seeds the previous tab's draft.
- **PDF preview came with it.** The workspace read returns PDFs as bytes under
  `application/pdf` and the renderer embeds them through a blob URL, since
  Chromium refuses to navigate a frame to a `data:` URL and ships its PDF viewer
  as a plugin — so the main window opts into plugins.
