import { Outlet } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';

import { useConfigReloadSync } from '@/renderer/hooks/use-config-reload-sync';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { CloseActionProvider } from '@/renderer/state/close-action';
import {
	toolCallCollapseAtom,
	useAppearanceEffect,
	useAppSettingsSync,
	useThemeEffect,
} from '@/renderer/state/preferences';

/** Root app component — delegates rendering to the active TanStack Router outlet. */
export function App() {
	useThemeEffect();
	useAppearanceEffect();
	useAppSettingsSync();
	useConfigReloadSync();

	// App-wide toggle for the tool-call expand/collapse default (⌃O / Ctrl+O).
	const setToolCallCollapse = useSetAtom(toolCallCollapseAtom);
	const toggleToolCallCollapse = useCallback(() => {
		setToolCallCollapse((prev) =>
			prev === 'expanded' ? 'collapsed' : 'expanded',
		);
	}, [setToolCallCollapse]);
	useHotkey('toolCalls.toggleCollapse', toggleToolCallCollapse);

	return (
		<CloseActionProvider>
			<Outlet />
		</CloseActionProvider>
	);
}
