import type { DynamicToolUIPart } from 'ai';
import type { AgentToolOutput } from '@/renderer/types/agent-timeline';

/**
 * Reading a recorded tool call's payload.
 *
 * Both halves of the payload are untrusted shapes: the input is whatever the
 * model sent, and the output has changed form across app versions. Every reader
 * here answers null rather than throwing, and forgives the key each runtime
 * happens to have chosen for the same field, so the presenters above can be
 * written as if one vocabulary had always been in use.
 */

/**
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when `value` is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a tool part's input as a field bag.
 * @param part - The tool part to read
 * @returns The input record, or an empty bag when it is absent
 */
export function inputOf(part: DynamicToolUIPart): Record<string, unknown> {
	return isRecord(part.input) ? part.input : {};
}

/**
 * Reads a tool part's normalized result.
 *
 * Tolerates the pre-envelope shape (a bare string on `output`) so timelines
 * persisted before the mapper carried `details` still render.
 * @param part - The tool part to read
 * @returns The normalized output, or null while the call is still running
 */
export function outputOf(part: DynamicToolUIPart): AgentToolOutput | null {
	if (!('output' in part) || part.output === undefined) {
		return null;
	}
	const output = part.output;
	if (typeof output === 'string') {
		return { details: null, text: output };
	}
	if (!isRecord(output)) {
		return null;
	}
	return {
		details: isRecord(output.details) ? output.details : null,
		text: typeof output.text === 'string' ? output.text : '',
	};
}

/**
 * Reads the first non-empty string among the given keys.
 * @param bag - Record to read from
 * @param keys - Keys to try, in order
 * @returns The first non-empty string, or null when none match
 */
export function stringField(
	bag: Record<string, unknown>,
	...keys: string[]
): string | null {
	for (const key of keys) {
		const value = bag[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return null;
}

/**
 * Reads the first finite number among the given keys.
 * @param bag - Record to read from
 * @param keys - Keys to try, in order
 * @returns The first finite number, or null when none match
 */
export function numberField(
	bag: Record<string, unknown>,
	...keys: string[]
): number | null {
	for (const key of keys) {
		const value = bag[key];
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}
	return null;
}

/**
 * Reads whichever key a tool uses for the path it operates on.
 * @param bag - Tool input or details record to read from
 * @returns The reported path, or null when the tool named none
 */
export function pathOf(bag: Record<string, unknown>): string | null {
	return stringField(bag, 'path', 'file_path', 'filePath', 'file');
}
