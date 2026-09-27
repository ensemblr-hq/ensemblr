import type {
	SDKAPIRetryMessage,
	SDKAssistantMessageError,
} from '@anthropic-ai/claude-agent-sdk';

import type { AgentFailureClass } from '../../shared/agent-failure.ts';
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

/**
 * How one futile retry cause reads: the runtime's English sentence, kept for the
 * row's disclosure and support bundles, and the class the row is designed for.
 */
interface FutileRetryCause {
	failureClass: AgentFailureClass;
	sentence: string;
}

/** Rejected credentials, also used for a bare 401 or 403. */
const AUTHENTICATION_CAUSE: FutileRetryCause = {
	failureClass: 'credentials',
	sentence:
		'The Claude API rejected the credentials Claude Code sent (authentication failed).',
};

/** A bare 404 whose cause the runtime did not name. */
const NOT_FOUND_CAUSE: FutileRetryCause = {
	failureClass: 'model-unavailable',
	sentence:
		'The Claude API could not find the model or endpoint Claude Code asked for.',
};

/**
 * Every retry cause that waiting cannot fix. The class is set here rather than
 * read back out of the sentence, because the runtime named the cause
 * structurally and the row it earns should not hang on wording.
 *
 * A billing failure keeps the `rate-limit` row the taxonomy gives every other
 * spending wall: its Settings action is where the plan is checked, and once the
 * account is paid up Continue picks the stopped turn back up.
 */
const UNRECOVERABLE_CAUSES: Readonly<
	Partial<Record<SDKAssistantMessageError, FutileRetryCause>>
> = {
	account_on_hold: {
		failureClass: 'account-restricted',
		sentence: 'The Claude account behind these credentials is on hold.',
	},
	authentication_failed: AUTHENTICATION_CAUSE,
	billing_error: {
		failureClass: 'rate-limit',
		sentence: 'The Claude API reported a billing problem with this account.',
	},
	cloud_credential_error: {
		failureClass: 'credentials',
		sentence: 'The cloud provider rejected the credentials Claude Code sent.',
	},
	model_not_found: {
		failureClass: 'model-unavailable',
		sentence: 'The Claude API does not know the model this chat uses.',
	},
	oauth_org_not_allowed: {
		failureClass: 'credentials',
		sentence:
			'The organization behind this OAuth login does not allow Claude Code.',
	},
	verification_required: {
		failureClass: 'account-restricted',
		sentence: 'The Claude account behind these credentials needs verification.',
	},
};

/** Said after every cause, so the disclosure explains why the spinner stopped early. */
const STOPPED_SUFFIX = 'Retrying will not fix this, so the turn was stopped.';

/** The fields of an `api_retry` frame the watch reads. */
type ApiRetryFrame = Pick<
	SDKAPIRetryMessage,
	'attempt' | 'error' | 'error_status' | 'max_retries'
>;

/**
 * Counts the runtime's retries within one turn and says when they are futile.
 * One instance per session; once it stops a turn it stays quiet until the next
 * turn re-arms it, so the cause is reported once however many frames follow.
 */
export interface ApiRetryWatch {
	/** Whether the watch has stopped the current turn. */
	hasStopped: () => boolean;
	/** Forgets the run of rejections because a response got through; a stop already made still holds. */
	noteResponse: () => void;
	/**
	 * Records one retry frame.
	 * @returns The fatal error the first time the run proves futile; null while retrying can still help and for every frame after the stop.
	 */
	observe: (frame: ApiRetryFrame) => AgentError | null;
	/** Re-arms the watch for a new turn, forgetting both the rejections and the stop. */
	rearm: () => void;
}

/**
 * Builds the watch that turns Claude Code's silent retry backoff into a failure
 * the timeline can show.
 *
 * Claude Code retries a rejected request up to ten times with growing backoff
 * and reports each attempt only as an `api_retry` frame. For an overloaded
 * server that wait is worth it; for a rejected key it only keeps the chat
 * spinning for minutes before the same rejection lands as the answer.
 * @param credentialEnvVars - Credential variables set in the runtime's environment, named by an authentication failure.
 * @returns A watch bound to one session.
 */
export function createApiRetryWatch(
	credentialEnvVars: readonly string[],
): ApiRetryWatch {
	let rejections = 0;
	let stopped = false;

	return {
		hasStopped: () => stopped,
		noteResponse: () => {
			rejections = 0;
		},
		observe: (frame) => {
			if (stopped) {
				return null;
			}
			if (!isUnrecoverable(frame)) {
				rejections = 0;
				return null;
			}
			rejections += 1;
			if (rejections < UNRECOVERABLE_RETRY_LIMIT) {
				return null;
			}
			stopped = true;
			return toFatalError(frame, credentialEnvVars);
		},
		rearm: () => {
			rejections = 0;
			stopped = false;
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
 * Looks up a retry cause the runtime reported.
 * @param error - The frame's `error` field.
 * @returns The cause, or null for one that may clear on its own.
 */
function readCause(error: unknown): FutileRetryCause | null {
	if (
		typeof error !== 'string' ||
		!Object.hasOwn(UNRECOVERABLE_CAUSES, error)
	) {
		return null;
	}
	return UNRECOVERABLE_CAUSES[error as SDKAssistantMessageError] ?? null;
}

/**
 * Picks the cause for a failure the runtime did not name structurally, from the
 * HTTP status alone.
 * @param status - The frame's HTTP status.
 * @returns The cause for that status.
 */
function causeFromStatus(status: number | null): FutileRetryCause {
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
 * Builds the fatal error for a run of futile retries. Fatal rather than
 * recoverable because the timeline surfaces fatal errors only, and this row is
 * the point: without it the chat spins through the backoff and shows nothing.
 *
 * The credential variables travel as names for the renderer to explain in the
 * reader's language, rather than as an English paragraph in the detail.
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
	const namesCredentials =
		isAuthenticationFailure(frame) && credentialEnvVars.length > 0;
	return {
		code: 'adapter-failure',
		detail: `Claude API error: ${String(frame.error)} (${status}), retry ${frame.attempt} of ${frame.max_retries}.`,
		failureClass: cause.failureClass,
		message: `${cause.sentence} ${STOPPED_SUFFIX}`,
		recoverable: false,
		...(namesCredentials ? { credentialEnvVars: [...credentialEnvVars] } : {}),
	};
}
