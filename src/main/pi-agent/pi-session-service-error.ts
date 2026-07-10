/** Typed error raised by the Pi session service for IPC translation. */
export class PiSessionServiceError extends Error {
	readonly code: PiSessionServiceErrorCode;

	constructor(input: { code: PiSessionServiceErrorCode; message: string }) {
		super(input.message);
		this.name = 'PiSessionServiceError';
		this.code = input.code;
	}
}

/** Error codes raised by the Pi session service, translated to IPC error responses. */
export type PiSessionServiceErrorCode =
	| 'database-unavailable'
	| 'session-not-open';
