// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const workspaceCwd = '/workspace/ensemblr';
const filePath = 'docs/notes.md';

function renderMarkdownPreview(fileContent: string) {
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

beforeEach(() => {
	installLocalStorage();
});

describe('markdown frontmatter header', () => {
	test('draws the block as named metadata instead of a run-on heading', () => {
		const { container } = renderMarkdownPreview(
			'---\nchatTabId: "d2610d0b"\nmessageCount: 771\n---\n\n# Workspace freeze\n',
		);
		const terms = [...container.querySelectorAll('dt')].map(
			(term) => term.textContent,
		);
		const details = [...container.querySelectorAll('dd')].map(
			(detail) => detail.textContent,
		);

		expect(terms).toEqual(['chatTabId', 'messageCount']);
		expect(details).toEqual(['d2610d0b', '771']);
	});

	test('starts the body at the document heading', () => {
		const { container } = renderMarkdownPreview(
			'---\ntitle: Notes\n---\n\n# Workspace freeze\n',
		);
		const answer = container.querySelector('.ensemblr-answer');

		expect(answer?.querySelector('h1')?.textContent).toBe('Workspace freeze');
		expect(answer?.querySelector('h2')).toBeNull();
		expect(answer?.querySelector('hr')).toBeNull();
	});

	test('leaves a document without frontmatter unchanged', () => {
		const { container } = renderMarkdownPreview('# Notes\n\nBody copy.\n');

		expect(container.querySelector('dl')).toBeNull();
		expect(container.querySelector('.ensemblr-answer h1')?.textContent).toBe(
			'Notes',
		);
	});

	test('shows a block it cannot group as written', () => {
		const { container } = renderMarkdownPreview(
			'---\nauthor:\n  name: Philipp\n---\n\n# Notes\n',
		);

		expect(container.querySelector('dl')).toBeNull();
		expect(container.querySelector('pre')?.textContent).toBe(
			'author:\n  name: Philipp',
		);
	});

	test('shows a repeated key as written rather than as two rows', () => {
		const errors = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		const { container } = renderMarkdownPreview(
			'---\ntag: a\ntag: b\n---\n\n# Notes\n',
		);

		expect(container.querySelector('dl')).toBeNull();
		expect(container.querySelector('pre')?.textContent).toBe('tag: a\ntag: b');
		expect(errors).not.toHaveBeenCalled();
	});

	test('leaves a document fenced by two rules unchanged', () => {
		const { container } = renderMarkdownPreview(
			'---\n\nIntro paragraph.\n\n---\n\nMore copy.\n',
		);
		const answer = container.querySelector('.ensemblr-answer');

		expect(container.querySelector('dl')).toBeNull();
		expect(container.querySelector('pre')).toBeNull();
		expect(answer?.textContent).toContain('Intro paragraph.');
		expect(answer?.textContent).toContain('More copy.');
	});
});
