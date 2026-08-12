// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { CommentPreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/comment-preview-panel';
import { DOCUMENT_BODY_CLASSES } from '../../src/renderer/components/workbench-shell/conversation-panel/document-column';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import type { CommentPreviewPayload } from '../../src/renderer/types/workbench';
import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const workspaceCwd = '/workspace/ensemblr';
const filePath = 'docs/notes.md';
const fileContent =
	'# Notes\n\nBody copy that the preview lays out as prose.\n';

function renderMarkdownPreview() {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, filePath), {
		content: fileContent,
		contentEncoding: 'utf8',
		path: filePath,
		sizeBytes: fileContent.length,
	});

	const rendered = renderWithProviders(
		<FilePreviewPanel
			filePath={filePath}
			workspaceCwd={workspaceCwd}
			workspaceId='workspace-1'
		/>,
		{ client },
	);
	fireEvent.click(
		screen.getByRole('button', { name: 'Show formatted preview' }),
	);
	return rendered;
}

const COMMENT: CommentPreviewPayload = {
	author: 'octocat',
	body: '# Review\n\nThis reads as a document, not a chat bubble.',
	detail: 'Review',
	id: 'comment-1',
	prNumber: 12,
	provider: 'github',
};

beforeEach(() => {
	installLocalStorage();
});

describe('markdown document column', () => {
	test('caps the file preview at the conversation measure and centers it', () => {
		const { container } = renderMarkdownPreview();
		const answer = container.querySelector('.ensemblr-answer');
		const column = answer?.parentElement;

		expect(column?.className).toContain('max-w-3xl');
		expect(column?.className).toContain('mx-auto');
	});

	test('renders the file preview at the app type size, not the browser default', () => {
		const { container } = renderMarkdownPreview();
		const column = container.querySelector('.ensemblr-answer')?.parentElement;

		expect(column?.className).toContain('text-sm');
	});

	test('keeps the scroll container outside the capped column', () => {
		const { container } = renderMarkdownPreview();
		const column = container.querySelector('.ensemblr-answer')?.parentElement;

		expect(column?.className).not.toContain('overflow-auto');
		expect(column?.parentElement?.className).toContain('overflow-auto');
	});

	test('caps the comment preview at the same measure', () => {
		const { container } = renderWithProviders(
			<CommentPreviewPanel comment={COMMENT} />,
		);
		const column = container
			.querySelector('.ensemblr-answer')
			?.closest('div.max-w-3xl');

		expect(column).not.toBeNull();
		expect(column?.className).toContain('mx-auto');
	});

	test('both previews render the shared column rather than their own', () => {
		const file = renderMarkdownPreview();
		const comment = renderWithProviders(
			<CommentPreviewPanel comment={COMMENT} />,
		);

		const fileColumn =
			file.container.querySelector('.ensemblr-answer')?.parentElement
				?.className;
		const commentColumn = comment.container
			.querySelector('.ensemblr-answer')
			?.closest('div.max-w-3xl')?.className;

		for (const token of DOCUMENT_BODY_CLASSES.split(' ')) {
			expect(fileColumn).toContain(token);
			expect(commentColumn).toContain(token);
		}
	});

	test('lands the comment header on the column its body reads on', () => {
		const { container } = renderWithProviders(
			<CommentPreviewPanel comment={COMMENT} />,
		);
		const columns = container.querySelectorAll('div.max-w-3xl');

		expect(columns.length).toBe(2);
	});
});
