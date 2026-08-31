// @vitest-environment happy-dom

/**
 * A markdown document previewed from the workspace writes its links and images
 * relative to its own directory. Left alone those resolve against the app's own
 * origin, so the one file they cannot reach is the one they name.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MarkdownDocumentScopeProvider } from '@/renderer/components/markdown';
import { MessageResponse } from '@/renderer/components/message';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { createWorkspacePathResolver } from '@/renderer/lib/agent-timeline';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const WORKSPACE_CWD = '/Users/me/repo';
const PIXEL_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A tree entry keyed on its own path, which is all the resolver reads. */
function entry(
	path: string,
	kind: 'directory' | 'file' = 'file',
): WorkspaceFileSummary {
	return { id: path, kind, name: path.split('/').at(-1) ?? path, path };
}

const FILES: readonly WorkspaceFileSummary[] = [
	entry('docs/guide/03-first-run.md'),
	entry('docs/guide/02-requirements.md'),
	entry('docs/guide/images/welcome.png'),
	entry('docs/adr', 'directory'),
	entry('docs/adr/0001-record-decisions.md'),
];

/** Renders markdown as the preview of `docs/guide/03-first-run.md` would. */
function renderDocument(
	markdown: string,
	openFilePreview: (filePath: string) => void = vi.fn(),
): HTMLElement {
	return renderWithProviders(
		<WorkspacePathResolverProvider
			value={createWorkspacePathResolver(FILES, WORKSPACE_CWD)}
		>
			<FilePreviewOpenerProvider value={openFilePreview}>
				<MarkdownDocumentScopeProvider
					value={{
						baseDirectory: 'docs/guide',
						workspaceCwd: WORKSPACE_CWD,
					}}
				>
					<MessageResponse>{markdown}</MessageResponse>
				</MarkdownDocumentScopeProvider>
			</FilePreviewOpenerProvider>
		</WorkspacePathResolverProvider>,
	).container;
}

/** Answers the file read with a one-pixel PNG for every path but `missing`. */
function stubFileReads(): ReturnType<typeof vi.fn> {
	const readWorkspaceFile = vi.fn(
		async ({ path }: { path: string }): Promise<ReadWorkspaceFileResult> =>
			path.includes('missing')
				? { error: { code: 'not-found', message: 'gone' }, path }
				: {
						content: PIXEL_BASE64,
						contentEncoding: 'base64',
						mimeType: 'image/png',
						path,
						sizeBytes: 68,
					},
	);
	installEnsemblrApi({ readWorkspaceFile });
	return readWorkspaceFile;
}

beforeEach(() => {
	stubFileReads();
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('links a document writes to its neighbours', () => {
	test('opens the file a relative link names, read from the document folder', async () => {
		const openFilePreview = vi.fn();
		renderDocument(
			'Start with [Requirements](./02-requirements.md) first.',
			openFilePreview,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: 'Requirements' }),
		);
		expect(openFilePreview).toHaveBeenCalledWith(
			'docs/guide/02-requirements.md',
		);
	});

	test('follows a climb out of the document folder', async () => {
		const openFilePreview = vi.fn();
		renderDocument(
			'See [ADR 0001](../adr/0001-record-decisions.md).',
			openFilePreview,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: 'ADR 0001' }),
		);
		expect(openFilePreview).toHaveBeenCalledWith(
			'docs/adr/0001-record-decisions.md',
		);
	});

	test('keeps the author’s own link text rather than the filename', async () => {
		renderDocument('Start with [Requirements](./02-requirements.md) first.');

		expect(
			await screen.findByRole('button', { name: 'Requirements' }),
		).toBeInTheDocument();
		expect(screen.queryByText('02-requirements.md')).toBeNull();
	});

	test('leaves a destination the tree cannot place as prose', async () => {
		renderDocument('See [the old plan](./99-never-written.md).');

		expect(await screen.findByText('See the old plan.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'the old plan' })).toBeNull();
	});

	test('does not touch an http link', async () => {
		const openFilePreview = vi.fn();
		const container = renderDocument(
			'Read [the docs](https://example.com/docs).',
			openFilePreview,
		);

		expect(await screen.findByText('the docs')).toBeInTheDocument();
		expect(container.querySelector('[data-file-href]')).toBeNull();
	});

	test('does not touch an in-document anchor', async () => {
		const container = renderDocument('Jump to [the top](#overview).');

		expect(await screen.findByText('the top')).toBeInTheDocument();
		expect(container.querySelector('[data-file-href]')).toBeNull();
	});

	test('keeps the title the author wrote rather than the resolved path', async () => {
		renderDocument(
			'Start with [Requirements](./02-requirements.md "Read this first").',
		);

		expect(
			await screen.findByRole('button', { name: 'Requirements' }),
		).toHaveAttribute('title', 'Read this first');
	});

	test('still opens a destination outside the workspace, which a click asks for', async () => {
		const openFilePreview = vi.fn();
		renderDocument(
			'See [the plan](~/.claude/plans/notes.md).',
			openFilePreview,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: 'the plan' }),
		);
		expect(openFilePreview).toHaveBeenCalledWith('~/.claude/plans/notes.md');
	});
});

describe('images a document writes', () => {
	test('draws a relative image from the workspace bytes', async () => {
		const readWorkspaceFile = stubFileReads();
		renderDocument('![The welcome screen](./images/welcome.png)');

		const image = await screen.findByRole('img', {
			name: 'The welcome screen',
		});
		expect(image.getAttribute('src')).toBe(
			`data:image/png;base64,${PIXEL_BASE64}`,
		);
		expect(readWorkspaceFile).toHaveBeenCalledWith({
			path: 'docs/guide/images/welcome.png',
			workspaceCwd: WORKSPACE_CWD,
		});
	});

	test('falls back to the alt text when the file cannot be read', async () => {
		renderDocument('![A missing diagram](./images/missing.png)');

		expect(
			await screen.findByText('A missing diagram (image unavailable)'),
		).toBeInTheDocument();
	});

	test('leaves a remote image to the platform', async () => {
		const readWorkspaceFile = stubFileReads();
		renderDocument('![A badge](https://example.com/badge.svg)');

		const image = await screen.findByRole('img', { name: 'A badge' });
		expect(image.getAttribute('src')).toBe('https://example.com/badge.svg');
		expect(readWorkspaceFile).not.toHaveBeenCalled();
	});

	// A document is not always the reader's own — a pull-request comment renders
	// through this same surface — and an image is fetched the moment it is drawn.
	test.each([
		['a home-relative source', '![x](~/.aws/credentials)'],
		['an absolute source', '![x](/etc/passwd)'],
		['a climb out of the workspace', '![x](../../../etc/passwd)'],
		['a climb past the filesystem root', '![x](../../../../../../etc/passwd)'],
	])('reads nothing off disk for %s', async (_name, markdown) => {
		const readWorkspaceFile = stubFileReads();
		renderDocument(markdown);

		expect(
			await screen.findByText('x (image unavailable)'),
		).toBeInTheDocument();
		expect(readWorkspaceFile).not.toHaveBeenCalled();
	});
});

describe('inline code a document writes', () => {
	test('places a bare path against the document folder first', async () => {
		const openFilePreview = vi.fn();
		renderDocument(
			'Edit `02-requirements.md` before shipping.',
			openFilePreview,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: /02-requirements\.md/ }),
		);
		expect(openFilePreview).toHaveBeenCalledWith(
			'docs/guide/02-requirements.md',
		);
	});

	test('still places a workspace-relative path the document folder cannot hold', async () => {
		const openFilePreview = vi.fn();
		renderDocument(
			'Edit `docs/adr/0001-record-decisions.md` before shipping.',
			openFilePreview,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: /0001-record-decisions\.md/ }),
		);
		expect(openFilePreview).toHaveBeenCalledWith(
			'docs/adr/0001-record-decisions.md',
		);
	});
});
