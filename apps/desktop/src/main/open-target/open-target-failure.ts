import type {
	OpenTargetFailure,
	OpenTargetFailureCode,
} from '@/shared/ipc/contracts/open-target';

/**
 * An open-in-target failure that carries a locale-neutral code as well as the
 * English sentence. Dispatch throws rather than returning, so the code has to
 * survive the `throw`/`catch` the service already wraps every dispatch in —
 * otherwise main's English prose is all the renderer gets to put in a
 * translated toast.
 */
export class OpenTargetFailureError extends Error {
	readonly code: OpenTargetFailureCode;

	/**
	 * @param code - Locale-neutral code the renderer's failure-text table words.
	 * @param message - English sentence kept for the support bundle.
	 */
	constructor(code: OpenTargetFailureCode, message: string) {
		super(message);
		this.name = 'OpenTargetFailureError';
		this.code = code;
	}
}

/**
 * Reads the failure envelope off a thrown value, when it carries one.
 * @param error - The value a dispatch threw.
 * @returns The coded failure, or null for an error with no code to report.
 */
export function toOpenTargetFailure(error: unknown): OpenTargetFailure | null {
	return error instanceof OpenTargetFailureError
		? { code: error.code, message: error.message }
		: null;
}
