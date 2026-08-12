# Product Docs Archive

Planning documents whose structure has been overtaken by shipped work. They are
kept for provenance — to show how the plan was framed at the time — and are **not
maintained**. Nothing in here is a live checklist, and a claim in an archived
document loses to the live doc it points at.

Each file carries an archive banner at the top naming the date, the reason, and
its live equivalent.

## Contents

| File | What it was for | Superseded by |
| --- | --- | --- |
| [`dependency-map.md`](./dependency-map.md) | A Mermaid dependency graph and per-milestone critical path over the local `ENS-*` planning IDs, generated from `docs/product/linear-issues.md`. | `docs/product/implementation-roadmap.md` — *Milestone Dependencies* for the ordering constraints, *Completed Implementation* for shipped state with PR/commit evidence. Shell detail lives in `docs/product/current-shell-inventory.md`. |
| [`mvp-sequencing.md`](./mvp-sequencing.md) | The original milestone 0–5 build order plus the deferred-until-post-core list, written to fix implementation sequence ahead of the core build-out. | `docs/product/implementation-roadmap.md` — *Roadmap Sequence* for the milestone order, *Milestone Dependencies* for the constraints, *Completed Implementation* for evidence. Its deferred list survives verbatim as *Explicitly deferred until post-core*. |

## Archiving another document

Move it with `git mv`, add the banner (date, reason, live equivalent), add a row
above, and fix inbound links across the repo. Do not delete: the point of this
directory is that the record survives.
