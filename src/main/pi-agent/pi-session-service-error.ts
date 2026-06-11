/** Typed error raised by the Pi session service for IPC translation. */
export class PiSessionServiceError extends Error {
	readonly code: PiSessionServiceErrorCode;

	constructor(input: { code: PiSessionServiceErrorCode; message: string }) {
		super(input.message);
		this.name = 'PiSessionServiceError';
		this.code = input.code;
	}
}

export type PiSessionServiceErrorCode =
	| 'database-unavailable'
	| 'session-not-open';
