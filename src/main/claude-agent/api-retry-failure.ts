import type {
	SDKAPIRetryMessage,
	SDKAssistantMessageError,
} from '@anthropic-ai/claude-agent-sdk';

import type { AgentError } from '../agent-runtime/agent-types.ts';

/**
 * Environment variables Claude Code authenticates with ahead of the login
 * `claude /login` stores. A stale one in the environment Ensemblr hands the
 * runtime is the likeliest reason an otherwise logged-in machine gets a 401.
 */
const CLAUDE_CREDENTIAL_ENV_VARS = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

/**
 * Consecutive unrecoverable retry frames that stop a turn. Claude Code refreshes
 * an OAuth token or re-reads an `apiKeyHelper` before it retries a 401, so the
 * first rejection can still heal; a second one means the refresh did not help.
 */
const UNRECOVERABLE_RETRY_LIMIT = 2;

/**
 * HTTP statuses that name a problem with the account or the target, not the
 * moment. 400 is deliberately absent: Claude Code retries one after shrinking
 * `max_tokens` on a context overflow, and that retry is the repair.
 */
const UNRECOVERABLE_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/** Cause sentence for rejected credentials, also used for a bare 401 or 403. */
const AUTHENTICATION_CAUSE =
	'The Claude API rejected the credentials Claude Code sent (authentication failed).';

/** Cause sentence for a bare 404 whose cause the runtime did not name. */
const NOT_FOUND_CAUSE =
	'The Claude API could not find the model or endpoint Claude Code asked for.';

/**
 * The runtime's own sentence for each retry cause that waiting cannot fix. The
 * wording is load-bearing: `classifyAgentFailure` reads it to pick the designed
 * row, so the credential causes say "credentials" or "authentication", billing
 * says "billing", and none of them uses a word another probe claims first.
 */
const UNRECOVERABLE_CAUSES: Readonly<
	Partial<Record<SDKAssistantMessageError, string>>
> = {
	account_on_hold: 'The Claude account behind these credentials is on hold.',
	authentication_failed: AUTHENTICATION_CAUSE,
	billing_error: 'The Claude API reported a billing problem with this account.',
	cloud_credential_error:
		'The cloud provider rejected the credentials Claude Code sent.',
	model_not_found: 'The Claude API does not know the model this chat uses.',
	oauth_org_not_allowed:
		'The organization behind this OAuth login does not allow Claude Code.',
	verification_required:
		'The Claude account behind these credentials needs verification.',
};

/** Said after every cause, so the row explains why the spinner stopped early. */
const STOPPED_SUFFIX = 'Retrying will not fix this, so the turn was stopped.';

/** The fields of an `api_retry` frame the watch reads. */
type ApiRetryFrame = Pick<
	SDKAPIRetryMessage,
	'attempt' | 'error' | 'error_status' | 'max_retries'
>;

/**
 * Counts the runtime's retries of one request and says when they are futile.
 * One instance per session; the normalizer resets it whenever a response gets
 * through, so only an unbroken run of rejections counts.
 */
export interface ApiRetryWatch {
	/**
	 * Records one retry frame.
	 * @returns The fatal error that stops the turn, or null while retrying can still help.
	 */
	observe: (frame: ApiRetryFrame) => AgentError | null;
	/** Forgets the current run of rejections. */
	reset: () => void;
}

/**
 * Builds the watch that turns Claude Code's silent retry backoff into a failure
 * the timeline can show.
 *
 * Claude Code retries a rejected request up to ten times with growing backoff
 * and reports each attempt only as an `api_retry` frame. For an overloaded
 * server that wait is worth it; for a rejected key it only keeps the chat
 * spinning for minutes before the same rejection lands as the answer.
 * @param credentialEnvVars - Credential variables set in the runtime's environment, named in the hint an authentication failure carries.
 * @returns A watch bound to one session.
 */
export function createApiRetryWatch(
	credentialEnvVars: readonly string[],
): ApiRetryWatch {
	let rejections = 0;

	return {
		observe: (frame) => {
			if (!isUnrecoverable(frame)) {
				rejections = 0;
				return null;
			}
			rejections += 1;
			if (rejections < UNRECOVERABLE_RETRY_LIMIT) {
				return null;
			}
			rejections = 0;
			return toFatalError(frame, credentialEnvVars);
		},
		reset: () => {
			rejections = 0;
		},
	};
}

/**
 * Names the credential variables that are set, never their values.
 * @param env - The environment the runtime is started with.
 * @returns The names of the credential variables holding a non-blank value.
 */
export function readCredentialEnvVars(
	env: NodeJS.ProcessEnv,
): readonly string[] {
	return CLAUDE_CREDENTIAL_ENV_VARS.filter((name) =>
		Boolean(env[name]?.trim()),
	);
}

/**
 * Whether a retry frame names a cause that another attempt cannot fix.
 * @param frame - The retry frame.
 * @returns True for account, credential, and missing-model failures.
 */
function isUnrecoverable(frame: ApiRetryFrame): boolean {
	return (
		readCause(frame.error) !== null ||
		(frame.error_status !== null &&
			UNRECOVERABLE_STATUSES.has(frame.error_status))
	);
}

/**
 * Looks up the sentence for a retry cause the runtime reported.
 * @param error - The frame's `error` field.
 * @returns The cause sentence, or null for a cause that may clear on its own.
 */
function readCause(error: unknown): string | null {
	if (
		typeof error !== 'string' ||
		!Object.hasOwn(UNRECOVERABLE_CAUSES, error)
	) {
		return null;
	}
	return UNRECOVERABLE_CAUSES[error as SDKAssistantMessageError] ?? null;
}

/**
 * Picks the headline for a cause the runtime did not name structurally, from
 * the HTTP status alone.
 * @param status - The frame's HTTP status.
 * @returns The cause sentence for that status.
 */
function causeFromStatus(status: number | null): string {
	return status === 404 ? NOT_FOUND_CAUSE : AUTHENTICATION_CAUSE;
}

/**
 * Whether the failure is the runtime's credentials being turned away, which is
 * when a credential variable in its environment is worth naming.
 * @param frame - The retry frame.
 * @returns True for an authentication failure.
 */
function isAuthenticationFailure(frame: ApiRetryFrame): boolean {
	return frame.error === 'authentication_failed' || frame.error_status === 401;
}

/**
 * Explains which credential variables Claude Code was started with, because
 * the runtime prefers them over the login the user believes it is using.
 * @param names - Credential variables set in the runtime's environment.
 * @returns The hint paragraph, or null when none is set.
 */
function credentialHint(names: readonly string[]): string | null {
	if (names.length === 0) {
		return null;
	}
	const subject = names.join(' and ');
	const verb = names.length === 1 ? 'is' : 'are';
	const pronoun = names.length === 1 ? 'it' : 'them';
	return `${subject} ${verb} set in the environment Ensemblr started Claude Code with, and Claude Code authenticates with ${pronoun} instead of the login \`claude /login\` stores. Remove ${pronoun} or set a valid value, then start a new chat. If the variable comes from your login environment, restart Ensemblr first.`;
}

/**
 * Builds the fatal error for a run of futile retries: the cause as the runtime's
 * sentence, and the frame's own fields plus any credential hint as detail.
 * @param frame - The retry frame that tripped the watch.
 * @param credentialEnvVars - Credential variables set in the runtime's environment.
 * @returns The error the timeline renders as a failure row.
 */
function toFatalError(
	frame: ApiRetryFrame,
	credentialEnvVars: readonly string[],
): AgentError {
	const cause = readCause(frame.error) ?? causeFromStatus(frame.error_status);
	const status =
		frame.error_status === null
			? 'no HTTP response'
			: `HTTP ${frame.error_status}`;
	const attempt = `Claude API error: ${String(frame.error)} (${status}), retry ${frame.attempt} of ${frame.max_retries}.`;
	const hint = isAuthenticationFailure(frame)
		? credentialHint(credentialEnvVars)
		: null;
	return {
		code: 'adapter-failure',
		detail: [attempt, hint].filter(Boolean).join('\n\n'),
		message: `${cause} ${STOPPED_SUFFIX}`,
		recoverable: false,
	};
}
