/**
 * Locale-neutral taxonomy of the ways an agent turn can fail. Every agent
 * runtime reports its failures as prose in whatever language and wording its
 * provider chose, so the class is what the renderer keys designed copy and
 * recovery actions off — the runtime's own sentence survives only as disclosed
 * detail.
 *
 * The classes are grouped by what the user can *do*, not by which layer raised
 * the error: `provider-truncated` and `provider-overloaded` both come back as
 * `adapter-failure` on the wire, but one is resumable and the other is worth
 * waiting out.
 */
export type AgentFailureClass =
	/** The turn no longer fits the model's context window. */
	| 'context-overflow'
	/** Auth rejected: expired login, missing or invalid API key. */
	| 'credentials'
	/** The provider was unreachable — DNS, refused connection, dropped socket. */
	| 'network'
	/** The provider's own servers failed: 5xx, overloaded, service unavailable. */
	| 'provider-overloaded'
	/** The model declined to answer, on policy or safety grounds. */
	| 'provider-refused'
	/** The stream stopped mid-answer, so the turn above is incomplete. */
	| 'provider-truncated'
	/** Throttled by rate limit, quota, or plan window. */
	| 'rate-limit'
	/** The runtime process died before the turn finished. */
	| 'runtime-crashed'
	/** The runtime's executable could not be found or run. */
	| 'runtime-missing'
	/** The session was already closed when the turn was submitted. */
	| 'session-closed'
	/** The runtime no longer holds the conversation this session asked it to reload. */
	| 'session-unresumable'
	/** A tool call was blocked by the permission mode or a guard. */
	| 'tool-denied'
	/** Nothing in the taxonomy matched; the raw runtime text is all there is. */
	| 'unknown'
	/** The workspace directory the runtime was asked to open is not usable. */
	| 'workspace-invalid';

/**
 * The taxonomy keyed rather than listed, so a class added to the union above and
 * forgotten here is a compile error instead of a silent gap in every consumer
 * that enumerates it. Declaration order is what {@link AGENT_FAILURE_CLASSES}
 * reads back: roughly likeliest-first, matching the renderer's copy table.
 */
const CLASS_ORDER: Readonly<Record<AgentFailureClass, null>> = {
	'provider-truncated': null,
	'provider-overloaded': null,
	'provider-refused': null,
	'rate-limit': null,
	credentials: null,
	network: null,
	'context-overflow': null,
	'runtime-missing': null,
	'runtime-crashed': null,
	'workspace-invalid': null,
	'tool-denied': null,
	'session-closed': null,
	'session-unresumable': null,
	unknown: null,
};

/**
 * Every class, in the order the renderer's copy table declares them. Exported so
 * a catalogue, a playground scene, or a parity test can enumerate the taxonomy
 * without duplicating the union.
 */
export const AGENT_FAILURE_CLASSES = Object.keys(
	CLASS_ORDER,
) as readonly AgentFailureClass[];
