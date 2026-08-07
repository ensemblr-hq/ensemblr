/** Typed error raised by the agent session service for IPC translation. */
export class AgentSessionServiceError extends Error {
	readonly code: AgentSessionServiceErrorCode;

	constructor(input: { code: AgentSessionServiceErrorCode; message: string }) {
		super(input.message);
		this.name = 'AgentSessionServiceError';
		this.code = input.code;
	}
}

/**
 * Error codes raised by the agent session service, translated to IPC error
 * responses. `provider-mismatch` means the requested model belongs to a
 * different agent runtime than the one the session is pinned to; a chat cannot
 * change runtime once it has a session, so this is a rejection rather than a
 * silent coercion onto whichever provider the row already carries.
 */
export type AgentSessionServiceErrorCode =
	| 'database-unavailable'
	| 'provider-mismatch'
	| 'session-not-open';
