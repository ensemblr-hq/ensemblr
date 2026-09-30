// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import { useWorkspaceFilesWatch } from '../../src/renderer/hooks/workbench-shell/route-layout/use-workspace-files-watch';
import type { WorkspaceFilesChangedBroadcast } from '../../src/shared/ipc/contracts/workspace-files';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

test('invalidates files and workspace-scoped settings after a watched workspace changes', async () => {
	const client = createTestQueryClient();
	const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
	const unsubscribe = vi.fn();
	const watchWorkspaceFiles = vi.fn();
	const unwatchWorkspaceFiles = vi.fn();
	let listener: ((event: WorkspaceFilesChangedBroadcast) => void) | null = null;

	installEnsemblrApi({
		onWorkspaceFilesChanged: (
			nextListener: (event: WorkspaceFilesChangedBroadcast) => void,
		) => {
			listener = nextListener;
			return unsubscribe;
		},
		unwatchWorkspaceFiles,
		watchWorkspaceFiles,
	});

	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);

	renderHook(
		() =>
			useWorkspaceFilesWatch({
				repositoryId: 'repo-1',
				workspaceCwd: '/tmp/workspace',
			}),
		{ wrapper },
	);

	await waitFor(() => {
		expect(watchWorkspaceFiles).toHaveBeenCalledWith({
			workspaceCwd: '/tmp/workspace',
		});
	});

	act(() => {
		listener?.({
			membershipChanged: true,
			settingsChanged: true,
			workspaceCwd: '/tmp/workspace',
		});
	});

	expect(invalidateQueries).toHaveBeenCalledWith({
		queryKey: ensemblrQueryKeys.workspaceFiles('/tmp/workspace'),
	});
	expect(invalidateQueries).toHaveBeenCalledWith({
		queryKey: ensemblrQueryKeys.settingsResolution('repo-1', '/tmp/workspace'),
	});
});

const WORKSPACE_CWD = '/tmp/workspace';

/**
 * Counts how many times the expanded-directory prefix was invalidated, which is
 * the fan-out the throttle exists to bound.
 */
function directoryRefreshCount(calls: unknown[][]): number {
	const wanted = JSON.stringify(
		ensemblrQueryKeys.workspaceDirectories(WORKSPACE_CWD),
	);
	return calls.filter(
		([argument]) =>
			JSON.stringify(
				(argument as { queryKey?: unknown } | undefined)?.queryKey,
			) === wanted,
	).length;
}

test('throttles the expanded-directory refresh a burst of broadcasts would fan out', () => {
	vi.useFakeTimers();
	try {
		const client = createTestQueryClient();
		const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
		let listener: ((event: WorkspaceFilesChangedBroadcast) => void) | null =
			null;

		installEnsemblrApi({
			onWorkspaceFilesChanged: (
				nextListener: (event: WorkspaceFilesChangedBroadcast) => void,
			) => {
				listener = nextListener;
				return vi.fn();
			},
			unwatchWorkspaceFiles: vi.fn(),
			watchWorkspaceFiles: vi.fn(),
		});

		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);

		renderHook(
			() =>
				useWorkspaceFilesWatch({
					repositoryId: null,
					workspaceCwd: WORKSPACE_CWD,
				}),
			{ wrapper },
		);

		act(() => {
			for (let index = 0; index < 5; index += 1) {
				listener?.({
					membershipChanged: true,
					settingsChanged: false,
					workspaceCwd: WORKSPACE_CWD,
				});
			}
		});

		// The file list refreshes once per broadcast because it is one query; the
		// per-folder fan-out behind it is what must not.
		expect(
			invalidateQueries.mock.calls.filter(
				([argument]) =>
					JSON.stringify(argument?.queryKey) ===
					JSON.stringify(ensemblrQueryKeys.workspaceFiles(WORKSPACE_CWD)),
			),
		).toHaveLength(5);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(directoryRefreshCount(invalidateQueries.mock.calls)).toBe(1);

		act(() => {
			listener?.({
				membershipChanged: true,
				settingsChanged: false,
				workspaceCwd: WORKSPACE_CWD,
			});
			vi.advanceTimersByTime(1);
		});
		expect(directoryRefreshCount(invalidateQueries.mock.calls)).toBe(1);

		// Deferred, not dropped: the tail of a burst still lands, one window later.
		act(() => {
			vi.advanceTimersByTime(5_000);
		});
		expect(directoryRefreshCount(invalidateQueries.mock.calls)).toBe(2);
	} finally {
		vi.useRealTimers();
	}
});

/**
 * Mounts the hook against a stub bridge. `broadcast` delivers one event and lets
 * every timer the hook armed run out; `invalidatedKeys` reads back, as strings
 * comparable to `ensemblrQueryKeys` output, what the hook invalidated.
 */
function mountWatchWithBroadcast(): {
	broadcast: (
		flags: Omit<WorkspaceFilesChangedBroadcast, 'workspaceCwd'>,
	) => void;
	invalidatedKeys: () => string[];
} {
	const client = createTestQueryClient();
	const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
	let listener: ((event: WorkspaceFilesChangedBroadcast) => void) | null = null;

	installEnsemblrApi({
		onWorkspaceFilesChanged: (
			nextListener: (event: WorkspaceFilesChangedBroadcast) => void,
		) => {
			listener = nextListener;
			return vi.fn();
		},
		unwatchWorkspaceFiles: vi.fn(),
		watchWorkspaceFiles: vi.fn(),
	});

	renderHook(
		() =>
			useWorkspaceFilesWatch({
				repositoryId: 'repo-1',
				workspaceCwd: WORKSPACE_CWD,
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		},
	);

	return {
		broadcast: (flags) => {
			act(() => {
				listener?.({ ...flags, workspaceCwd: WORKSPACE_CWD });
				vi.advanceTimersByTime(10_000);
			});
		},
		invalidatedKeys: () =>
			invalidateQueries.mock.calls.map(([argument]) =>
				JSON.stringify(argument?.queryKey),
			),
	};
}

const FILE_LIST_KEY = JSON.stringify(
	ensemblrQueryKeys.workspaceFiles(WORKSPACE_CWD),
);
const DIRECTORIES_KEY = JSON.stringify(
	ensemblrQueryKeys.workspaceDirectories(WORKSPACE_CWD),
);
const SETTINGS_KEY = JSON.stringify(
	ensemblrQueryKeys.settingsResolution('repo-1', WORKSPACE_CWD),
);

describe('broadcast flags gate what the hook invalidates', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('a change that touched no entry and no settings input invalidates nothing', () => {
		const { broadcast, invalidatedKeys } = mountWatchWithBroadcast();

		broadcast({ membershipChanged: false, settingsChanged: false });

		expect(invalidatedKeys()).toEqual([]);
	});

	test('a membership change refreshes the file list and expanded directories, not settings', () => {
		const { broadcast, invalidatedKeys } = mountWatchWithBroadcast();

		broadcast({ membershipChanged: true, settingsChanged: false });

		expect(invalidatedKeys()).toEqual([FILE_LIST_KEY, DIRECTORIES_KEY]);
	});

	test('a settings change refreshes settings, not the file list or directories', () => {
		const { broadcast, invalidatedKeys } = mountWatchWithBroadcast();

		broadcast({ membershipChanged: false, settingsChanged: true });

		expect(invalidatedKeys()).toEqual([SETTINGS_KEY]);
	});

	test('a change that touched both refreshes all three', () => {
		const { broadcast, invalidatedKeys } = mountWatchWithBroadcast();

		broadcast({ membershipChanged: true, settingsChanged: true });

		expect(invalidatedKeys().sort()).toEqual(
			[FILE_LIST_KEY, DIRECTORIES_KEY, SETTINGS_KEY].sort(),
		);
	});
});
