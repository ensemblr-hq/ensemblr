// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useWorkspaceSourceSelection } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-selection';
import type { ProjectShellModel } from '@/renderer/types/workbench';

const ensemblr = { id: 'repo-1' } as unknown as ProjectShellModel;
const website = { id: 'repo-2' } as unknown as ProjectShellModel;
const projects = [ensemblr, website];

/**
 * Renders the selection hook behind props the test can change between renders.
 * @param initial - The dialog's open state and launching repository on mount
 * @returns The renderHook result
 */
function renderSelection(initial: {
	open: boolean;
	project: ProjectShellModel | null;
}) {
	return renderHook(
		(props: { open: boolean; project: ProjectShellModel | null }) =>
			useWorkspaceSourceSelection({ ...props, projects }),
		{ initialProps: initial },
	);
}

test('starts on the launching repository and the pull requests tab', () => {
	const { result } = renderSelection({ open: true, project: website });

	expect(result.current.repoId).toBe(website.id);
	expect(result.current.selectedRepo).toBe(website);
	expect(result.current.kind).toBe('pull-request');
	expect(result.current.search).toBe('');
});

test('falls back to the first repository without a launching one', () => {
	const { result } = renderSelection({ open: false, project: null });

	expect(result.current.repoId).toBe(ensemblr.id);
	expect(result.current.selectedRepo).toBe(ensemblr);
});

test('a reopen from a repository moves onto it and resets the tab and search', () => {
	const { rerender, result } = renderSelection({
		open: true,
		project: ensemblr,
	});
	act(() => {
		result.current.setKind('issue');
		result.current.setSearch('sidebar');
	});

	rerender({ open: false, project: ensemblr });
	rerender({ open: true, project: website });

	expect(result.current.repoId).toBe(website.id);
	expect(result.current.kind).toBe('pull-request');
	expect(result.current.search).toBe('');
});

test('a reopen without a repository keeps the last repository and tab', () => {
	const { rerender, result } = renderSelection({
		open: true,
		project: null,
	});
	act(() => {
		result.current.setRepoId(website.id);
		result.current.setKind('branch');
		result.current.setSearch('main');
	});

	rerender({ open: false, project: null });
	rerender({ open: true, project: null });

	expect(result.current.repoId).toBe(website.id);
	expect(result.current.kind).toBe('branch');
	expect(result.current.search).toBe('');
});

test('closing keeps the search until the next open', () => {
	const { rerender, result } = renderSelection({
		open: true,
		project: ensemblr,
	});
	act(() => {
		result.current.setSearch('sidebar');
	});

	rerender({ open: false, project: ensemblr });

	expect(result.current.search).toBe('sidebar');
});
