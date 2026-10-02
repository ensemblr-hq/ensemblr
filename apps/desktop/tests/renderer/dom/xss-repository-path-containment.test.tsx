// @vitest-environment happy-dom

/**
 * Two surfaces open a file from a path a *repository* wrote, on one click.
 *
 * `.ensemblr/architecture.json` is tracked, and an agent writes it; a pull-request
 * comment renders through the same markdown surface a repository document does.
 * The preview IPC reads an escaping path perfectly happily — that is what lets a
 * file tab open `/tmp` — so neither surface may hand one over unweighed, and the
 * visible label is the node name or the link text rather than the destination.
 *
 * The diagram refuses outright, because `sources[].path` is workspace-relative
 * by contract. The markdown link keeps its escape hatch — agents write
 * `~/.claude/` and `/tmp` paths constantly and following a link is the reader's
 * own decision — but shows the destination it would open.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MarkdownFileLink } from '@/renderer/components/markdown';
import { FILE_REFERENCE_HREF_ATTRIBUTE } from '@/renderer/lib/markdown-rehype-plugins';
import type { WorkspacePathMatch } from '@/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

const openFilePreview = vi.fn();
let resolved: WorkspacePathMatch | null = null;

vi.mock(
	'@/renderer/components/workbench-shell/conversation-panel/file-preview-context',
	() => ({
		useFilePreviewOpener: () => openFilePreview,
		useWorkspacePathResolver: () => () => resolved,
	}),
);

afterEach(() => {
	openFilePreview.mockClear();
	resolved = null;
});

describe('a markdown link to a path outside the workspace', () => {
	test('shows the destination beside the text it was written as', async () => {
		resolved = {
			kind: 'file',
			path: '/Users/someone/.aws/credentials',
			scope: 'external',
		};
		renderWithProviders(
			<MarkdownFileLink
				{...{ [FILE_REFERENCE_HREF_ATTRIBUTE]: '~/.aws/credentials' }}
			>
				see the contributing guide
			</MarkdownFileLink>,
		);

		const link = screen.getByRole('button');
		expect(link.textContent).toContain('see the contributing guide');
		expect(link.textContent).toContain('/Users/someone/.aws/credentials');

		await userEvent.click(link);
		expect(openFilePreview).toHaveBeenCalledWith(
			'/Users/someone/.aws/credentials',
		);
	});

	test('leaves a workspace destination reading as the author wrote it', () => {
		resolved = {
			kind: 'file',
			path: 'docs/contributing.md',
			scope: 'workspace',
		};
		renderWithProviders(
			<MarkdownFileLink
				{...{ [FILE_REFERENCE_HREF_ATTRIBUTE]: './contributing.md' }}
			>
				the contributing guide
			</MarkdownFileLink>,
		);
		expect(screen.getByRole('button').textContent).toBe(
			'the contributing guide',
		);
	});
});
