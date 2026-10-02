/** Parses a metadata JSON blob, returning an empty object on any failure. */
export function parseMetadata(
	text: string | undefined,
): Record<string, unknown> {
	if (!text) {
		return {};
	}
	try {
		const parsed = JSON.parse(text);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Reports whether the workspace took over a branch that already existed rather
 * than cutting its own. Such a branch predates the workspace and usually backs a
 * pull request, so rename and archive must leave the git branch alone.
 * @param metadata - The workspace's parsed metadata blob.
 * @returns True when the branch was adopted.
 */
export function branchWasAdopted(metadata: Record<string, unknown>): boolean {
	return metadata.adoptedBranch === true;
}
