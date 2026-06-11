/**
 * Tiny primitives for SQLite row guards. Each archive/unarchive service has a
 * slightly different row shape (joined workspace+repo, repository-only,
 * workspace+repo+archive-record), so a single shared row guard would be
 * inflexible. Instead, the services compose these primitives.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

export function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}

export function isNullableNumber(value: unknown): value is number | null {
	return value === null || typeof value === 'number';
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
