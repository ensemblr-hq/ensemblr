import { Outlet } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { CloseActionProvider } from '@/renderer/state/close-action';
import {
	toolCallCollapseAtom,
	useAppSettingsSync,
	useThemeEffect,
} from '@/renderer/state/preferences';

/** Root app component — delegates rendering to the active TanStack Router outlet. */
export function App() {
	useThemeEffect();
	useAppSettingsSync();

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
