# 0068. Let AFK Agents Choose Review Delegation

Date: 2026-09-10

## Status

Accepted. Supersedes the mandatory independent-review and AFK delegation-override
parts of [0061](./0061-run-an-unattended-change-through-plan-review-and-a-pull-request.md).
The explicitly requested Review action from
[0063](./0063-open-an-agent-requested-review-as-a-peer-again.md) and the short-path
sizing from [0064](./0064-size-the-unattended-delivery-loop-to-the-change.md) remain.

## Context

AFK forced a second root orchestrator on the configured Review model, regardless
of the ordinary delegation rules and model-role preferences. That made a manual
action's preference an automatic delegation policy. The user chose to let the
agent decide both whether to delegate review and whom to delegate it to, rather
than merely removing the model pin from a still-mandatory reviewer.

## Decision

- Review remains part of delivery. Self-review is allowed on the full loop as
  well as the short path; checks, repairs, convergence limits, and honest reporting
  remain required.
- AFK follows normal work-splitting and context-pressure rules. Being unattended
  does not itself require a child, reviewer, or second orchestrator.
- Optional review delegates use ordinary delegation: live role preferences,
  permitted runtimes, model thinking ladders, and cost gates. They receive bounded,
  read-only review briefs and do not gain nested-delegation authority.
- Repairs stay with the orchestrator or a deliberately delegated repair task.
  Re-review does not force another spawn or a follow-up. A refused delegation
  falls back to self-review with the limitation reported, never a gate bypass.
- The manual Review button keeps its configured model and thinking level.
  `ensemblr_start_review` still performs that same action for an explicit user
  request. AFK alone is no longer such a request. Its existing runtime selection,
  reuse, co-tenancy limits, and guards are unchanged.
- Both Ensemblr and native delegation receive this policy. Reports say whether
  the agent self-reviewed or delegated review, and why.

## Consequences

A full AFK run can finish without another agent. It may lose the benefit of an
independent reader, so the agent must judge that tradeoff rather than claiming
that self-review is independent verification. Manual review behavior and settings
need no migration. The workflow no longer needs the harness feature flag or
special Review-session quota and continuity instructions.

This is an instruction-policy change, not a new runtime prohibition:
`startReview` remains callable for an explicitly requested unattended review.
