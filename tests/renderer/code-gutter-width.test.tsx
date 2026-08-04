// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { CodePanel } from '../../src/renderer/components/code-surface';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { codeGutterDigits } from '../../src/renderer/lib/code/gutter';
import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

beforeEach(() => {
	installLocalStorage();
});

const workspaceCwd = '/workspace/ensemblr';

/** Renders the file viewer over a file of `lineCount` lines, returning its `pre`. */
function renderFileViewer(lineCount: number) {
	const filePath = `docs/notes-${lineCount}.md`;
	const content = Array.from(
		{ length: lineCount },
		(_unused, index) => `line ${index + 1}`,
	).join('\n');
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, filePath), {
		content,
		contentEncoding: 'utf8',
		path: filePath,
		sizeBytes: content.length,
	});

	const { container } = renderWithProviders(
		<FilePreviewPanel
			filePath={filePath}
			workspaceCwd={workspaceCwd}
			workspaceId='workspace-1'
		/>,
		{ client },
	);
	const pre = container.querySelector('pre');
	if (!pre) {
		throw new Error('file preview rendered no code surface');
	}
	return pre;
}

describe('every code surface sizes its gutter the same way', () => {
	test('the file viewer measures its gutter against its own line count', () => {
		expect(renderFileViewer(9).style.getPropertyValue('--ensemblr-gutter-ch')) //
			.toBe(`${codeGutterDigits(9)}ch`);
		expect(
			renderFileViewer(400).style.getPropertyValue('--ensemblr-gutter-ch'),
		).toBe(`${codeGutterDigits(400)}ch`);
	});

	test('a wrapped line clears the whole gutter, hairline included', () => {
		const pre = renderFileViewer(400);

		expect(pre.style.getPropertyValue('--ensemblr-gutter-indent')).toBe(
			`calc(${codeGutterDigits(400) + 3}ch + var(--ensemblr-hairline))`,
		);
	});

	test('a chat panel lands on the same width for the same line count', () => {
		const code = Array.from(
			{ length: 400 },
			(_unused, index) => `line ${index + 1}`,
		).join('\n');
		const { container } = renderWithProviders(
			<CodePanel code={code} language='markdown' startLine={1} />,
		);
		const gutter = container.querySelector('span[style*="width"]');

		expect(gutter?.getAttribute('style')).toContain(
			`width: ${codeGutterDigits(400)}ch`,
		);
	});

	test('a short file still reads as a column rather than a single digit', () => {
		expect(codeGutterDigits(4)).toBe(2);
		expect(renderFileViewer(4).style.getPropertyValue('--ensemblr-gutter-ch')) //
			.toBe('2ch');
	});
});
