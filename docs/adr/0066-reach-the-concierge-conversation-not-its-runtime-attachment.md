# 0066. Reach the Concierge Conversation, Not Its Runtime Attachment

Date: 2026-09-07

## Status

Accepted

Amends [0059](./0059-let-agents-reach-sideways-and-upwards.md), which decided
that `messageConcierge` refuses rather than revives. That decision stands for
what it was written about — a Concierge conversation that does not exist — and is
narrowed here: a conversation that exists but has no runtime child attached is
delivered to. Everything else 0059 decided about the op is unchanged, the late
session resolution and the "not a queue" rule included.

## Context

0059 asked the right question and gated on the wrong noun.

The rule it wrote down is that a message must never bring a Concierge
conversation into being, because one that booted from an agent would spend tokens
on a conversation nobody asked for and nobody would think to read. That is
correct. What it gated on is `active` — the in-memory runtime attachment — and an
attachment is not a conversation. The conversation is the row: the transcript the
panel reopens into, and the thing a user means when they say their Concierge is
open.

Those two nouns come apart constantly, and every time they do the one channel an
agent has upward reports that there is nobody there:

- **The panel has not been opened this launch.** Nothing attaches a Concierge
  child at boot. The first attach is the panel's own effect, gated on
  `presentation !== 'closed'`. An agent that reaches upward before the user has
  clicked the Concierge once is told no conversation exists, while the
  conversation sits on disk with its whole transcript.
- **The user pressed stop.** `stopSession` aborts the child, which shuts it down
  and clears the attachment. The row stays open, and `submitPrompt` documents
  that the next user prompt revives from exactly this state.
- **The child crashed.** The automatic heal only runs for the runtime's own
  `session-unresumable` classification; a child lost any other way is released
  and never replaced until somebody types.
- **A clear is halfway through.** `runClearContext` detaches, then launches a
  replacement process. Refusing inside that window reports the conversation gone
  a moment before handing the user a live one.
- **The child died under the send.** 0059 anticipated this one and chose to
  report `no-session` for it, reasoning that the alternative was a revive.

The refusal copy makes the mismatch concrete. It tells the agent "No Concierge
conversation is open, so there is nobody up there to read this", and instructs it
to abandon the message and put it in its own last turn instead. In five of the
six states above that is false, and the instruction throws away the discovery the
op exists to carry.

The argument 0059 gave for refusing — a revive "starts a Concierge turn nobody is
watching" — does not separate the cases it was used to separate. Delivering into
an attachment that is live but idle also starts a turn nobody is watching; the
user may have walked away, and under AFK they demonstrably have. Whether somebody
is watching *right now* is not a property the app can read, and it is not what
decides whether a message lands somewhere a human will eventually see it. What
decides that is whether a conversation exists to land in.

## Decision

**Reachability is answered against the persisted conversation, not the live
attachment.** `deliverAgentMessage` resolves the newest row nothing has closed —
the same row the panel reopens into, and only when its provider still matches
settings, since a row the current runtime cannot resume is not a conversation
anybody can return to. Where that row has no child, one is attached and the
message delivered into it.

**Nothing on this path creates a conversation.** No `fresh` open, no new row. No
open row means the refusal 0059 wrote, with its copy unchanged, because that is
the case the copy was written for.

**Nothing on this path holds a message.** The op still never queues. It waits
only on a lifecycle operation already running, which is bounded by that operation
and lands in the conversation that operation produces — a clear mid-flight is
waited out rather than reported as an absence. That is ordering, not storage.

**A child that dies under the send is rebuilt once.** It died between the attach
and the submit, so the conversation is intact and only its attachment is gone.
A second refusal is a runtime that cannot hold a child at all, which is not a
race, and retrying it is how one message becomes a process per attempt.

**A failed attach leaves the conversation alone.** `attachRuntime` closes the row
it could not attach — correct for the two paths a user drove, where the panel is
reporting a runtime *they* could not start and the next open should begin clean.
It is wrong for a background message, which has no standing to end a conversation
somebody else owns. The decision is a parameter on `attachRuntime` rather than an
inference from the caller, and rather than a repair applied to the row afterwards,
which would race the next attach and hide the choice from the reader.

**A delivery that reached the attach is charged for.** The per-session and
per-minute counters advance for a delivered message and for a failed one alike.
Only `no-session` stays free, because it returns before anything attaches and so
spends nothing — which is what a refusal cost when this op could not attach at
all.

**The three operations that attach or replace a child are serialised against each
other.** Opening, clearing, and this reattach each deduplicated their own
concurrent callers and none deduplicated against the other two, which left a
clear and an open able to sit inside the attach together — each having asked the
runtime for a child, whichever wrote the attachment last owning the conversation,
and the loser left running with nothing pointing at it and no handle left to
close it.

**A heal does not replace the conversation it is healing.** The heal reopened
through the ordinary `fresh: false` path, which closes a row whose provider has
since changed and opens a replacement — correct for a user switching runtimes,
wrong as the repair for a crash, where it closed the very conversation being
rebuilt and then dropped the held prompt for landing in the wrong row. A row the
current runtime cannot resume is now not healed at all.

## Consequences

An agent can reach the Concierge whenever the user has one, which is what the op
was for. The most common failure — reaching upward before the panel has been
opened once — stops being a failure.

An agent message can now start a runtime process. That is the real cost, and it
is bounded three ways: only ever onto a conversation that already exists, only
one rebuild per message, and behind the guardrail counters 0059 already set at 10
per session and 3 per minute. Those counters are what makes the bound hold, and
they only hold because a failed delivery is charged for as well as a delivered
one — a budget that advanced on success alone would have left an agent looping
against a broken runtime spawning two children per attempt with nothing counting
them. So: at most twenty runtime children over a workspace conversation's whole
life, six in any minute, however broken the runtime is.

A failed attach from this path leaves the conversation intact. That is what the
`onFailure` parameter buys, and it is the property that matters most here: a
background agent cannot close a conversation the user owns. Before it, a message
that hit a missing executable or a refusing runtime marked the row closed and
errored, and the user's next look at the panel opened a fresh conversation with
their whole transcript orphaned and no way to reach it.

A Concierge turn can now begin without the panel having been opened. It was
already true that a turn could begin with nobody watching; what is new is that
the transcript may be one the user has not looked at this launch. It is the
transcript they will look at, headed `MESSAGE FROM AN AGENT` exactly as 0059
specified, and the unread badge the panel already carries is what tells them.

`deliverAgentMessage` and `submitPrompt` no longer take opposite branches at the
attachment fork; they diverge one step later, at the row. `submitPrompt` opens a
conversation where there is none, because a user typing into the panel is asking
for one. `deliverAgentMessage` refuses there, because an agent is not.
