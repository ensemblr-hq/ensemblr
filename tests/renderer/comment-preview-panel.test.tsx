// @vitest-environment happy-dom

/**
 * The comment preview tab exists to answer "what does this comment actually
 * say?", so it renders the whole body as markdown rather than the row's one-line
 * summary, and shows the diff anchor and thread replies alongside it.
 */

import { fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { expect, test, vi } from 'vitest';

import { CommentPreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/comment-preview-panel';
import { WorkspaceFileDiffOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import type { CommentPreviewPayload } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const COMMENT: CommentPreviewPayload = {
	author: 'github-actions',
	body: '## Build failed\n\nThe `cryptography` route imports a server-only module.',
	createdAt: '2026-07-20T09:00:00.000Z',
	detail: 'Build failed',
	id: 'c1',
	isResolved: false,
	line: 57,
	path: 'src/app/(site)/cryptography/page.tsx',
	prNumber: 42,
	provider: 'github-actions',
	replies: [
		{
			author: 'octocat',
			body: 'Moved it behind a dynamic import.',
			createdAt: '2026-07-20T10:00:00.000Z',
			id: 'c2',
		},
	],
	url: 'https://github.com/acme/app/pull/42#discussion_r1',
};

const WORKSPACE_CWD = '/tmp/ensemblr-workspace';

/** Renders the preview panel for one comment inside a fresh Jotai store. */
function renderPanel(comment: CommentPreviewPayload = COMMENT) {
	renderWithProviders(
		<Provider store={createStore()}>
			<CommentPreviewPanel comment={comment} workspaceCwd={WORKSPACE_CWD} />
		</Provider>,
	);
}

test('the whole body renders, not just the summary line', () => {
	renderPanel();

	expect(screen.getByText('Build failed')).toBeInTheDocument();
	expect(screen.getByText(/imports a server-only module/)).toBeInTheDocument();
});

test('the diff anchor and reply count are shown', () => {
	renderPanel();

	expect(
		screen.getByText(/src\/app\/\(site\)\/cryptography\/page\.tsx:57/),
	).toBeInTheDocument();
	expect(screen.getByText(/1 reply/)).toBeInTheDocument();
});

test('thread replies render under the head comment', () => {
	renderPanel();

	expect(
		screen.getByText('Moved it behind a dynamic import.'),
	).toBeInTheDocument();
});

test('an unresolved thread keeps its badge', () => {
	renderPanel();

	expect(screen.getByText('Unresolved')).toBeInTheDocument();
});

// The row that opened this tab labels the same comment `No description`, so the
// panel says it the same way rather than inventing a second wording.
test('a body-less comment says so instead of rendering blank', () => {
	renderPanel({ ...COMMENT, body: '', replies: undefined });

	expect(screen.getByText('No description')).toBeInTheDocument();
});

test('the diff anchor jumps to the line when an opener is available', () => {
	const openWorkspaceFileDiff = vi.fn();

	renderWithProviders(
		<Provider store={createStore()}>
			<WorkspaceFileDiffOpenerProvider value={openWorkspaceFileDiff}>
				<CommentPreviewPanel comment={COMMENT} workspaceCwd={WORKSPACE_CWD} />
			</WorkspaceFileDiffOpenerProvider>
		</Provider>,
	);

	fireEvent.click(
		screen.getByRole('button', {
			name: /src\/app\/\(site\)\/cryptography\/page\.tsx:57/,
		}),
	);

	expect(openWorkspaceFileDiff).toHaveBeenCalledWith(
		'src/app/(site)/cryptography/page.tsx',
		undefined,
		{ revealLine: 57 },
	);
});

// Rendered outside a workspace there is no diff to open, so the anchor stays
// inert text rather than a control that does nothing.
test('the diff anchor is inert with no opener in context', () => {
	renderPanel();

	expect(
		screen.queryByRole('button', {
			name: /src\/app\/\(site\)\/cryptography\/page\.tsx:57/,
		}),
	).toBeNull();
});
