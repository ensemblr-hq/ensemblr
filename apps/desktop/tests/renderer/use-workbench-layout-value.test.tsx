// @vitest-environment happy-dom

/**
 * The layout context value was an object literal in the shell's render, and the
 * two panel controllers hand back fresh closures every render — so every consumer
 * of the context re-rendered whenever the shell did, past any `memo` boundary. The
 * value now keeps its identity until something layout-related moves, while its
 * actions still reach the controllers' latest closures.
 */

import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { useWorkbenchLayoutValue } from '../../src/renderer/hooks/workbench-shell/use-workbench-layout-value';

type LayoutInput = Parameters<typeof useWorkbenchLayoutValue>[0];

const DOCK_PANEL_REF = { current: null };
const RIGHT_SIDEBAR_PANEL_REF = { current: null };

/** Builds the two controllers the way their hooks do: fresh closures around the same state. */
function controllers(
	overrides: {
		collapseRightSidebar?: () => void;
		isDockCollapsed?: boolean;
		toggleDockPanel?: () => void;
	} = {},
): LayoutInput {
	return {
		dock: {
			dockPanelRef: DOCK_PANEL_REF,
			expandDockPanel: () => undefined,
			handleDockResize: () => undefined,
			isDockCollapsed: overrides.isDockCollapsed ?? false,
			toggleDockPanel: overrides.toggleDockPanel ?? (() => undefined),
		},
		rightSidebar: {
			collapseRightSidebar: overrides.collapseRightSidebar ?? (() => undefined),
			expandRightSidebar: () => undefined,
			handleRightSidebarResize: () => undefined,
			initialRightSidebarSize: '34%',
			isNarrowViewport: false,
			isRightSidebarCollapsed: false,
			isRightSidebarSheetOpen: false,
			rightSidebarPanelRef: RIGHT_SIDEBAR_PANEL_REF,
			setRightSidebarSheetOpen: () => undefined,
		},
	};
}

test('keeps its identity across renders that only bring fresh controller closures', () => {
	const { result, rerender } = renderHook(
		(input: LayoutInput) => useWorkbenchLayoutValue(input),
		{ initialProps: controllers() },
	);
	const first = result.current;

	rerender(controllers());
	rerender(controllers());

	expect(result.current).toBe(first);
	expect(result.current.actions).toBe(first.actions);
});

test('changes identity when layout state moves', () => {
	const { result, rerender } = renderHook(
		(input: LayoutInput) => useWorkbenchLayoutValue(input),
		{ initialProps: controllers() },
	);
	const first = result.current;

	rerender(controllers({ isDockCollapsed: true }));

	expect(result.current).not.toBe(first);
	expect(result.current.state.isDockCollapsed).toBe(true);
	expect(result.current.actions).toBe(first.actions);
});

test('routes actions to the controllers latest closures', () => {
	const staleCollapse = vi.fn();
	const freshCollapse = vi.fn();
	const staleToggle = vi.fn();
	const freshToggle = vi.fn();
	const { result, rerender } = renderHook(
		(input: LayoutInput) => useWorkbenchLayoutValue(input),
		{
			initialProps: controllers({
				collapseRightSidebar: staleCollapse,
				toggleDockPanel: staleToggle,
			}),
		},
	);

	rerender(
		controllers({
			collapseRightSidebar: freshCollapse,
			toggleDockPanel: freshToggle,
		}),
	);
	result.current.actions.collapseRightSidebar();
	result.current.actions.toggleDockPanel();

	expect(staleCollapse).not.toHaveBeenCalled();
	expect(staleToggle).not.toHaveBeenCalled();
	expect(freshCollapse).toHaveBeenCalledTimes(1);
	expect(freshToggle).toHaveBeenCalledTimes(1);
});

test('exposes the panel refs and the initial sidebar size', () => {
	const { result } = renderHook(() => useWorkbenchLayoutValue(controllers()));

	expect(result.current.meta.dockPanelRef).toBe(DOCK_PANEL_REF);
	expect(result.current.meta.rightSidebarPanelRef).toBe(
		RIGHT_SIDEBAR_PANEL_REF,
	);
	expect(result.current.state.initialRightSidebarSize).toBe('34%');
});
