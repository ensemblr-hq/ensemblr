# 0067. Stand Stored-Text Chips in a Tray Above the Draft

Date: 2026-09-07

## Status

Accepted

Amends [0047](./0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md),
which decided that a chip is a word in the sentence and that a tray above the
text was the model being replaced. That holds for every chip whose whole
rendering is one row of label. It is narrowed here for the one kind that is not:
a stored-text chip stands above the sentence instead. The ordered list, the
interleaved prompt blocks, and the decorator-node mechanism 0047 chose are all
unchanged.

## Context

0047 replaced a `<textarea>` and its tray with a Lexical editor precisely so a
chip could sit *in* the sentence, and it named the tray as the thing being fixed:
"the user thought of an attachment as a word in the sentence, and the UI drew it
as a tray."

That reasoning is sound for the chip 0047 was looking at. A workspace file, an
external path, an issue, a review comment, a linked directory, a reference to
another workspace — each is a single row of label, roughly the size of a word,
and reads as one when the caret steps over it.

Pasted text is not that chip. It has no filename the user would recognise, so its
chip is the only thing saying *which* block it stands for, and it earns that by
showing the opening of the text: a two-line preview stacked over a meta row,
close to three lines tall. Inline, that inflates the line box it sits in. The
sentence wraps around a block three times its height, the run before the chip and
the run after it land on different lines with a wall of monospace between them,
and the draft stops reading as a sentence at all.

The composer had been compensating for the height rather than questioning the
placement: the chip's host span was sized to the chip instead of to the line,
which stopped the scroll container clipping the preview but did nothing about
what the surrounding text then did.

## Decision

**A stored-text chip is a root-level block pinned to the top of the draft,
rendered as a wrapping tray row above the typed text. Every other chip stays
inline.** `isTrayChip` in `attachment-node.tsx` is the single authority on which
is which, and every path that creates a chip consults it — the opening document,
an attach, and an `@`-token replacement alike.

Three properties follow, and all three are the point:

- **It stays one ordered list.** The chip is still an `AttachmentNode` in the
  same Lexical document, so 0047's `ComposerAttachment` list, the linearizer,
  `segments`, the snapshot round-trip, dedupe, remove-by-id, the send pipeline
  and the follow-up queue are untouched. Nothing here is a second state family.
- **Attach order is no longer prompt order for a mixed batch.** A tray chip is
  spliced in at the top, so attaching a file and then a paste publishes the paste
  first. This is a real narrowing of 0047's decision 1, and it is the honest
  answer: the prompt carries what the composer shows, and the composer shows the
  tray above the sentence.
- **The tray is not deleted by editing the sentence.** Lexical's own backward
  delete walks out of the first block and takes its previous sibling, so a
  backward delete at the start of the text — where one normally does nothing —
  would silently remove the last tray chip, and on an empty draft would delete
  the paragraph and leave nowhere to type. `TrayGuardPlugin` refuses it, and it
  is registered against `DELETE_CHARACTER_COMMAND`, `DELETE_WORD_COMMAND` and
  `DELETE_LINE_COMMAND` rather than against the keystroke: Lexical sends a bare
  Backspace through `KEY_BACKSPACE_COMMAND` but routes ⌥⌫, ⌃⌫, ⌘⌫, ⌃H and the
  `deleteContentBackward` input event straight to those three, so a guard on the
  key alone would leave four doors open. With several chips in the tray, which
  one a delete takes is neither visible nor guessable; they come off with their
  own control.

## Alternatives rejected

- **Move stored-text attachments out of the Lexical document into their own
  composer state.** This is the fourth parallel family 0047 collapsed. It wants
  its own atoms, its own draft persistence, its own send flush, and it breaks the
  `segments` contract that makes a sent bubble show what was actually sent — a
  large blast radius for what began as a layout complaint.
- **Portal the chip into a tray while leaving the node inline.** The node keeps
  its caret stop and its stand-in space, so the caret halts at nothing and
  Backspace eats an attachment with no visible cause. A phantom is worse than the
  bug it replaces.
- **Shrink the chip to a one-row label like every other chip.** It fixes the
  layout, but the preview is the only thing distinguishing one stored block from
  another, and dropping it makes two pastes indistinguishable.

## Consequences

- **`BLOCK_SEPARATOR` in `draft-linearizer.ts` starts being reached.** The draft
  was always a single paragraph before this — plain-text mode turns Enter and a
  pasted newline into a `LineBreakNode` inside the paragraph rather than a second
  block — so the separator was referenced but never executed. A tray chip is the
  first thing that makes the draft more than one block, so `LinearizedDraft.text`
  now carries a newline per block boundary. Those newlines are load-bearing for
  the offsets `segments` and `caret` are measured in, and `segmentBlock` trims
  them back out of each run, so the prompt is unaffected.
- **The tray scrolls with the draft.** It lives inside the editable rather than
  above it, so a long draft scrolls the chips out of view. That is the cost of
  keeping one document and one ordered list, and it is the right trade: a tray
  outside the editor is the parallel-family design above, wearing a different
  hat.
- **A pre-0067 draft snapshot is not a migration.** Snapshots are in-memory per
  chat tab — `composerEditorStateAtomFamily` holds a live `EditorState` and
  nothing writes one to disk — so none survives the process that built it, and a
  packaged build never restores a tree the running code did not make.
