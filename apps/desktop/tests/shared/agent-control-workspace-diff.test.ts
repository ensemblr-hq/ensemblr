import { describe, expect, it } from 'vitest';

import {
	budgetWorkspaceDiff,
	clampFilePatch,
	MAX_AGENT_PAYLOAD_CHARS,
} from '../../src/shared/agent-control/workspace-diff.ts';

const hunkOf = (size: number) =>
	`\n@@ -1,1 +1,1 @@\n-${'a'.repeat(size)}\n+${'b'.repeat(size)}`;

const patchOf = (path: string, size: number) => ({
	path,
	patch: `diff --git a/${path} b/${path}\n${'x'.repeat(size)}`,
});

describe('budgetWorkspaceDiff', () => {
	it('passes an under-budget diff through untouched', () => {
		const patches = [
			{ path: 'a.ts', patch: 'diff a' },
			{ path: 'b.ts', patch: 'diff b' },
		];
		expect(budgetWorkspaceDiff({ patches })).toEqual({
			diff: 'diff a\ndiff b',
			omittedFiles: [],
			truncated: false,
		});
	});

	it('returns an empty diff for a workspace with no changes', () => {
		expect(budgetWorkspaceDiff({ patches: [] })).toEqual({
			diff: '',
			omittedFiles: [],
			truncated: false,
		});
	});

	// A patch severed mid-hunk is unparseable, so the cut has to land between
	// files: every emitted patch stays valid and the rest come back by name.
	it('cuts at a whole-file boundary and names what it dropped', () => {
		const result = budgetWorkspaceDiff({
			budget: 20,
			patches: [
				{ path: 'a.ts', patch: 'a'.repeat(10) },
				{ path: 'b.ts', patch: 'b'.repeat(30) },
				{ path: 'c.ts', patch: 'c' },
			],
		});
		expect(result.truncated).toBe(true);
		expect(result.omittedFiles).toEqual(['b.ts', 'c.ts']);
		expect(result.diff.startsWith('a'.repeat(10))).toBe(true);
		expect(result.diff).not.toContain('b'.repeat(30));
	});

	// Dropping a big file and then keeping a later small one would emit patches
	// in an order the omitted list no longer explains, so the tail goes whole.
	it('drops the whole tail once one file does not fit', () => {
		const result = budgetWorkspaceDiff({
			budget: 12,
			patches: [
				{ path: 'a.ts', patch: 'a'.repeat(10) },
				{ path: 'big.ts', patch: 'b'.repeat(100) },
				{ path: 'tiny.ts', patch: 't' },
			],
		});
		expect(result.omittedFiles).toEqual(['big.ts', 'tiny.ts']);
		expect(result.diff).not.toContain('t\n');
	});

	it('names the recovery call and the omitted count in the marker', () => {
		const result = budgetWorkspaceDiff({
			budget: 5,
			patches: [
				{ path: 'a.ts', patch: 'aa' },
				{ path: 'b.ts', patch: 'b'.repeat(50) },
			],
		});
		expect(result.diff).toContain('1 file(s) omitted');
		expect(result.diff).toContain(
			'ensemblr_get_workspace_diff({ file: "<path>" })',
		);
	});

	// A first file bigger than the whole budget leaves nothing to emit, so the
	// marker has to stand alone rather than shipping an empty string that reads
	// to a model as "this workspace has no changes".
	it('returns the marker alone when even the first file overflows', () => {
		const result = budgetWorkspaceDiff({
			budget: 5,
			patches: [{ path: 'huge.ts', patch: 'h'.repeat(500) }],
		});
		expect(result.truncated).toBe(true);
		expect(result.omittedFiles).toEqual(['huge.ts']);
		expect(result.diff).toBe(
			'… diff shortened. 1 file(s) omitted. Re-request each with ensemblr_get_workspace_diff({ file: "<path>" }).',
		);
	});

	// The caller stops issuing git calls once the budget is spent, so the files
	// it never read have to join the ones the budget itself dropped.
	it('folds never-read paths into the omitted list', () => {
		const result = budgetWorkspaceDiff({
			budget: 100,
			patches: [{ path: 'a.ts', patch: 'a'.repeat(10) }],
			unread: ['x.ts', 'y.ts'],
		});
		expect(result.truncated).toBe(true);
		expect(result.omittedFiles).toEqual(['x.ts', 'y.ts']);
		expect(result.diff).toContain('2 file(s) omitted');
	});

	it('defaults to the shared agent payload ceiling', () => {
		const result = budgetWorkspaceDiff({
			patches: [
				{ path: 'a.ts', patch: 'a'.repeat(MAX_AGENT_PAYLOAD_CHARS) },
				{ path: 'b.ts', patch: 'b' },
			],
		});
		expect(result.omittedFiles).toEqual(['b.ts']);
	});

	it('keeps a patch that lands exactly on the budget', () => {
		expect(
			budgetWorkspaceDiff({
				budget: 4,
				patches: [{ path: 'a.ts', patch: 'aaaa' }],
			}),
		).toEqual({ diff: 'aaaa', omittedFiles: [], truncated: false });
	});

	it('charges the separator against the budget', () => {
		const result = budgetWorkspaceDiff({
			budget: 4,
			patches: [
				{ path: 'a.ts', patch: 'aa' },
				{ path: 'b.ts', patch: 'bb' },
			],
		});
		expect(result.omittedFiles).toEqual(['b.ts']);
	});

	it('builds a patch fixture the concatenation keeps intact', () => {
		const result = budgetWorkspaceDiff({ patches: [patchOf('a.ts', 4)] });
		expect(result.diff).toBe('diff --git a/a.ts b/a.ts\nxxxx');
	});
});

describe('clampFilePatch', () => {
	it('passes an under-budget patch through untouched', () => {
		const patch = `diff --git a/a.ts b/a.ts${hunkOf(4)}`;
		expect(clampFilePatch({ patch, path: 'a.ts' })).toEqual({
			patch,
			truncated: false,
		});
	});

	it('cuts on a hunk boundary so what survives still parses', () => {
		const result = clampFilePatch({
			budget: 500,
			patch: `diff --git a/a.ts b/a.ts${hunkOf(120)}${hunkOf(120)}${hunkOf(120)}`,
			path: 'a.ts',
		});
		expect(result.truncated).toBe(true);
		expect(result.patch.length).toBeLessThanOrEqual(500);
		expect(result.patch.split('@@ -1,1 +1,1 @@').length - 1).toBe(1);
	});

	it('names the file, because no retry recovers what it cut', () => {
		const result = clampFilePatch({
			budget: 500,
			patch: `diff --git a/big.ts b/big.ts${hunkOf(400)}${hunkOf(400)}`,
			path: 'big.ts',
		});
		expect(result.patch).toContain('big.ts');
		expect(result.patch).toContain('patch shortened at a hunk boundary');
		expect(result.patch).not.toContain('Re-request');
	});

	// Half a hunk is unparseable, so a first hunk that overruns on its own leaves
	// the header rather than a severed fragment of the hunk.
	it('keeps the file header alone when the first hunk overruns', () => {
		const result = clampFilePatch({
			budget: 500,
			patch: `diff --git a/a.ts b/a.ts${hunkOf(4_000)}`,
			path: 'a.ts',
		});
		expect(result.truncated).toBe(true);
		expect(result.patch.startsWith('diff --git a/a.ts b/a.ts')).toBe(true);
		expect(result.patch).not.toContain('@@');
	});

	it('defaults to the shared agent payload ceiling', () => {
		const result = clampFilePatch({
			patch: `diff --git a/a.ts b/a.ts${hunkOf(MAX_AGENT_PAYLOAD_CHARS)}`,
			path: 'a.ts',
		});
		expect(result.truncated).toBe(true);
		expect(result.patch.length).toBeLessThanOrEqual(MAX_AGENT_PAYLOAD_CHARS);
	});
});
