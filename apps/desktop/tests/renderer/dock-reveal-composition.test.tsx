// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { expect, test, vi } from 'vitest';

import { DockPanel } from '@/renderer/components/workbench-shell/dock-panel/dock-panel';
import { WorkbenchLayoutProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import {
	useExpandDockPanel,
	useProvideDockExpander,
} from '@/renderer/state/workspace/terminal-requests';
import type { WorkbenchLayoutContextValue } from '@/renderer/types/contexts';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

import { renderWithProviders } from './support/dom';

const WORKSPACE_ID = 'ws-1';

const LAYOUT = {
	state: { isDockCollapsed: true },
	actions: { toggleDockPanel: () => undefined },
	meta: {},
} as unknown as WorkbenchLayoutContextValue;

const WORKSPACE = {
	configuredPreviewUrls: [],
	dockTabs: [],
	id: WORKSPACE_ID,
	name: 'monterrey',
	runScripts: [],
	scripts: { run: { status: 'not-run' }, setup: { status: 'missing' } },
} as unknown as WorkspaceShellModel;

/** The real dock, with the props it needs to render an empty tab set. */
function Dock() {
	return (
		<DockPanel
			actions={{} as unknown as WorkbenchDockActions}
			activeTab='setup'
			onTabChange={() => undefined}
			workspace={WORKSPACE}
		/>
	);
}

/**
 * Mirrors how the workspace shell wires the reveal: registered from a host above
 * the dock that stays mounted, with the dock beside it under a switch the test
 * can flip to stand in for a dismissed narrow-window rail sheet.
 */
function renderShell() {
	const expandDockPanel = vi.fn();
	const expandRightSidebar = vi.fn();
	let dispatchReveal: () => void = () => undefined;
	let hideDock: () => void = () => undefined;

	function Host() {
		const [isDockMounted, setIsDockMounted] = useState(true);
		const expandDockPanelFor = useExpandDockPanel();
		const reveal = useCallback(() => {
			expandDockPanel();
			expandRightSidebar();
		}, []);

		useProvideDockExpander(WORKSPACE_ID, reveal);
		useEffect(() => {
			dispatchReveal = () => expandDockPanelFor(WORKSPACE_ID);
			hideDock = () => setIsDockMounted(false);
		});

		return isDockMounted ? <Dock /> : null;
	}

	renderWithProviders(
		<WorkbenchLayoutProvider value={LAYOUT}>
			<Host />
		</WorkbenchLayoutProvider>,
	);

	return {
		expandDockPanel,
		expandRightSidebar,
		hideDock: () => act(() => hideDock()),
		reveal: () => act(() => dispatchReveal()),
	};
}

// The dock sits inside the review rail, which collapses to zero width of its own
// — expanding only the inner panel reveals nothing to the user.
test('revealing the dock opens the right sidebar as well as the dock panel', () => {
	const { expandDockPanel, expandRightSidebar, reveal } = renderShell();

	reveal();

	expect(expandDockPanel).toHaveBeenCalledTimes(1);
	expect(expandRightSidebar).toHaveBeenCalledTimes(1);
});

// Below the rail's breakpoint the dock is hosted by a sheet that unmounts when
// dismissed, so a registration owned by the dock would leave an agent focusing a
// terminal with nothing to reveal.
test('the reveal survives the dock unmounting', () => {
	const { expandDockPanel, expandRightSidebar, hideDock, reveal } =
		renderShell();

	hideDock();
	reveal();

	expect(expandDockPanel).toHaveBeenCalledTimes(1);
	expect(expandRightSidebar).toHaveBeenCalledTimes(1);
});

test('the dock panel does not register the reveal itself', () => {
	const expandDockPanel = vi.fn();
	const expandRightSidebar = vi.fn();
	const layout = {
		state: { isDockCollapsed: true },
		actions: {
			expandDockPanel,
			expandRightSidebar,
			toggleDockPanel: () => undefined,
		},
		meta: {},
	} as unknown as WorkbenchLayoutContextValue;
	let dispatchReveal: () => void = () => undefined;

	function Probe() {
		const expandDockPanelFor = useExpandDockPanel();

		useEffect(() => {
			dispatchReveal = () => expandDockPanelFor(WORKSPACE_ID);
		});

		return null;
	}

	renderWithProviders(
		<WorkbenchLayoutProvider value={layout}>
			<Dock />
			<Probe />
		</WorkbenchLayoutProvider>,
	);
	act(() => dispatchReveal());

	expect(expandDockPanel).not.toHaveBeenCalled();
	expect(expandRightSidebar).not.toHaveBeenCalled();
});
