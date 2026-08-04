import { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/** Stand-in app detection results so the viewer toolbars can show their "Open in" menu. */
const OPEN_TARGETS: WorkspaceOpenTarget[] = [
	{
		behavior: 'launch-app',
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode',
		installed: true,
		isPrimary: true,
		kind: 'editor',
		label: 'VS Code',
		numberShortcutLabel: '1',
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
		behavior: 'copy-path',
		iconName: 'lucide:copy',
		id: 'copy-path',
		installed: true,
		kind: 'utility',
		label: 'Copy path',
		numberShortcutLabel: '3',
	},
];

/**
 * Query client holding one workspace file's read result plus a stand-in list of
 * detected apps, so a scene can drive the shipped file and diff panels — toolbar
 * included — without the Electron preload bridge behind them.
 *
 * Retries are off and the data never goes stale: a scene should paint the seeded
 * content on its first render and keep it, rather than flashing an error state
 * when the real IPC call it would otherwise make is unavailable.
 * @param workspaceCwd - Workspace the file is read from
 * @param filePath - Repo-relative path the panel is pointed at
 * @param content - File body the seeded read returns
 * @returns A query client with that file's preview already cached
 */
export function useSeededFileClient(
	workspaceCwd: string,
	filePath: string,
	content: string,
): QueryClient {
	const [client] = useState(() => {
		const seeded = new QueryClient({
			defaultOptions: {
				queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			},
		});
		seeded.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, filePath), {
			content,
			contentEncoding: 'utf8',
			path: filePath,
			sizeBytes: content.length,
		});
		seeded.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
			targets: OPEN_TARGETS,
		});
		return seeded;
	});
	return client;
}
