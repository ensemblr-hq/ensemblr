/** Longest project or workspace name the main process accepts. */
const ENTITY_NAME_MAX_LENGTH = 100;

/**
 * Mirror the main-process name rules so a dialog can surface feedback before
 * the IPC round-trip. An empty name reads as "not typed yet", not as invalid.
 * @param allowedCharacters - Phrase naming what `pattern` accepts, e.g. `letters, numbers, dots`
 * @param name - Trimmed name the user typed
 * @param noun - Capitalized entity noun used in the messages, e.g. `Workspace`
 * @param pattern - Character-set pattern the main process enforces
 * @returns The message to show under the field, or null when the name passes
 */
export function validateEntityName({
	allowedCharacters,
	name,
	noun,
	pattern,
}: {
	allowedCharacters: string;
	name: string;
	noun: string;
	pattern: RegExp;
}): string | null {
	if (!name) {
		return null;
	}
	if (name.length > ENTITY_NAME_MAX_LENGTH) {
		return `${noun} names must be ${ENTITY_NAME_MAX_LENGTH} characters or fewer.`;
	}
	if (name === '.' || name === '..' || name.startsWith('.')) {
		return `${noun} names cannot start with a dot.`;
	}
	if (!pattern.test(name)) {
		return `Use only ${allowedCharacters}.`;
	}
	return null;
}
