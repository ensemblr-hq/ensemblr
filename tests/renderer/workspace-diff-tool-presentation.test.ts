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

const NEW_FILE_PATCH = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;`;

const DELETED_FILE_PATCH = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 3333333..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const a = 1;
-export const b = 2;`;

const RENAME_PATCH = `diff --git a/src/before.ts b/src/after.ts
similarity index 80%
rename from src/before.ts
rename to src/after.ts
index 1111111..2222222 100644
--- a/src/before.ts
+++ b/src/after.ts
@@ -1,2 +1,2 @@
 keep
-old
+new`;

const PURE_RENAME_PATCH = `diff --git a/src/before.ts b/src/after.ts
similarity index 100%
rename from src/before.ts
rename to src/after.ts`;

const BINARY_PATCH = `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/logo.png differ`;

const changedRows = (container: HTMLElement) => ({
	added: container.querySelectorAll('[class*="bg-diff-addition-surface"]')
		.length,
	removed: container.querySelectorAll('[class*="bg-diff-deletion-surface"]')
		.length,
});

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

describe('workspace diff without a usable payload', () => {
	const diffCall = (text: string, details?: Record<string, unknown>) =>
		call(
			'mcp__ensemblr__ensemblr_get_workspace_diff',
			{},
			details === undefined ? { text } : { details, text },
		);

	test('keeps a stat-only result off the diff surface', () => {
		const presentation = presentToolCall(
			diffCall(JSON.stringify({ baseRef: 'master' })),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
		expect(presentation.preview).toEqual({ font: 'sans', text: 'master' });
	});

	test('recovers the patch from JSON cut off mid-string', () => {
		const truncated = `{"baseRef":"master","diff":${JSON.stringify(FILE_PATCH).slice(0, -3)}`;
		const presentation = presentToolCall(diffCall(truncated));

		expect(presentation.body).toMatchObject({
			kind: 'diff',
			patch: FILE_PATCH.slice(0, -2),
		});
	});

	test('renders the hunks a truncated response still carries', () => {
		const truncated = `{"baseRef":"master","diff":${JSON.stringify(FILE_PATCH).slice(0, -3)}`;
		const presentation = presentToolCall(diffCall(truncated));
		if (presentation.body.kind !== 'diff') {
			throw new Error('Expected a diff body');
		}

		const { container } = renderWithProviders(
			createElement(ToolDiffPreview, {
				language: presentation.body.language,
				patch: presentation.body.patch,
				showFileNames: presentation.body.showFileNames,
			}),
		);

		expect(screen.getByText('old')).toBeInTheDocument();
		expect(changedRows(container).removed).toBe(1);
	});

	test('treats non-JSON text carrying a patch as the patch itself', () => {
		const presentation = presentToolCall(diffCall(FILE_PATCH));

		expect(presentation.body).toMatchObject({
			kind: 'diff',
			patch: FILE_PATCH,
		});
	});

	test('shows unparseable prose as readable code instead of an empty card', () => {
		const presentation = presentToolCall(diffCall('git exploded: bad ref'));

		expect(presentation.body).toEqual({
			code: 'git exploded: bad ref',
			kind: 'code',
			language: 'text',
			startLine: null,
		});
	});

	test('keeps an unsuccessful call on the error body', () => {
		const presentation = presentToolCall(
			diffCall('No workspace is open.', { error: 'no-workspace', ok: false }),
		);

		expect(presentation.body.kind).toBe('error');
	});

	test('shows the text of a payload that is not an object', () => {
		const presentation = presentToolCall(
			diffCall('42', { data: 42, ok: true }),
		);

		expect(presentation.body).toMatchObject({ code: '42', kind: 'code' });
	});

	test('shows the text of a JSON array payload', () => {
		const presentation = presentToolCall(diffCall('[1,2]'));

		expect(presentation.body).toMatchObject({ code: '[1,2]', kind: 'code' });
	});

	test('keeps a genuinely blank result empty', () => {
		expect(presentToolCall(diffCall('  \n ')).body).toEqual({ kind: 'empty' });
		expect(presentToolCall(diffCall('')).body).toEqual({ kind: 'empty' });
	});

	test('leaves other control ops on their own presenter', () => {
		const presentation = presentToolCall(
			call(
				'mcp__ensemblr__ensemblr_list_models',
				{},
				diffResult({ models: [] }),
			),
		);

		expect(presentation.body.kind).not.toBe('diff');
		expect(presentation.body.kind).not.toBe('code');
		expect(presentation.title).not.toBe('Read the diff');
	});
});

describe('workspace diff patch shapes', () => {
	const renderPatch = (patch: string, showFileNames = true) =>
		renderWithProviders(
			createElement(ToolDiffPreview, {
				language: 'typescript',
				patch,
				showFileNames,
			}),
		).container;

	test('renders a new file as inserted diff rows', () => {
		const container = renderPatch(NEW_FILE_PATCH);

		expect(changedRows(container)).toEqual({ added: 2, removed: 0 });
		expect(screen.getByText('src/new.ts')).toBeInTheDocument();
	});

	test('renders a deleted file as removed diff rows', () => {
		const container = renderPatch(DELETED_FILE_PATCH);

		expect(changedRows(container)).toEqual({ added: 0, removed: 2 });
		expect(screen.getByText('src/old.ts')).toBeInTheDocument();
	});

	test('renders a rename with edits as diff rows under the new path', () => {
		const container = renderPatch(RENAME_PATCH);

		expect(changedRows(container)).toEqual({ added: 1, removed: 1 });
		expect(screen.getByText('src/after.ts')).toBeInTheDocument();
	});

	test('renders a multi-file patch as one diff surface per file', () => {
		const container = renderPatch(
			[FILE_PATCH, NEW_FILE_PATCH, DELETED_FILE_PATCH, RENAME_PATCH].join('\n'),
		);

		expect(changedRows(container)).toEqual({ added: 4, removed: 4 });
		for (const path of [
			'src/app.ts',
			'src/new.ts',
			'src/old.ts',
			'src/after.ts',
		]) {
			expect(screen.getByText(path)).toBeInTheDocument();
		}
	});

	test('shows a pure rename header as text rather than dropping it', () => {
		renderPatch(PURE_RENAME_PATCH);

		expect(screen.getByText('rename from src/before.ts')).toBeInTheDocument();
		expect(screen.getByText('rename to src/after.ts')).toBeInTheDocument();
	});

	test('shows a binary change notice as text rather than dropping it', () => {
		renderPatch(BINARY_PATCH);

		expect(
			screen.getByText('Binary files /dev/null and b/logo.png differ'),
		).toBeInTheDocument();
	});
});
