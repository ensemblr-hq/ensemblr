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
const fileContent = `# Notes\n\n${'a very long line that overflows the preview viewport '.repeat(8)}\n`;

function renderPreview() {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, filePath), {
		content: fileContent,
		contentEncoding: 'utf8',
		path: filePath,
		sizeBytes: fileContent.length,
	});

	const rendered = renderWithProviders(
		<FilePreviewPanel filePath={filePath} workspaceCwd={workspaceCwd} />,
		{ client },
	);
	const pre = rendered.container.querySelector('pre');
	if (!pre) {
		throw new Error('file preview rendered no code surface');
	}
	return { ...rendered, pre };
}

beforeEach(() => {
	installLocalStorage();
});

describe('file preview code surface', () => {
	test('sizes the code background to the widest line so it covers the scroll width', () => {
		const { pre } = renderPreview();

		expect(pre.className).toContain('bg-code');
		expect(pre.className).toContain('w-max');
		expect(pre.className).toContain('min-w-full');
	});

	test('scrolls long lines horizontally until word wrap is switched on', () => {
		const { pre } = renderPreview();

		expect(pre.className).not.toContain('whitespace-pre-wrap');

		fireEvent.click(screen.getByRole('button', { name: 'Enable word wrap' }));

		expect(pre.className).toContain('whitespace-pre-wrap');
		expect(pre.className).not.toContain('w-max');
	});

	test('keeps a single scroll container around the code surface', () => {
		const { container } = renderPreview();
		const scrollers = container.querySelectorAll('.overflow-auto');

		expect(scrollers.length).toBe(1);
	});

	test('flips the toggle label and pressed state once wrapping is on', () => {
		renderPreview();
		const toggle = screen.getByRole('button', { name: 'Enable word wrap' });

		expect(toggle.getAttribute('aria-pressed')).toBe('false');

		fireEvent.click(toggle);

		const pressed = screen.getByRole('button', { name: 'Disable word wrap' });
		expect(pressed.getAttribute('aria-pressed')).toBe('true');
	});
});
