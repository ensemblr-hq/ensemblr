// @vitest-environment happy-dom

/**
 * A PR comment opens into the workspace's ephemeral preview slot on a single
 * click and keeps its tab on a double click, matching the changed-file and
 * file-tree rows. The `preview` flag has to survive the whole chain — row →
 * Checks panel → opener context — or double-clicking silently previews again.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, expect, test, vi } from 'vitest';

import { ChecksPanel } from '../../src/renderer/components/workbench-shell/checks-panel/checks-panel';
import { PullRequestCommentRow } from '../../src/renderer/components/workbench-shell/checks-panel/pr-rows';
import { CommentPreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const comment: WorkspaceShellModel['pullRequest']['comments'][number] = {
	author: 'octocat',
	body: 'needs a guard here',
	detail: 'needs a guard here',
	id: 'comment-1',
	line: 12,
	origin: 'user',
	path: 'src/main/index.ts',
	provider: 'github',
};

/** Renders one comment row with a spy opener. */
function renderCommentRow() {
	const onOpenPreview = vi.fn();

	renderWithProviders(
		<PullRequestCommentRow comment={comment} onOpenPreview={onOpenPreview} />,
	);

	return { onOpenPreview };
}

beforeEach(() => {
	installLocalStorage();
});

test('a single click opens the comment into the preview slot', () => {
	const { onOpenPreview } = renderCommentRow();

	fireEvent.click(screen.getByText(comment.detail));

	expect(onOpenPreview).toHaveBeenCalledWith();
});

test('a double click asks for a permanent tab instead', () => {
	const { onOpenPreview } = renderCommentRow();

	fireEvent.doubleClick(screen.getByText(comment.detail));

	expect(onOpenPreview).toHaveBeenCalledWith({ preview: false });
});

/** Renders the Checks panel with one comment and a spy preview opener. */
function renderChecksPanel() {
	const workspace = getDefaultWorkspace();
	const openCommentPreview = vi.fn();

	render(
		<Provider store={createStore()}>
			<QueryClientProvider client={createTestQueryClient()}>
				<CommentPreviewOpenerProvider value={openCommentPreview}>
					<ChecksPanel
						workspace={{
							...workspace,
							pullRequest: {
								...workspace.pullRequest,
								comments: [comment],
								number: 138,
								state: 'open',
							},
						}}
					/>
				</CommentPreviewOpenerProvider>
			</QueryClientProvider>
		</Provider>,
	);

	return { openCommentPreview };
}

test('the Checks panel forwards a single click as a preview open', () => {
	const { openCommentPreview } = renderChecksPanel();

	fireEvent.click(screen.getByText(comment.detail));

	expect(openCommentPreview).toHaveBeenCalledWith({ comment, prNumber: 138 });
});

test('the Checks panel forwards a double click as a permanent open', () => {
	const { openCommentPreview } = renderChecksPanel();

	fireEvent.doubleClick(screen.getByText(comment.detail));

	expect(openCommentPreview).toHaveBeenCalledWith({
		comment,
		preview: false,
		prNumber: 138,
	});
});
