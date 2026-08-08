// @vitest-environment happy-dom

/**
 * A resolved review comment reads as done in the Checks panel — struck through
 * and badged — and "Add all to chat" hands the agent the outstanding ones only,
 * so a thread that is already closed never re-enters the conversation as work.
 */

import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { ChecksPanel } from '../../src/renderer/components/workbench-shell/checks-panel/checks-panel';
import { PullRequestCommentRow } from '../../src/renderer/components/workbench-shell/checks-panel/pr-rows';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import { useComposerInsertConsumer } from '../../src/renderer/state/composer';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type { ReviewCommentWire } from '../../src/shared/ipc/contracts/review-comments';
import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

type Comment = WorkspaceShellModel['pullRequest']['comments'][number];

const resolvedComment: Comment = {
	author: 'octocat',
	body: 'this one is handled',
	detail: 'this one is handled',
	id: 'comment-resolved',
	isResolved: true,
	line: 4,
	path: 'src/main/index.ts',
	provider: 'github',
};

const unresolvedComment: Comment = {
	author: 'hubot',
	body: 'needs a guard here',
	detail: 'needs a guard here',
	id: 'comment-open',
	isResolved: false,
	line: 12,
	path: 'src/main/index.ts',
	provider: 'github',
};

/** Drains the composer insert queue into a spy so inserts are assertable. */
function ComposerInsertProbe({
	onInsert,
}: {
	onInsert: (text: string) => void;
}) {
	useComposerInsertConsumer(onInsert);
	return null;
}

/** Renders the Checks panel over a PR with the given comments, plus an insert spy. */
function renderChecksPanel({
	comments,
	localComments = [],
}: {
	comments: Comment[];
	localComments?: ReviewCommentWire[];
}) {
	const workspace = getDefaultWorkspace();
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.reviewComments(workspace.id), {
		comments: localComments,
	});
	const onInsert = vi.fn();

	renderWithProviders(
		<Provider store={createStore()}>
			<ComposerInsertProbe onInsert={onInsert} />
			<ChecksPanel
				workspace={{
					...workspace,
					pullRequest: {
						...workspace.pullRequest,
						comments,
						number: 138,
						state: 'open',
					},
				}}
			/>
		</Provider>,
		{ client },
	);

	return { onInsert };
}

beforeEach(() => {
	installLocalStorage();
});

test('a resolved comment strikes its text through and badges it Resolved', () => {
	renderWithProviders(<PullRequestCommentRow comment={resolvedComment} />);

	expect(screen.getByText(resolvedComment.detail)).toHaveClass('line-through');
	expect(screen.getByText('Resolved')).toBeInTheDocument();
});

test('an unresolved comment keeps the Unresolved badge and no strikethrough', () => {
	renderWithProviders(<PullRequestCommentRow comment={unresolvedComment} />);

	expect(screen.getByText(unresolvedComment.detail)).not.toHaveClass(
		'line-through',
	);
	expect(screen.getByText('Unresolved')).toBeInTheDocument();
});

// A comment with no resolution state at all — an issue comment, a bot annotation
// — is neither, and must not be struck through on the strength of an absent flag.
test('a comment with no resolution state renders neither badge', () => {
	const { isResolved: _dropped, ...plain } = unresolvedComment;
	renderWithProviders(<PullRequestCommentRow comment={plain} />);

	expect(screen.getByText(plain.detail)).not.toHaveClass('line-through');
	expect(screen.queryByText('Resolved')).toBeNull();
	expect(screen.queryByText('Unresolved')).toBeNull();
});

test('"Add all to chat" hands over the outstanding comments only', () => {
	const { onInsert } = renderChecksPanel({
		comments: [resolvedComment, unresolvedComment],
	});

	fireEvent.click(screen.getByRole('button', { name: 'Add all to chat' }));

	expect(onInsert).toHaveBeenCalledTimes(1);
	const inserted = onInsert.mock.calls[0]?.[0] as string;
	expect(inserted).toContain(unresolvedComment.detail);
	expect(inserted).not.toContain(resolvedComment.detail);
	expect(inserted).toContain('Review comments for PR #138 (1):');
});

test('the header drops "Add all to chat" once every comment is resolved', () => {
	renderChecksPanel({ comments: [resolvedComment] });

	expect(screen.queryByRole('button', { name: 'Add all to chat' })).toBeNull();
});

// The PR model already projects open local comments into `pullRequest.comments`,
// and the panel loads them again for their resolution state — merging both lists
// verbatim would list every open local note twice.
test('an open local comment is listed once, not once per source', () => {
	const projected: Comment = {
		body: 'local note',
		detail: 'src/main/index.ts:7 — local note',
		id: 'local:local-1',
		path: 'src/main/index.ts',
		provider: 'local',
	};
	const stored: ReviewCommentWire = {
		body: 'local note',
		createdAt: '2026-08-01T00:00:00.000Z',
		filePath: 'src/main/index.ts',
		id: 'local-1',
		lineNumber: 7,
		origin: 'user',
		status: 'open',
		updatedAt: '2026-08-01T00:00:00.000Z',
		workspaceId: getDefaultWorkspace().id,
	};

	renderChecksPanel({ comments: [projected], localComments: [stored] });

	expect(screen.getAllByText(/local note/)).toHaveLength(1);
});
