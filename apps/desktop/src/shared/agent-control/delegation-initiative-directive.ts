/**
 * The per-turn block that holds delegation back until the user asks for it,
 * appended to every turn a delegating role spends with the Models setting on
 * `on-request`.
 *
 * It rides the per-turn channel rather than a role playbook for the reason
 * {@link buildAfkDirective} does: a playbook is selected once at session open
 * and the shipped Pi extension carries byte-identical copies a parity test
 * polices, while this setting moves whenever the user opens Settings. Rendering
 * it here means the extension appends a string it never authors and there is no
 * second copy of the wording to drift.
 *
 * It is advisory, and deliberately so. Nothing in a control call distinguishes a
 * spawn the user asked for from one the agent decided on, so refusing the spawn
 * ops would refuse both and leave "delegate this" unanswerable. The block
 * therefore does what the review rule in the orchestrator playbook does: it
 * states the limit, names what lifts it, and says what to do instead — because
 * an agent that only learns "no" either stalls or works around it.
 *
 * Only a workspace orchestrator carries it. A sub-agent already has the spawn
 * ops denied by {@link SUBAGENT_BLOCKED_OPS}, so the block would describe a
 * restriction it is already under. The Concierge reaches this channel like any
 * other caller and is exempt on its own merits: dispatching work to workspaces
 * is its one job rather than an optimization it chose, it has no workspace to do
 * the work in, and it is the only caller that can change this setting. An
 * unattended turn is exempt by design too: nobody is there to ask, and the whole
 * point of that mode is a run that keeps moving.
 */

import type { AgentControlRole } from './awareness.ts';
import type { DelegationInitiative } from './delegation-initiative.ts';
import type { SubagentMechanism } from './subagent-mechanism.ts';

/** Opening line of the block, and the marker tests assert on. */
export const DELEGATION_ON_REQUEST_HEADER = 'DELEGATE ONLY WHEN ASKED';

/** What the setting asks for, framed as configuration rather than a verdict on the task. */
const MANDATE = `The user has switched proactive delegation off in Settings → Models. Do this work yourself, in this conversation. That is a standing preference about how they want their agents to run rather than a judgement about the task in front of you, so do not argue it, do not weigh it against how well the work splits, and do not treat a task that would fan out beautifully as the exception it was written for.`;

/** The one thing that lifts it, stated concretely so an agent can recognize it. */
const WHAT_LIFTS_IT = `An explicit ask from the user lifts it for that work — "delegate this", "fan out", "use sub-agents", "spawn a reviewer", "have someone else look at X", or naming a number of agents they want. Once they ask, delegate normally under the full rules in your role playbook: split the work first, brief each child with what to deliver, wait on them, verify a load-bearing claim yourself. The limit is on your own initiative, not on the mechanism.`;

/**
 * What replaces the spawn, so a filling window produces an offer rather than a
 * silent squeeze. Without this the block trades one failure for another: an
 * agent that will not delegate and will not say why simply runs out of room.
 */
const WHEN_THE_WINDOW_FILLS = `Your context window is still a budget, and this block does not give you more of it. When a unit of reading is genuinely too large to take on here, say so plainly and offer the hand-off — name what you would delegate and what it would cost — then carry on with whatever does not depend on it. An offer the user can accept in one word is what this setting asks for; a hand-off they did not ask for is what it asks you not to do.`;

/** Where the mechanism matters, so the block names a tool the caller actually holds. */
const MECHANICS_ENSEMBLR = `Concretely: do not call \`ensemblr_start_conversation\` on your own initiative, and do not open a peer orchestrator or launch a harness to route around it.`;

/** The same limit for a root delegating through its own runtime's sub-agent tool. */
const MECHANICS_NATIVE = `Concretely: do not reach for your runtime's own sub-agent tool on your own initiative, and do not launch a harness to route around it.`;

/**
 * What the setting does not touch, so it is not read as a general ban on
 * anything that opens another agent.
 */
const UNCHANGED = `Nothing else changes. The Review conversation, a peer orchestrator, and a harness already require the user to ask for them in so many words, so this block takes nothing further away from you there. An unattended turn never carries this block at all — the user is away, nobody can answer an offer, and delegating freely is what that mode is for.`;

/**
 * Renders the delegate-when-asked block, or null when it does not apply.
 * @param options - The chosen initiative, the pinned delegation mechanism, the caller's role, and whether the turn is unattended.
 * @returns The block to append to this turn's prompt, or null when the setting is off, the turn is unattended, or the caller is not a workspace orchestrator.
 */
export function buildDelegationInitiativeDirective({
	delegation,
	initiative,
	role,
	unattended,
}: {
	delegation: SubagentMechanism;
	initiative: DelegationInitiative;
	role: AgentControlRole;
	unattended: boolean;
}): string | null {
	if (initiative !== 'on-request' || unattended || role !== 'orchestrator') {
		return null;
	}
	return `${DELEGATION_ON_REQUEST_HEADER} — ${MANDATE}

${WHAT_LIFTS_IT}

${WHEN_THE_WINDOW_FILLS}

${delegation === 'native' ? MECHANICS_NATIVE : MECHANICS_ENSEMBLR}

${UNCHANGED}`;
}
