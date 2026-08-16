/**
 * Mapping from what Linear auth throws onto the failure envelope the renderer
 * reads.
 *
 * Split out of `linear-auth-service.ts` to keep that file under the repository's
 * size ceiling. Everything here is a pure projection with no I/O, which is what
 * lets the service call it from any branch, including its own catch blocks.
 */

import type {
	LinearAuthFailure,
	LinearAuthFailureCode,
} from '../../shared/ipc/contracts/linear';
import { LinearAuthError } from './linear-auth-error.ts';
import { LinearOauthCallbackError } from './linear-oauth-callback-server.ts';

/**
 * Auth failure each callback-server outcome reports as. A port that cannot be
 * bound is a real failure, so it stays distinct from the user pressing Cancel —
 * the renderer shows nothing for a cancellation and would otherwise swallow it.
 */
const CALLBACK_FAILURE_CODES: Record<
	LinearOauthCallbackError['code'],
	LinearAuthFailureCode
> = {
	'callback-canceled': 'login-canceled',
	'callback-timeout': 'callback-timeout',
	'server-error': 'callback-failed',
};

/**
 * Map a thrown error to a structured Linear auth failure for the renderer.
 * @param error - The caught error
 * @returns The corresponding failure with a code and message
 */
export function toFailure(error: unknown): LinearAuthFailure {
	if (error instanceof LinearAuthError) {
		return { code: error.code, message: error.message };
	}

	if (error instanceof LinearOauthCallbackError) {
		return { code: CALLBACK_FAILURE_CODES[error.code], message: error.message };
	}

	return { code: 'linear-unknown', message: formatError(error) };
}

/**
 * Extract a human-readable message from an unknown error value.
 * @param error - The value to format
 * @returns The error message, or the value stringified
 */
export function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Truncate text to a maximum length, appending an ellipsis when shortened.
 * @param text - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns The original text, or a truncated copy with a trailing ellipsis
 */
export function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
