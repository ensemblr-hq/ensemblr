/**
 * Coerces an unknown thrown value into a renderer-safe error message. A
 * non-`Error` throw carries no message worth showing, so it reads as "no
 * message" and the caller supplies its own copy.
 * @param error - Thrown value.
 * @returns The message, or `null` when there is none to show.
 */
export function getErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}

	return error instanceof Error ? error.message : null;
}
