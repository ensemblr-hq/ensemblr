// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { useEffect } from 'react';
import { expect, test, vi } from 'vitest';

import { DockPanel } from '@/renderer/components/workbench-shell/dock-panel/dock-panel';
import { WorkbenchLayoutProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import { useExpandDockPanel } from '@/renderer/state/workspace/terminal-requests';
import type { WorkbenchLayoutContextValue } from '@/renderer/types/contexts';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

import { renderWithProviders } from './support/dom';

/** Publishes the reveal dispatcher so the test can fire it from outside React. */
function RevealProbe({
	onReady,
}: {
	onReady: (reveal: (workspaceId: string) => void) => void;
}) {
	const reveal = useExpandDockPanel();
	useEffect(() => {
		onReady(reveal);
	}, [onReady, reveal]);
	return null;
}

/**
 * Mounts the real dock over a stubbed layout context and returns the layout
 * action spies plus the reveal the focus surfaces call.
 */
function renderDock() {
	const expandDockPanel = vi.fn();
	const expandRightSidebar = vi.fn();
	const layout = {
		state: { isDockCollapsed: true },
		actions: { expandDockPanel, expandRightSidebar, toggleDockPanel: vi.fn() },
		meta: {},
	} as unknown as WorkbenchLayoutContextValue;
	const workspace = {
		configuredPreviewUrls: [],
		dockTabs: [],
		id: 'ws-1',
		name: 'monterrey',
		runScripts: [],
		scripts: { run: { status: 'not-run' }, setup: { status: 'missing' } },
	} as unknown as WorkspaceShellModel;

	let reveal: (workspaceId: string) => void = () => undefined;

	renderWithProviders(
		<WorkbenchLayoutProvider value={layout}>
			<DockPanel
				actions={{} as unknown as WorkbenchDockActions}
				activeTab='setup'
				onTabChange={() => undefined}
				workspace={workspace}
			/>
			<RevealProbe
				onReady={(next) => {
					reveal = next;
				}}
			/>
		</WorkbenchLayoutProvider>,
	);

	return { expandDockPanel, expandRightSidebar, reveal: () => reveal('ws-1') };
}

// The dock sits inside the right sidebar, which collapses to zero width of its
// own — expanding only the inner panel reveals nothing to the user.
test('revealing the dock opens the right sidebar as well as the dock panel', () => {
	const { expandDockPanel, expandRightSidebar, reveal } = renderDock();

	act(reveal);

	expect(expandDockPanel).toHaveBeenCalledTimes(1);
	expect(expandRightSidebar).toHaveBeenCalledTimes(1);
});
