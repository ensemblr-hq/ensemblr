import type { HunkData } from 'react-diff-view';

import { resolveChangeKey } from '@/renderer/lib/diff/parse';
import type { DiffComment } from '@/renderer/types/diff';
import type { GithubCommentWire } from '@/shared/ipc/contracts/github';
import type { ReviewCommentWire } from '@/shared/ipc/contracts/review-comments';
import { stripCommentMetadata } from './comment-body';

/** Grouped inline comments: anchored by change key, plus any that failed to anchor. */
export interface GroupedDiffComments {
	byChangeKey: Map<string, DiffComment[]>;
	unanchored: DiffComment[];
}

/**
 * Append a comment to a change key's bucket, or to the unanchored list when it
 * could not be placed.
 * @param groups - The accumulating grouped comments
 * @param changeKey - The resolved change key, or null when unanchored
 * @param comment - The comment to place
 */
function place(
	groups: GroupedDiffComments,
	changeKey: string | null,
	comment: DiffComment,
): void {
	if (!changeKey) {
		groups.unanchored.push(comment);
		return;
	}
	const bucket = groups.byChangeKey.get(changeKey);
	if (bucket) {
		bucket.push(comment);
	} else {
		groups.byChangeKey.set(changeKey, [comment]);
	}
}

/**
 * Map a local review comment onto its diff line. Local comments are authored
 * against the current file, so they anchor to the new side. An agent-filed
 * comment carries an author so the thread badges who wrote it — a note the user
 * left themselves needs no label, one an agent left does.
 * @param comment - The local review comment
 * @returns The diff comment view model
 */
function toLocalDiffComment(comment: ReviewCommentWire): DiffComment {
	return {
		body: comment.body,
		id: `local:${comment.id}`,
		isResolved: comment.status === 'resolved',
		source: 'local',
		...(comment.origin === 'agent' ? { author: 'Agent' } : {}),
	};
}

/**
 * Map a GitHub review comment (and each of its replies) into diff comments,
 * tagging bot authors so they render with the Actions-bot badge.
 * @param comment - The GitHub review comment wire record
 * @returns The diff comments for the comment and its replies
 */
function toGithubDiffComments(comment: GithubCommentWire): DiffComment[] {
	const source = comment.isBot ? 'github-actions' : 'github';
	const head: DiffComment = {
		author: comment.author,
		body: stripCommentMetadata(comment.body),
		id: `gh:${comment.id}`,
		source,
		...(comment.isOutdated === undefined
			? {}
			: { isOutdated: comment.isOutdated }),
		...(comment.isResolved === null ? {} : { isResolved: comment.isResolved }),
		...(comment.url ? { url: comment.url } : {}),
	};
	const replies = (comment.replies ?? []).map(
		(reply): DiffComment => ({
			author: reply.author,
			body: stripCommentMetadata(reply.body),
			id: `gh:${reply.id}`,
			source: reply.isBot ? 'github-actions' : 'github',
			...(reply.url ? { url: reply.url } : {}),
		}),
	);
	return [head, ...replies];
}

/**
 * Group Ensemblr-local and GitHub review comments for a single file onto the
 * diff's change keys so the viewer can render them inline. Comments whose line
 * cannot be matched (e.g. an outdated GitHub thread against a since-changed
 * region) fall into `unanchored` for a file-level list.
 * @param options - The file's hunks, path, and the two comment sources
 * @returns The comments grouped by change key plus the unanchored remainder
 */
export function groupDiffComments({
	filePath,
	githubComments,
	hunks,
	localComments,
}: {
	filePath: string;
	githubComments: readonly GithubCommentWire[];
	hunks: readonly HunkData[];
	localComments: readonly ReviewCommentWire[];
}): GroupedDiffComments {
	const groups: GroupedDiffComments = {
		byChangeKey: new Map(),
		unanchored: [],
	};

	for (const comment of localComments) {
		if (comment.filePath !== filePath || comment.status === 'archived') {
			continue;
		}
		const changeKey =
			comment.lineNumber === null
				? null
				: resolveChangeKey(hunks, comment.lineNumber, 'new');
		place(groups, changeKey, toLocalDiffComment(comment));
	}

	for (const comment of githubComments) {
		if (comment.kind !== 'review-comment' || comment.path !== filePath) {
			continue;
		}
		const side = comment.side === 'LEFT' ? 'old' : 'new';
		const changeKey =
			comment.line === undefined
				? null
				: resolveChangeKey(hunks, comment.line, side);
		for (const diffComment of toGithubDiffComments(comment)) {
			place(groups, changeKey, diffComment);
		}
	}

	return groups;
}
