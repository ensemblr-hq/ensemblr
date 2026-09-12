// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useSettingsWorkspaceTarget } from '@/renderer/hooks/use-settings-workspace-target';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

const useLoaderDataMock = vi.hoisted(() => vi.fn());

vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model',
	() => ({
		workbenchRouteApi: { useLoaderData: useLoaderDataMock },
	}),
);

const workspaceA = { id: 'ws-a', name: 'A' } as unknown as WorkspaceShellModel;
const workspaceB = { id: 'ws-b', name: 'B' } as unknown as WorkspaceShellModel;

/** Renders the hook against one repository's projects, seeding jotai's last-selection atom. */
function renderTarget(
	repoId: string,
	workspaces: WorkspaceShellModel[],
	lastSelection: { projectId: string; workspaceId: string } | null = null,
) {
	useLoaderDataMock.mockReturnValue({
		projects: [{ id: repoId, workspaces }],
	});
	const store = createStore();
	store.set(lastWorkspaceSelectionAtom, lastSelection);
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);
	return renderHook(() => useSettingsWorkspaceTarget(repoId), { wrapper });
}

describe('useSettingsWorkspaceTarget', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('uses the remembered workspace when it matches the repo and is still live', () => {
		const { result } = renderTarget('repo-1', [workspaceA, workspaceB], {
			projectId: 'repo-1',
			workspaceId: 'ws-b',
		});

		expect(result.current.selectedWorkspaceId).toBe('ws-b');
	});

	test('falls back to the first workspace when there is no last selection', () => {
		const { result } = renderTarget('repo-1', [workspaceA, workspaceB], null);

		expect(result.current.selectedWorkspaceId).toBe('ws-a');
	});

	test('falls back to the first workspace when the last selection names a different repo', () => {
		const { result } = renderTarget('repo-1', [workspaceA, workspaceB], {
			projectId: 'repo-2',
			workspaceId: 'ws-b',
		});

		expect(result.current.selectedWorkspaceId).toBe('ws-a');
	});

	test('falls back to the first workspace when the remembered workspace is no longer present', () => {
		const { result } = renderTarget('repo-1', [workspaceA, workspaceB], {
			projectId: 'repo-1',
			workspaceId: 'ws-gone',
		});

		expect(result.current.selectedWorkspaceId).toBe('ws-a');
	});

	test('is undefined when the repository has no workspaces', () => {
		const { result } = renderTarget('repo-1', []);

		expect(result.current.selectedWorkspaceId).toBeUndefined();
	});

	test('selectWorkspace switches the selection', () => {
		const { result } = renderTarget('repo-1', [workspaceA, workspaceB]);

		act(() => {
			result.current.selectWorkspace('ws-b');
		});

		expect(result.current.selectedWorkspaceId).toBe('ws-b');
	});

	test('falls back to the seed when the picked workspace disappears from the list', () => {
		useLoaderDataMock.mockReturnValue({
			projects: [{ id: 'repo-1', workspaces: [workspaceA, workspaceB] }],
		});
		const store = createStore();
		store.set(lastWorkspaceSelectionAtom, null);
		const wrapper = ({ children }: PropsWithChildren) => (
			<Provider store={store}>{children}</Provider>
		);
		const { rerender, result } = renderHook(
			() => useSettingsWorkspaceTarget('repo-1'),
			{ wrapper },
		);

		act(() => {
			result.current.selectWorkspace('ws-b');
		});
		expect(result.current.selectedWorkspaceId).toBe('ws-b');

		useLoaderDataMock.mockReturnValue({
			projects: [{ id: 'repo-1', workspaces: [workspaceA] }],
		});
		rerender();

		expect(result.current.selectedWorkspaceId).toBe('ws-a');
	});
});
