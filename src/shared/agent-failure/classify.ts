import type { AgentFailureClass } from './failure-class.ts';

/**
 * The part of a runtime error this classifier reads. Declared structurally so
 * both the main-process `AgentError` and the wire `AgentWireError` satisfy it
 * without either side importing the other's module.
 */
export interface ClassifiableAgentFailure {
	code?: string;
	detail?: string | null;
	message: string;
}

/**
 * One text probe: the class a match implies, and the pattern that recognizes it.
 * Order is significance, not preference — the first match wins, so the more
 * specific reading of an ambiguous sentence has to come first.
 */
interface FailureProbe {
	failureClass: AgentFailureClass;
	pattern: RegExp;
}

/**
 * Probes applied in order against the runtime's message and detail.
 *
 * `provider-truncated` leads deliberately: the string that prompted this
 * taxonomy — "API Error: Server error mid-response. The response above may be
 * incomplete." — matches the overloaded probes too, and "your answer is cut
 * off, resume it" is the reading the reader can act on.
 *
 * The crash probes sit above the HTTP-status ones so an exit code in the 500s
 * is not read as a gateway error, and `session-unresumable` sits above them in
 * turn because a runtime that refuses to reload a conversation exits like any
 * other crash.
 */
const FAILURE_PROBES: readonly FailureProbe[] = [
	{
		failureClass: 'provider-truncated',
		pattern:
			/may be incomplete|incomplete response|mid-?response|truncated|max_tokens|stopped mid-?(stream|answer)/i,
	},
	{
		failureClass: 'credentials',
		pattern:
			/\b(401|403)\b|unauthori[sz]|authentication|invalid[\s_-]?api[\s_-]?key|api[\s_-]?key[\s_-]?(is\s)?(missing|invalid|not)|credential|not logged in|please run \/login|token (has )?expired|oauth/i,
	},
	{
		failureClass: 'rate-limit',
		pattern:
			/\b429\b|rate[\s_-]?limit|too many requests|quota|(usage|plan|session|weekly|hourly|\d+-hour) limit|limit will reset|billing|insufficient (credit|funds)/i,
	},
	{
		failureClass: 'context-overflow',
		pattern:
			/\b413\b|context (window|length|limit)|prompt is too long|too many tokens|maximum context|exceeds? the (model|context)/i,
	},
	{
		failureClass: 'network',
		pattern:
			/\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ECONNABORTED)\b|fetch failed|socket hang ?up|getaddrinfo|network (error|is unreachable|unreachable)|connection (refused|reset|timed out)|offline/i,
	},
	{
		failureClass: 'runtime-missing',
		pattern:
			/\bENOENT\b|command not found|no such file or directory|not (installed|runnable|executable)|is not available|not found in \$?PATH/i,
	},
	// Above the crash probes because a rejected resume arrives as a dead child and
	// would otherwise read as an ordinary crash, which is retried rather than
	// repaired. Deliberately narrow: Pi's `No project session found with id '…';
	// creating a new session with that id.` is a benign stderr warning and must
	// not match.
	{
		failureClass: 'session-unresumable',
		pattern: /no conversation found with session id/i,
	},
	{
		failureClass: 'runtime-crashed',
		pattern:
			/exited with code|killed by signal|\b(EPIPE|SIGKILL|SIGSEGV|SIGABRT)\b|segmentation fault|crashed|out of memory|failed to spawn/i,
	},
	{
		failureClass: 'provider-overloaded',
		pattern:
			/\b(500|502|503|504|529)\b|overloaded|server error|service unavailable|bad gateway|internal server error|temporarily unavailable|upstream (error|timeout)/i,
	},
	{
		failureClass: 'provider-refused',
		pattern:
			/refus(ed|al)|content[\s_-]?policy|policy violation|safety (filter|system)|declined to/i,
	},
	{
		failureClass: 'tool-denied',
		pattern:
			/permission denied|plan mode|tool (call )?(was )?(denied|blocked|not allowed)|not permitted/i,
	},
	{
		failureClass: 'session-closed',
		pattern: /session (is )?(closed|not open|no longer)|session has ended/i,
	},
];

/**
 * Fallback from the transport-level code the agent client raises, used when no
 * probe recognized the prose. These codes describe where the failure came from
 * rather than what went wrong, so they are the coarsest reading available —
 * `adapter-failure` deliberately has no entry, because it covers everything.
 */
const CODE_CLASSES: Readonly<Record<string, AgentFailureClass>> = {
	'invalid-cwd': 'workspace-invalid',
	'invalid-executable': 'runtime-missing',
	'session-closed': 'session-closed',
	'session-not-open': 'session-closed',
	'spawn-error': 'runtime-crashed',
	'submit-failed': 'session-closed',
};

/**
 * Classifies a runtime failure into the locale-neutral class the renderer maps
 * to designed copy and recovery actions.
 *
 * Runtimes report provider failures as free prose under one catch-all code, so
 * the message and its detail are read first and the code only breaks a tie the
 * prose left open. Never throws and never returns null: an unrecognized failure
 * is `unknown`, which is a real row with its own copy rather than a gap.
 * @param failure - The runtime error to classify
 * @returns The class this failure belongs to
 */
export function classifyAgentFailure(
	failure: ClassifiableAgentFailure,
): AgentFailureClass {
	const subject = `${failure.message}\n${failure.detail ?? ''}`;
	const probed = FAILURE_PROBES.find((probe) => probe.pattern.test(subject));
	if (probed) {
		return probed.failureClass;
	}
	return (failure.code && CODE_CLASSES[failure.code]) || 'unknown';
}
