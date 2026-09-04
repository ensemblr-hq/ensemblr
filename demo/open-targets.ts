import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/**
 * Stand-in app-detection results. The real list comes from a main-process scan
 * demo mode does not run, so the "Open in…" control renders from this instead.
 */
export const DEMO_OPEN_TARGETS: WorkspaceOpenTarget[] = [
	{
		behavior: 'launch-app',
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode',
		installed: true,
		isPrimary: true,
		kind: 'editor',
		label: 'VS Code',
		numberShortcutLabel: '1',
		shortcutChord: { key: 'E', modifiers: ['mod', 'shift'] },
	},
	{
		behavior: 'launch-app',
		iconName: 'lucide:square-terminal',
		id: 'terminal',
		installed: true,
		kind: 'terminal',
		label: 'Terminal',
		numberShortcutLabel: '2',
	},
	{
		behavior: 'reveal-in-finder',
		iconName: 'lucide:folder',
		id: 'finder',
		installed: true,
		kind: 'file-manager',
		label: 'Finder',
		numberShortcutLabel: '3',
	},
];
