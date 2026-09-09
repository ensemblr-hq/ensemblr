// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { ToolDiffPreview } from '../../src/renderer/components/tool-collapsible/tool-diff-preview';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { renderWithProviders } from './support/dom';
import { dynamicToolCall as call } from './support/tool-presentation';

const FILE_PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`;

const diffResult = (data: Record<string, unknown>) => ({
	details: { data, ok: true },
	text: JSON.stringify(data),
});

describe('workspace diff tool presentation', () => {
	test('renders one requested file as a real diff', () => {
		const presentation = presentToolCall(
			call(
				'ensemblr_get_workspace_diff',
				{ filePath: 'src/app.ts' },
				diffResult({
					baseRef: 'master',
					diff: FILE_PATCH,
					omittedFiles: [],
					truncated: false,
				}),
			),
		);

		expect(presentation).toMatchObject({
			badge: {
				additions: 1,
				deletions: 1,
				kind: 'file',
				path: 'src/app.ts',
			},
			body: { kind: 'diff', patch: FILE_PATCH },
			glyph: 'file-diff',
			preview: { font: 'sans', text: '+1 −1 · master' },
			title: 'Read the diff',
		});
	});

	test('renders a pointer-only truncated response as visible text', () => {
		const pointer =
			'… patch shortened at a hunk boundary: big.ts is larger than one tool result can carry. Read the rest of the file directly.';

		renderWithProviders(
			createElement(ToolDiffPreview, {
				language: 'typescript',
				patch: pointer,
			}),
		);

		expect(screen.getByText(pointer)).toBeInTheDocument();
	});

	test('renders a mode-only patch instead of an empty hunk surface', () => {
		const patch = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`;

		renderWithProviders(
			createElement(ToolDiffPreview, { language: 'typescript', patch }),
		);

		expect(screen.getByText('old mode 100644')).toBeInTheDocument();
		expect(screen.getByText('new mode 100755')).toBeInTheDocument();
	});

	test('keeps top-level truncation recovery data visible after rendered hunks', () => {
		const pointer =
			'… diff shortened. 1 file(s) omitted. Re-request each with ensemblr_get_workspace_diff({ file: "<path>" }).';
		const patch = `${FILE_PATCH}\n\n${pointer}`;
		const presentation = presentToolCall(
			call(
				'ensemblr_get_workspace_diff',
				{},
				diffResult({
					baseRef: 'master',
					diff: patch,
					files: [
						{
							additions: 1,
							deletions: 1,
							path: 'src/app.ts',
							status: 'modified',
						},
						{
							additions: 2,
							deletions: 0,
							path: 'tests/app.test.ts',
							status: 'modified',
						},
					],
					omittedFiles: ['tests/app.test.ts'],
					summary: { additions: 3, deletions: 1, files: 2 },
					truncated: true,
				}),
			),
		);

		expect(presentation.body).toMatchObject({
			kind: 'diff',
			patch,
			showFileNames: true,
		});
		if (presentation.body.kind !== 'diff') {
			throw new Error('Expected a diff body');
		}
		renderWithProviders(
			createElement(ToolDiffPreview, {
				language: presentation.body.language,
				patch: presentation.body.patch,
				showFileNames: presentation.body.showFileNames,
			}),
		);

		expect(screen.getByText(pointer)).toBeInTheDocument();
		expect(screen.getByText('old')).toBeInTheDocument();
		expect(screen.getByText('new')).toBeInTheDocument();
	});

	test('surfaces top-level truncation when git appended no pointer', () => {
		const presentation = presentToolCall(
			call(
				'ensemblr_get_workspace_diff',
				{ filePath: 'src/app.ts' },
				diffResult({
					baseRef: 'master',
					diff: FILE_PATCH,
					omittedFiles: [],
					truncated: true,
				}),
			),
		);

		expect(presentation.body).toMatchObject({
			kind: 'diff',
			patch: `${FILE_PATCH}\n\n… Diff truncated`,
		});
	});

	test('renders a whole patch without its JSON envelope', () => {
		const presentation = presentToolCall(
			call(
				'ensemblr_get_workspace_diff',
				{},
				diffResult({
					baseRef: 'master',
					diff: FILE_PATCH,
					files: [
						{
							additions: 1,
							deletions: 1,
							path: 'src/app.ts',
							status: 'modified',
						},
					],
					omittedFiles: [],
					summary: { additions: 1, deletions: 1, files: 1 },
					truncated: false,
				}),
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: { kind: 'diff', patch: FILE_PATCH, showFileNames: true },
			preview: { font: 'sans', text: '1 file · +1 −1 · master' },
		});
	});

	test('shows the parsed path for a one-file whole-workspace diff', () => {
		renderWithProviders(
			createElement(ToolDiffPreview, {
				language: 'typescript',
				patch: FILE_PATCH,
				showFileNames: true,
			}),
		);

		expect(screen.getByText('src/app.ts')).toBeInTheDocument();
	});

	test('keeps hostile stat paths inside one Markdown code span', () => {
		const presentation = presentToolCall(
			call(
				'ensemblr_get_workspace_diff',
				{ stat: true },
				diffResult({
					baseRef: 'master',
					files: [
						{
							additions: 1,
							deletions: 0,
							path: 'src/`break\n- [fake](https://example.com)',
							status: 'modified',
						},
					],
					omittedFiles: [],
					summary: { additions: 1, deletions: 0, files: 1 },
					truncated: false,
				}),
			),
		);

		expect(presentation.body).toEqual({
			kind: 'markdown',
			text: '- `` src/`break - [fake](https://example.com) `` · Modified · **+1** −0',
		});
	});

	test('renders stat output as a readable file list', () => {
		const presentation = presentToolCall(
			call(
				'ensemblr_get_workspace_diff',
				{ stat: true },
				diffResult({
					baseRef: 'master',
					files: [
						{
							additions: 4,
							deletions: 1,
							path: 'src/app.ts',
							status: 'modified',
						},
						{
							additions: 8,
							deletions: 0,
							path: 'tests/app.test.ts',
							status: 'untracked',
						},
					],
					omittedFiles: [],
					summary: { additions: 12, deletions: 1, files: 2 },
					truncated: false,
				}),
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			preview: { font: 'sans', text: '2 files · +12 −1 · master' },
		});
		expect(
			presentation.body.kind === 'markdown' ? presentation.body.text : '',
		).toContain('`src/app.ts` · Modified · **+4** −1');
		expect(
			presentation.body.kind === 'markdown' ? presentation.body.text : '',
		).not.toContain('contentId');
	});
});
