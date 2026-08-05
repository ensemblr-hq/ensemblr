import { QueryClient } from '@tanstack/react-query';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/**
 * Stand-in app detection results. The real list comes from a main-process scan
 * the playground has no bridge for, so every scene that shows an "Open in…"
 * control seeds this into the query cache instead.
 */
export const PLAYGROUND_OPEN_TARGETS: WorkspaceOpenTarget[] = [
	{
		behavior: 'launch-app',
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode',
		installed: true,
		isPrimary: true,
		kind: 'editor',
		label: 'VS Code',
		numberShortcutLabel: '1',
		shortcutLabel: '⌘⇧E',
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
	{
		behavior: 'copy-path',
		iconName: 'lucide:copy',
		id: 'copy-path',
		installed: true,
		kind: 'utility',
		label: 'Copy path',
		numberShortcutLabel: '4',
	},
];

/**
 * Query client for a scene that drives shipped components without the Electron
 * preload bridge behind them. Retries are off and data never goes stale, so a
 * scene paints its seeded content on first render and keeps it rather than
 * flashing an error state when the real IPC call is unavailable.
 * @returns A query client with the stand-in app list already cached.
 */
export function createPlaygroundQueryClient(): QueryClient {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
		targets: PLAYGROUND_OPEN_TARGETS,
	});
	return client;
}
