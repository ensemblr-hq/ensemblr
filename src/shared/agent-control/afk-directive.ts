/**
 * The per-turn block telling an agent the user is away, appended to every turn
 * a chat spends with the composer's AFK chip on.
 *
 * It rides the per-turn channel rather than a role playbook for the reason
 * {@link buildPlanModeDelegationDirective} does: a playbook is selected once at
 * session open and the shipped Pi extension carries byte-identical copies a
 * parity test polices, while the AFK toggle moves per turn. Rendering it here
 * means the extension appends a string it never authors and there is no second
 * copy of the wording to drift.
 *
 * The block does two jobs, and the second is the one that earns its length. It
 * tells the agent that `ensemblr_ask_user_question` is refused — which the
 * control gate enforces anyway — and it tells it what to do instead, because an
 * agent that only learns "no" retries the same call or stops, and both lose the
 * run this mode exists to keep moving. The rest is the counterweight to the
 * auto-approved permission confirmations: nobody is watching, so the agent's own
 * judgement is the only remaining gate on anything hard to reverse.
 */

/** Opening line of the block, and the marker tests assert on. */
export const AFK_DIRECTIVE_HEADER = 'USER IS AFK';

/** What the mode asks for, before it says what it takes away. */
const MANDATE = `The user has switched this conversation to AFK and is not at the machine. Nobody will read a question, approve a dialog, or unblock you until they are back — possibly hours from now. Finish the task. Where you genuinely cannot finish it, take it as far as it honestly goes and say where it stopped.`;

/** The refusal, with the behaviour that replaces it. */
const DECIDE_IT_YOURSELF = `\`ensemblr_ask_user_question\` is refused for as long as this block is here, and so is your runtime's own equivalent — asking would park the turn against an empty room and cost the whole run. Decide it yourself instead: take the most defensible reading of what they asked for, act on it, and record it. Every assumption you made on their behalf goes in your final message under its own heading, because that message is the only account of what you decided while they were away. Never end the turn with a question; a decision you could not safely take alone is one you name in that section, having done every part of the task that did not depend on it.`;

/**
 * The counterweight to the auto-approved confirmations. Stated as a standing
 * limit rather than a caution, because the dialog that would otherwise have
 * caught these is exactly what AFK answers on the user's behalf.
 */
const JUDGEMENT_IS_THE_GATE = `Permission confirmations are being approved on your behalf while this block is here, so your judgement is now the only gate on anything hard to reverse or outward-facing. Force-pushing, publishing, deleting beyond what the task needs, or sending anything to an external service: do none of it unless the task explicitly asked for it. AFK widens nothing else — a workspace that blocks writes still blocks them, and a decision the mode cannot make for you is still not yours to make for the user.`;

/** Why the bookkeeping matters more here, not less. */
const RECORD_KEEPING = `The app's own bookkeeping still applies, and it matters more on an unwatched turn than on any other: \`ensemblr_set_summary\` is what the user reads first when they come back, so it carries what you did, what you assumed, and what you left.`;

/**
 * Renders the AFK block, or null when the conversation is not unattended.
 * @param unattended - Whether the calling session has the AFK toggle on.
 * @returns The block to append to this turn's prompt, or null when it is off.
 */
export function buildAfkDirective(unattended: boolean): string | null {
	if (!unattended) {
		return null;
	}
	return `${AFK_DIRECTIVE_HEADER} — ${MANDATE}

${DECIDE_IT_YOURSELF}

${JUDGEMENT_IS_THE_GATE}

${RECORD_KEEPING}`;
}
