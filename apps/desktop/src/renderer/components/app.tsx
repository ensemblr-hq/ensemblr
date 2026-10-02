import { Outlet } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useCallback } from 'react';

import { useAppMenuCommands } from '@/renderer/hooks/use-app-menu-commands';
import { useAppRootSyncs } from '@/renderer/hooks/use-app-root-syncs';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import {
	useMenuCommand,
	useMenuCommandBridge,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import { toolCallCollapseAtom } from '@/renderer/state/preferences';

/** Root app component — delegates rendering to the active TanStack Router outlet. */
export function App() {
	useAppRootSyncs();
	useMenuCommandBridge();
	useAppMenuCommands();

	// App-wide toggle for the tool-call expand/collapse default (⌃O / Ctrl+O).
	const [toolCallCollapse, setToolCallCollapse] = useAtom(toolCallCollapseAtom);
	const toggleToolCallCollapse = useCallback(() => {
		setToolCallCollapse((prev) =>
			prev === 'expanded' ? 'collapsed' : 'expanded',
		);
	}, [setToolCallCollapse]);
	useHotkey('toolCalls.toggleCollapse', toggleToolCallCollapse);
	useMenuCommand('toolCalls.toggleCollapse', toggleToolCallCollapse);
	useMenuCommandChecked(
		'toolCalls.toggleCollapse',
		toolCallCollapse === 'collapsed',
	);

	return <Outlet />;
}
