// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import {
	getDefaultProject,
	getDefaultWorkspace,
} from '@/renderer/fixtures/workbench';
import { useLiveWorkspaceModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-workspace-model';
import { getWorkspaceFileIconName } from '@/renderer/lib/workbench/file-icons';
import type { WorkspaceFileEntryWire } from '@/shared/ipc/contracts/workspace-files';

const listing = vi.hoisted(() => ({ files: [] as WorkspaceFileEntryWire[] }));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-query')>()),
	useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
		data: queryKey.includes('workspace-files')
			? { files: listing.files }
			: undefined,
	}),
}));
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-ensure-workspace-setup',
	() => ({
		useEnsureWorkspaceSetup: () => undefined,
	}),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-workspace-files-watch',
	() => ({
		useWorkspaceFilesWatch: () => undefined,
	}),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-pull-request-auto-refresh',
	() => ({
		usePullRequestAutoRefresh: () => undefined,
	}),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model',
	() => ({
		useLivePullRequestModel: () => null,
	}),
);

test('updates the live icon when an unchanged path becomes a link or changes target kind', () => {
	const entry: WorkspaceFileEntryWire = {
		kind: 'file',
		name: 'linked',
		path: 'linked',
	};
	listing.files = [entry];
	const options = {
		activeProject: getDefaultProject(),
		activeWorkspace: getDefaultWorkspace(),
		terminalSessions: {
			activeTerminalIds: new Set<string>(),
			closeTerminal: async () => undefined,
			createTerminal: async () => ({ diagnostics: [], session: null }),
			sessions: [],
		},
	};
	const { result, rerender } = renderHook(() => useLiveWorkspaceModel(options));
	const original = result.current.liveWorkspaceFiles;

	listing.files = [{ ...entry }];
	rerender();
	expect(result.current.liveWorkspaceFiles).toBe(original);

	for (const [symlinkTargetKind, icon] of [
		['directory', 'ensemblr:folder-symlink'],
		['file', 'ensemblr:file-symlink'],
		['unknown', 'ensemblr:file-symlink'],
	] as const) {
		listing.files = [{ ...entry, symlinkTargetKind }];
		rerender();
		expect(getWorkspaceFileIconName(result.current.liveWorkspaceFiles[0])).toBe(
			icon,
		);
	}

	listing.files = [entry];
	rerender();
	expect(getWorkspaceFileIconName(result.current.liveWorkspaceFiles[0])).toBe(
		'vscode-icons:default-file',
	);
});
