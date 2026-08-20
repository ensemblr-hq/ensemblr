import type { AgentWireError } from '@/shared/ipc/contracts/agent-session';

/**
 * One runtime failure exactly as a provider reported it, labelled by the class
 * the shipped classifier is expected to land it in.
 *
 * Every string here is a real shape an agent runtime emits — the observed
 * mid-response truncation from THE-198 first — so the scene exercises the
 * classifier rather than hand-picking a class and confirming its own copy.
 */
export interface AgentErrorFixture {
	error: AgentWireError;
	label: string;
}

/**
 * When the spent-plan fixture's window clears, relative to whenever the scene
 * was loaded — a fixed instant would drift into the past and render every reload
 * as "Resets now".
 */
const RESETS_IN_TWO_HOURS = new Date(
	Date.now() + 2 * 60 * 60 * 1000,
).toISOString();

/**
 * The failures the scene cycles through, in taxonomy order. Coverage of every
 * class is not enforced here — the scene fills any gap with a pre-tagged
 * synthetic error, so a class added to the taxonomy still shows up.
 */
export const AGENT_ERROR_FIXTURES: readonly AgentErrorFixture[] = [
	{
		error: {
			code: 'adapter-failure',
			message:
				'API Error: Server error mid-response. The response above may be incomplete.',
			recoverable: false,
		},
		label: 'truncated',
	},
	{
		error: {
			code: 'adapter-failure',
			detail: 'HTTP 529 from api.anthropic.com after 3 attempts',
			message: 'Overloaded: the upstream service is unavailable.',
			recoverable: false,
		},
		label: 'overloaded',
	},
	// Paired with the next one on purpose: same class, no structured reset, so the
	// row has to advise without promising a window that may not exist.
	{
		error: {
			code: 'adapter-failure',
			detail: 'x-ratelimit-reset: 2026-08-20T15:00:00Z',
			message: '429 Too Many Requests — rate limit exceeded for this account.',
			recoverable: false,
		},
		label: 'rate limit',
	},
	// Claude Code prints this as an ordinary assistant turn; the adapter lifts it
	// onto the failure path, and the badge restates its reset from the stamp the
	// runtime pushed rather than from the English clause in the sentence.
	{
		error: {
			code: 'adapter-failure',
			message: "You've hit your session limit · resets 5pm (Asia/Nicosia)",
			recoverable: false,
			resetsAt: RESETS_IN_TWO_HOURS,
		},
		label: 'plan window spent',
	},
	{
		error: {
			code: 'adapter-failure',
			message: '401 Unauthorized: invalid API key. Please run /login.',
			recoverable: false,
		},
		label: 'credentials',
	},
	{
		error: {
			code: 'adapter-failure',
			detail: 'getaddrinfo ENOTFOUND api.anthropic.com',
			message: 'fetch failed',
			recoverable: false,
		},
		label: 'network',
	},
	{
		error: {
			code: 'adapter-failure',
			message:
				'prompt is too long: 210331 tokens > 200000 maximum context length',
			recoverable: false,
		},
		label: 'context',
	},
	{
		error: {
			code: 'spawn-error',
			detail:
				'spawn pi ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:285:19)\n    at onErrorNT (node:internal/child_process:483:16)\n    at process.processTicksAndRejections (node:internal/process/task_queues:82:21)',
			message: 'Failed to spawn the Pi RPC process.',
			recoverable: false,
		},
		label: 'missing binary',
	},
	{
		error: {
			code: 'adapter-failure',
			detail: 'stderr: Killed: 9',
			message: 'Pi RPC process exited with code 137.',
			recoverable: false,
		},
		label: 'crashed',
	},
	{
		error: {
			code: 'adapter-failure',
			message: 'Ensemblr blocked Bash: Plan Mode denies mutating tools.',
			recoverable: false,
		},
		label: 'tool denied',
	},
	{
		error: {
			code: 'adapter-failure',
			message:
				'The model refused this request: it violates the provider’s content policy.',
			recoverable: false,
		},
		label: 'refused',
	},
	{
		error: {
			code: 'session-closed',
			message: 'The session is closed and cannot accept another turn.',
			recoverable: false,
		},
		label: 'session closed',
	},
	{
		error: {
			code: 'invalid-cwd',
			detail: '/Users/me/code/gone: no such directory',
			message: 'The workspace directory could not be opened.',
			recoverable: false,
		},
		label: 'workspace invalid',
	},
	{
		error: {
			code: 'adapter-failure',
			message: 'The turn ended without producing an answer.',
			recoverable: false,
		},
		label: 'unknown',
	},
];
