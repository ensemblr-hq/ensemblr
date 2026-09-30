// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';

import { useDiscardChanges } from '../../src/renderer/hooks/workbench-shell/review-files/use-discard-changes';
import type {
	ReviewFileSummary,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import { createTestQueryClient } from './support/dom';

const workspace = {
	pathLabel: '/tmp/ws',
	reviewFiles: [],
} as unknown as WorkspaceShellModel;

/** A changed-file row; the discard hook only reads its path and rename source. */
function changedFile(path: string): ReviewFileSummary {
	return {
		additions: 1,
		contentId: null,
		deletions: 0,
		id: `git:${path}`,
		path,
		status: 'modified',
	};
}

test('the per-file discard handler survives a refreshed change set', () => {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { rerender, result } = renderHook(
		({ sourceFiles }) => useDiscardChanges({ sourceFiles, workspace }),
		{ initialProps: { sourceFiles: [changedFile('a.ts')] }, wrapper },
	);
	const handler = result.current.handleDiscardFile;

	rerender({ sourceFiles: [changedFile('a.ts')] });

	expect(result.current.handleDiscardFile).toBe(handler);
});

test('a discard still reverts both sides of a rename after the set refreshed', () => {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const renamed: ReviewFileSummary = {
		...changedFile('new.ts'),
		renamedFrom: 'old.ts',
		status: 'renamed',
	};
	const { rerender, result } = renderHook(
		({ sourceFiles }) => useDiscardChanges({ sourceFiles, workspace }),
		{ initialProps: { sourceFiles: [changedFile('a.ts')] }, wrapper },
	);

	rerender({ sourceFiles: [renamed] });
	act(() => result.current.handleDiscardFile('new.ts'));

	expect(result.current.discardTarget?.paths).toEqual(['new.ts', 'old.ts']);
});
