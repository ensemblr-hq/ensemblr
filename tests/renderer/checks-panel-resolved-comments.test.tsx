// @vitest-environment happy-dom

/**
 * A resolved review comment reads as done in the Checks panel — struck through
 * and badged — and "Add all to chat" hands the agent the outstanding ones only,
 * so a thread that is already closed never re-enters the conversation as work.
 */

import '@testing-library/jest-dom/vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { ChecksPanel } from '../../src/renderer/components/workbench-shell/checks-panel/checks-panel';
import { PullRequestCommentRow } from '../../src/renderer/components/workbench-shell/checks-panel/pr-rows';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import { useComposerAttachmentInbox } from '../../src/renderer/state/composer';
import type {
	ComposerAttachment,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type { ReviewCommentWire } from '../../src/shared/ipc/contracts/review-comments';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
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

/** Drains the composer attachment inbox into a spy so chips are assertable. */
function ComposerAttachmentProbe({
	onAttach,
	workspaceCwd,
}: {
	onAttach: (attachment: ComposerAttachment) => void;
	workspaceCwd: string;
}) {
	const { clear, pending } = useComposerAttachmentInbox('chat-1', workspaceCwd);
	useEffect(() => {
		if (pending.length === 0) {
			return;
		}
		for (const attachment of pending) {
			onAttach(attachment);
		}
		clear();
	}, [clear, onAttach, pending]);
	return null;
}

/** Renders the Checks panel over a PR with the given comments, plus a chip spy. */
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
	const onAttach = vi.fn();

	renderWithProviders(
		<Provider store={createStore()}>
			<ComposerAttachmentProbe
				onAttach={onAttach}
				workspaceCwd={workspace.pathLabel}
			/>
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

	return { onAttach };
}

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		writeWorkspaceFileAttachment: (request: { name?: string }) =>
			Promise.resolve({
				file: {
					isIgnored: true,
					kind: 'file',
					name: request.name ?? 'attachment.md',
					path: `.context/attachments/ab12cd/${request.name ?? 'attachment.md'}`,
				},
			}),
	});
});

afterEach(() => {
	clearEnsemblrApi();
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

// One chip per comment rather than one block for the batch, so the user can drop
// a single comment from what they are about to send.
test('"Add all to chat" chips the outstanding comments only', async () => {
	const { onAttach } = renderChecksPanel({
		comments: [resolvedComment, unresolvedComment],
	});

	fireEvent.click(screen.getByRole('button', { name: 'Add all to chat' }));

	await waitFor(() => {
		expect(onAttach).toHaveBeenCalledTimes(1);
	});
	expect(onAttach).toHaveBeenCalledWith(
		expect.objectContaining({
			id: `review-comment:${unresolvedComment.id}`,
			kind: 'review-comment',
			label: 'index.ts:12',
		}),
	);
});

test('a single comment row chips just that comment', async () => {
	const { onAttach } = renderChecksPanel({ comments: [unresolvedComment] });

	fireEvent.click(screen.getByRole('button', { name: 'Add comment to chat' }));

	await waitFor(() => {
		expect(onAttach).toHaveBeenCalledTimes(1);
	});
	expect(onAttach).toHaveBeenCalledWith(
		expect.objectContaining({ id: `review-comment:${unresolvedComment.id}` }),
	);
});

// Each comment becomes a document the composer inlines whole, so an unbounded
// batch on a busy pull request would spend the agent's context before the user's
// own question is read. The overflow stays on its rows rather than vanishing.
test('"Add all to chat" caps the batch instead of chipping every comment', async () => {
	const many = Array.from({ length: 14 }, (_, index) => ({
		...unresolvedComment,
		id: `comment-open-${index}`,
		line: index + 1,
	}));
	const { onAttach } = renderChecksPanel({ comments: many });

	fireEvent.click(screen.getByRole('button', { name: 'Add all to chat' }));

	await waitFor(() => {
		expect(onAttach).toHaveBeenCalledTimes(10);
	});
	expect(onAttach).toHaveBeenCalledWith(
		expect.objectContaining({ id: 'review-comment:comment-open-0' }),
	);
	expect(onAttach).not.toHaveBeenCalledWith(
		expect.objectContaining({ id: 'review-comment:comment-open-10' }),
	);
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
