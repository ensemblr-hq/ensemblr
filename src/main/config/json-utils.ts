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
	return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
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
