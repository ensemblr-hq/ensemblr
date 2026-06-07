/**
 * Coerces an unknown thrown value into a renderer-safe error message.
 * @param error - Thrown value.
 * @returns The message, or `null` for falsy inputs.
 */
export function getErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}

	return error instanceof Error
		? error.message
		: 'Unknown renderer query error';
}
