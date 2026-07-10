/**
 * JSON-safe value helpers shared across config loaders/resolvers/migrators.
 *
 * These were duplicated in repository-config.ts, config-loader.ts, and
 * config-resolution.ts. Centralised here so callers depend on one module
 * instead of the heavy repository-config compile unit.
 */

/**
 * Returns a structurally-cloned copy of a JSON-safe record.
 * @param record - Record to clone.
 * @returns A deep clone of `record`.
 */
export function cloneRecord(
	record: Record<string, unknown>,
): Record<string, unknown> {
	return structuredClone(record);
}

/**
 * Compares two JSON-safe values for structural equality.
 * @param left - First value.
 * @param right - Second value.
 * @returns True when their JSON serialisations match.
 */
export function areJsonValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Coerces an unknown thrown value to a user-facing message.
 * @param error - Thrown value.
 * @param fallback - Fallback message when `error` is not an `Error`.
 * @returns A human-readable message.
 */
export function formatErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

/**
 * Type guard that excludes arrays from the structural-record check.
 * @param value - Candidate value.
 * @returns True when `value` is a non-null, non-array object.
 */
export function isPlainRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export {
	isSensitiveKeyName,
	SENSITIVE_KEY_PARTS,
} from '../../shared/sensitive-key.ts';

/** A line/column pair extracted from a JSON parser error. */
export interface JsonErrorLocation {
	column?: number;
	line?: number;
}

/**
 * Converts a character offset into a 1-based `(line, column)` pair.
 */
export function getLocationForPosition(
	source: string,
	position: number,
): JsonErrorLocation {
	const beforePosition = source.slice(0, Math.max(0, position));
	const lines = beforePosition.split('\n');

	return {
		column: (lines.at(-1)?.length ?? 0) + 1,
		line: lines.length,
	};
}

/**
 * Extracts a line/column hint from a JSON parser error message, recognising
 * both `position N` and `line N column M` shapes.
 */
export function getJsonErrorLocation(
	source: string,
	error: unknown,
): JsonErrorLocation {
	const message = error instanceof Error ? error.message : '';
	const positionMatch = /position (\d+)/i.exec(message);

	if (positionMatch) {
		return getLocationForPosition(source, Number(positionMatch[1]));
	}

	const lineColumnMatch = /line (\d+) column (\d+)/i.exec(message);

	if (lineColumnMatch) {
		return {
			column: Number(lineColumnMatch[2]),
			line: Number(lineColumnMatch[1]),
		};
	}

	return {};
}
