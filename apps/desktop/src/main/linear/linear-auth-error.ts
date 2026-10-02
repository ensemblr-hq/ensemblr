/**
 * The typed error every Linear auth operation throws.
 *
 * Its own module so `linear-auth-service.ts` and `linear-auth-failures.ts` can
 * both reach it without importing each other: the service throws it, and the
 * failure mapper narrows on it.
 */

import type { LinearAuthFailureCode } from '../../shared/ipc/contracts/linear';

/** Typed error thrown by every Linear auth operation. */
export class LinearAuthError extends Error {
	readonly code: LinearAuthFailureCode;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description.
	 * @param options - Optional cause for diagnostics.
	 */
	constructor(
		code: LinearAuthFailureCode,
		message: string,
		options: { cause?: unknown } = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'LinearAuthError';
		this.code = code;
	}
}
