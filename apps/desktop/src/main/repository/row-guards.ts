/**
 * Tiny primitives for SQLite row guards. Each archive/unarchive service has a
 * slightly different row shape (joined workspace+repo, repository-only,
 * workspace+repo+archive-record), so a single shared row guard would be
 * inflexible. Instead, the services compose these primitives.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Narrow an unknown value to a string.
 * @param value - Value to test
 * @returns True when the value is a string
 */
export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * Narrow an unknown value to a string or null.
 * @param value - Value to test
 * @returns True when the value is a string or null
 */
export function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}

/**
 * Narrow an unknown value to a number or null.
 * @param value - Value to test
 * @returns True when the value is a number or null
 */
export function isNullableNumber(value: unknown): value is number | null {
	return value === null || typeof value === 'number';
}

/**
 * Read a column as a string, treating any other stored type as absent.
 * @param value - Raw column value
 * @returns The string value, or null when the column holds anything else
 */
export function readNullableString(value: unknown): string | null {
	return isString(value) ? value : null;
}

/**
 * Narrow a raw SQLite row to a record whose named columns all carry strings, so
 * row mappers can read those columns without re-testing each one.
 * @param row - Candidate row returned by a query
 * @param columns - Column names that must hold a string value
 * @returns The row with the named columns typed as strings, or null when it is malformed
 */
export function readStringColumns<Column extends string>(
	row: unknown,
	columns: readonly Column[],
): (Record<string, unknown> & Record<Column, string>) | null {
	if (!isRecord(row)) {
		return null;
	}
	return columns.every((column) => isString(row[column]))
		? (row as Record<string, unknown> & Record<Column, string>)
		: null;
}

/**
 * Verifies that `candidate` has the shared workspace + repository identity
 * columns used by both the archive-workspace and unarchive-workspace queries.
 * Per-service guards layer their extra columns on top of this check.
 */
export function hasWorkspaceRepositoryIdentity(
	candidate: Record<string, unknown>,
): boolean {
	return (
		isString(candidate.id) &&
		isString(candidate.slug) &&
		isString(candidate.name) &&
		isString(candidate.path) &&
		isString(candidate.repositoryId) &&
		isString(candidate.repositoryName) &&
		isString(candidate.repositoryPath) &&
		isString(candidate.repositorySlug) &&
		isNullableString(candidate.branchName) &&
		isNullableString(candidate.archivedAt)
	);
}
