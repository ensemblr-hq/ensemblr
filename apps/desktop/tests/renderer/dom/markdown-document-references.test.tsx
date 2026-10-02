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
const PIXEL_SOURCE = `data:image/png;base64,${PIXEL_BASE64}`;
const LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

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

/**
 * Answers a file read the way the preview IPC does: an SVG comes back as the
 * markup it is, `missing` is not found, and anything else is a one-pixel PNG.
 * @param path - The workspace-relative path being read.
 * @returns The read result for that path.
 */
function previewReadFor(path: string): ReadWorkspaceFileResult {
	if (path.includes('missing')) {
		return { error: { code: 'not-found', message: 'gone' }, path };
	}
	if (path.endsWith('.svg')) {
		return {
			content: LOGO_SVG,
			contentEncoding: 'utf8',
			path,
			sizeBytes: LOGO_SVG.length,
		};
	}
	return {
		content: PIXEL_BASE64,
		contentEncoding: 'base64',
		mimeType: 'image/png',
		path,
		sizeBytes: 68,
	};
}

/** Installs a file-read stub answering every path through {@link previewReadFor}. */
function stubFileReads(): ReturnType<typeof vi.fn> {
	const readWorkspaceFile = vi.fn(
		async ({ path }: { path: string }): Promise<ReadWorkspaceFileResult> =>
			previewReadFor(path),
	);
	installEnsemblrApi({ readWorkspaceFile });
	return readWorkspaceFile;
}

/**
 * Writes a README-style `<picture>` whose `<source>` swaps in another file under
 * a dark color scheme.
 * @param srcset - The `<source>` element's `srcset`, exactly as written.
 * @returns The markdown holding the picture.
 */
function pictureMarkdown(srcset: string): string {
	return [
		'<p align="center">',
		'  <picture>',
		`    <source media="(prefers-color-scheme: dark)" srcset="${srcset}">`,
		'    <img src="images/welcome.png" width="300" alt="The welcome screen">',
		'  </picture>',
		'</p>',
	].join('\n');
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

	test('still opens a destination outside the workspace, but names it first', async () => {
		const openFilePreview = vi.fn();
		renderDocument(
			'See [the plan](~/.claude/plans/notes.md).',
			openFilePreview,
		);

		// The link text is the author's, and the markdown is not always the
		// reader's own — so an escaping destination carries its real path beside
		// the text rather than opening silently behind it.
		const link = await screen.findByRole('button', {
			name: 'the plan (~/.claude/plans/notes.md)',
		});
		await userEvent.click(link);
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
		expect(image.getAttribute('src')).toBe(PIXEL_SOURCE);
		expect(readWorkspaceFile).toHaveBeenCalledWith({
			path: 'docs/guide/images/welcome.png',
			workspaceCwd: WORKSPACE_CWD,
		});
	});

	// The preview reads an SVG back as markup so the file view and diff show its
	// source, which is exactly what an `<img>` cannot take as bytes.
	test('draws an SVG the workspace reads back as markup', async () => {
		renderDocument('<img src="images/logo.svg" width="128" alt="The logo">');

		const image = await screen.findByRole('img', { name: 'The logo' });
		const source = image.getAttribute('src') ?? '';
		expect(source.startsWith('data:image/svg+xml')).toBe(true);
		expect(decodeURIComponent(source.slice(source.indexOf(',') + 1))).toBe(
			LOGO_SVG,
		);
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

// A README picks its dark screenshot with a `<source>`. Left as a path, the one
// that matches resolves against the app's origin, fails, and the failure lands
// on the `<img>` beside it, which then draws nothing at all.
describe('pictures a document writes', () => {
	test('draws the color-scheme source from the workspace bytes', async () => {
		const readWorkspaceFile = stubFileReads();
		const container = renderDocument(
			pictureMarkdown('images/dark/welcome.png'),
		);

		await screen.findByRole('img', { name: 'The welcome screen' });
		await vi.waitFor(() => {
			expect(
				container.querySelector('picture source')?.getAttribute('srcset'),
			).toBe(PIXEL_SOURCE);
		});
		expect(
			container.querySelector('picture source')?.getAttribute('media'),
		).toBe('(prefers-color-scheme: dark)');
		expect(readWorkspaceFile).toHaveBeenCalledWith({
			path: 'docs/guide/images/dark/welcome.png',
			workspaceCwd: WORKSPACE_CWD,
		});
	});

	test('keeps the density the author gave the source', async () => {
		const container = renderDocument(
			pictureMarkdown('images/dark/welcome.png 2x'),
		);

		await vi.waitFor(() => {
			expect(
				container.querySelector('picture source')?.getAttribute('srcset'),
			).toBe(`${PIXEL_SOURCE} 2x`);
		});
	});

	test('drops a source it cannot read, leaving the picture to its image', async () => {
		const container = renderDocument(
			pictureMarkdown('images/dark/missing.png'),
		);

		const image = await screen.findByRole('img', {
			name: 'The welcome screen',
		});
		expect(image.getAttribute('src')).toBe(PIXEL_SOURCE);
		expect(container.querySelector('picture source')).toBeNull();
	});

	test('reads nothing off disk for a source outside the workspace', async () => {
		const readWorkspaceFile = stubFileReads();
		const container = renderDocument(pictureMarkdown('/etc/passwd'));

		await screen.findByRole('img', { name: 'The welcome screen' });
		expect(container.querySelector('picture source')).toBeNull();
		expect(readWorkspaceFile).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: expect.stringContaining('passwd') }),
		);
	});

	test('leaves a remote source to the platform', async () => {
		const container = renderDocument(
			pictureMarkdown('https://example.com/dark.png'),
		);

		await screen.findByRole('img', { name: 'The welcome screen' });
		expect(
			container.querySelector('picture source')?.getAttribute('srcset'),
		).toBe('https://example.com/dark.png');
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
