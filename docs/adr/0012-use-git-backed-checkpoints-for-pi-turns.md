# 0012. Use Git-Backed Checkpoints for Pi Turns

Date: 2026-06-04

## Status

Accepted

## Context

Conductor supports checkpoints: automatic snapshots of an agent's code changes that let users inspect what changed turn by turn and revert to an earlier user message. Public docs describe checkpoints as local private Git refs captured before supported agent responses.

Ensemblr needs equivalent behavior for Pi sessions. Pi also has tree-structured session history, so conversation history and file-state checkpoints must be modeled separately.

## Decision

Ensemblr will use git-backed checkpoints tied to Pi user turns.

Before each Pi user prompt is executed, Ensemblr will capture the workspace's current file state into a private local Git ref. That checkpoint will be associated with the Ensemblr workspace, Pi session, and Pi/Ensemblr turn id.

Private ref shape:

```text
refs/ensemblr/checkpoints/<workspace-id>/<turn-id>
```

Responsibilities:

- Pi session tree remains the source of conversation/session branching semantics.
- Ensemblr checkpoints represent file state at turn boundaries.
- Ensemblr SQLite stores checkpoint metadata and the mapping between workspace, Pi session, turn, and Git ref.

Restore behavior:

- Restoring a checkpoint reverts workspace files to the checkpoint state.
- Restoring hides or invalidates Ensemblr-visible messages and events after the selected turn.
- Ensemblr will not destructively edit Pi session files in v1.
- If Pi RPC/session commands can safely continue from the restored point, Ensemblr may use them. Otherwise Ensemblr starts a new continuation while preserving original Pi session history.

## Alternatives Considered

### Use Pi session tree only

Pi's tree-structured sessions are useful for conversation branching, but they do not replace git/file snapshots. A user needs to restore actual workspace file state, not only navigate chat history.

### Mutate Pi session files directly

Editing Pi's session JSONL files could make Ensemblr's visible history match a destructive restore, but it risks corrupting Pi state and diverging from Pi's own session semantics. This is rejected for v1.

### Use Conductor checkpoint refs

Ensemblr could try to discover and reuse Conductor checkpoint refs. This may be investigated later for shared-root interoperability, but it is not a safe dependency for v1 because Conductor's private ref format is not a public contract.

## Consequences

- Ensemblr can show turn-by-turn code changes and restore file state like Conductor.
- Pi session history remains intact even after Ensemblr restores a file checkpoint.
- The UI must clearly explain that restoring a checkpoint affects workspace files and Ensemblr-visible continuation state, not necessarily deleting Pi's underlying session history.
- The implementation must avoid destructive git operations that affect unrelated user changes outside the selected restore scope.
- Same-workspace multi-session checkpoint restore needs caution because another active Pi session may have made later changes.
