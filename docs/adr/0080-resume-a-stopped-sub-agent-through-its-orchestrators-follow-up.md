# 0080. Resume a Stopped Sub-Agent Through Its Orchestrator's Follow-Up

Date: 2026-10-01

## Status

Accepted

Narrows how far [0059](0059-let-agents-reach-sideways-and-upwards.md) lets
`ensemblr_send_follow_up` reach. A live conversation is steered as before. A
stopped one is resumed only when it is the sender's own sub-agent.

## Context

Stopping an orchestrator stops every sub-agent under it. Once the user resumes
the orchestrator from its composer, the sub-agents stay stopped. A sub-agent's
tab has no composer, so nothing could bring one back.
`ensemblr_send_follow_up` failed with `session-not-open`, and the orchestrator
had to spawn a fresh child and re-brief it from nothing.

A first version resumed any stopped conversation a follow-up reached. Review
turned up four costs:

- **Roots skipped the co-tenancy cap.** A resumed root registers an origin and
  counts as a writer on the checkout, but nothing reserved it a slot. Stopping a
  peer and sending it a follow-up seated a third writer where two is the limit.
- **Roots lost their linked directories.** Those grants live only in the
  renderer's per-chat state. The composer passes them on resume; main cannot.
- **The tab title reset.** Rebinding a tab ran the naming-gate reset meant for
  a tab handed to a *new* session. The next turn-idle then re-derived the title
  from the brief, over the one the orchestrator chose.
- **The mode toggles drifted.** A child spawned planning keeps its Plan toggle
  on in the renderer after the stop releases main's registry. Resumed by a
  sender that is not planning, it showed Plan over a runtime free to edit.

The Plan Mode gate also read the target twice: once in the service, and again
when the port acted. A runtime that opened between the two reads let a planning
sender steer a live conversation that is not planning.

## Decision

`ensemblr_send_follow_up` resumes a stopped conversation only when the target's
tab carries the sub-agent marker **and** the persisted lineage names the sender
as its parent. Everything else that is stopped is refused with `denied-scope`
and a reason the agent can act on. That covers a peer, a Review conversation, a
chat the user started, and another orchestrator's sub-agent.

- **The port decides at the moment it sends.** `ConversationPort.sendFollowUp`
  returns `{ ok: true } | { ok: false; reason }`, in the shape of
  `StartConversationOutcome`.
  - For a live target, the refusal check and the submit run with no `await`
    between them. A planning sender is refused a target that is not planning on
    the read its turn actually lands on.
  - The service keeps its earlier check as the fast answer, and it still runs
    after the scope check.
- **The resume reuses the composer's door.**
  - `openSession` with `resumeSessionId` and the tab the child already lives
    in. History and lineage come from the persisted row.
  - The sender's Plan Mode and AFK state are handed over as a spawn hands them.
  - Any mode not handed over is mirrored to the renderer as the registry
    holds it.
- **Rebinding keeps the title.** `attachSessionToChatTab` resets the naming
  gate only when the tab moves to a different session. This also stops a
  composer resume from discarding an agent-chosen title.

## Alternatives considered

- **Resume roots too, behind a co-tenancy reservation.** Rejected. It would
  close the cap gap, but not the linked-directory gap: main cannot see those
  grants. It would also let any orchestrator undo a stop the user made on a
  root, which has a composer of its own for exactly that.
- **Resume any marked sub-agent, whoever sends.** Rejected. The cap leaves
  sub-agents out because the orchestrator that opened one sequences it. Resumed
  by a peer, a stopped child would write with nobody sequencing it and nobody
  counting it.
- **Move the whole Plan Mode gate into the port.** Rejected for now. It would
  remove the duplicate read, but the service-level tests for that gate would
  have to fake the policy they exist to test. The port re-checks instead, and
  the service's answer stays the early one.

## Consequences

- An orchestrator resumed after a stop can bring its children back with a
  follow-up, in its own Plan Mode and AFK state, in their own tabs.
- An agent that tries to resume anything else gets a refusal naming who can:
  the user for an orchestrator, the owning orchestrator for a sub-agent.
- A sub-agent the user stopped on its own, while its orchestrator kept running,
  can be resumed by that orchestrator. Stopping one child does not fence it off
  from its parent.
- Two concurrent follow-ups to the same stopped child race on `openSession`.
  The second fails with "already opening" rather than opening a second runtime.
