// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { Provider } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceSelectionPersistence } from '@/renderer/hooks/workbench-shell/route-layout/use-workspace-selection-persistence';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import { installLocalStorage } from './support/dom';

const PROJECT_ID = 'repo-1';
const WORKSPACE_ID = 'ws-a';

/**
 * Builds a project list with the same content but a brand-new identity, which is
 * what a refetch fan-out hands the shell on every render.
 */
function freshProjects(): ProjectShellModel[] {
	return [
		{
			id: PROJECT_ID,
			name: PROJECT_ID,
			workspaces: [{ id: WORKSPACE_ID, name: WORKSPACE_ID }],
		},
	] as unknown as ProjectShellModel[];
}

const routeState = {
	routeProjectId: PROJECT_ID,
	routeWorkspaceId: WORKSPACE_ID,
} as unknown as WorkbenchShellRouteState;

describe('useWorkspaceSelectionPersistence render-state writes', () => {
	beforeEach(() => {
		installLocalStorage();
	});

	// The hook writes an atom that feeds the memo that feeds the same effect. A
	// write on every render therefore closes a render -> atom -> render cycle,
	// which live-locks the renderer: no paint, no hover, no Escape, while the
	// main process stays responsive. Removing the active workspace is what makes
	// `projects` churn, which is why delete and archive were the trigger.
	it('settles when projects arrive as a new array on every render', () => {
		let renders = 0;

		const { rerender } = renderHook(
			() => {
				renders += 1;
				return useWorkspaceSelectionPersistence({
					hasPreloadBridge: true,
					isRepositoryWorkspaceNavigationFetching: false,
					isRepositoryWorkspaceNavigationLoading: false,
					isRepositoryWorkspaceNavigationPlaceholderData: false,
					navigationSnapshot: null,
					projects: freshProjects(),
					routeState,
				});
			},
			{ wrapper: ({ children }) => <Provider>{children}</Provider> },
		);

		const afterMount = renders;
		rerender();
		rerender();

		expect(renders - afterMount).toBeLessThanOrEqual(4);
	});

	it('keeps holding the selection it already recorded', () => {
		const { rerender, result } = renderHook(
			() =>
				useWorkspaceSelectionPersistence({
					hasPreloadBridge: true,
					isRepositoryWorkspaceNavigationFetching: false,
					isRepositoryWorkspaceNavigationLoading: false,
					isRepositoryWorkspaceNavigationPlaceholderData: false,
					navigationSnapshot: null,
					projects: freshProjects(),
					routeState,
				}),
			{ wrapper: ({ children }) => <Provider>{children}</Provider> },
		);

		rerender();

		expect(result.current.currentSelection?.workspace.id).toBe(WORKSPACE_ID);
	});
});
