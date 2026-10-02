/**
 * The chain of branches a workspace has continued off, stored in its
 * `metadata_json`. Continuing leaves the merged branch in place so the old pull
 * request keeps the ref it was merged from; recording the name here is what
 * lets archive clean the whole chain up later instead of only the branch the
 * workspace ends on.
 */

import { parseMetadata } from './metadata.ts';

const CONTINUED_BRANCHES_METADATA_KEY = 'continuedFromBranches';

/**
 * Reads the branches a workspace has already continued off, oldest first.
 * @param metadataJson - The workspace's stored metadata JSON.
 * @returns The recorded predecessor branch names, empty when there are none.
 */
export function readContinuedBranches(metadataJson: string): string[] {
	const recorded = parseMetadata(metadataJson)[CONTINUED_BRANCHES_METADATA_KEY];
	if (!Array.isArray(recorded)) {
		return [];
	}
	return recorded.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Appends the branch a workspace is moving off to its continuation chain,
 * ignoring a name the chain already carries.
 * @param metadataJson - The workspace's stored metadata JSON.
 * @param branchName - Branch the workspace is moving off.
 * @returns The updated metadata JSON.
 */
export function appendContinuedBranch(
	metadataJson: string,
	branchName: string,
): string {
	const chain = readContinuedBranches(metadataJson);
	return JSON.stringify({
		...parseMetadata(metadataJson),
		[CONTINUED_BRANCHES_METADATA_KEY]: chain.includes(branchName)
			? chain
			: [...chain, branchName],
	});
}
