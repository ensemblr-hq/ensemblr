// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import { useLazyIgnoredDirectories } from '../../src/renderer/hooks/workbench-shell/review-files/use-lazy-ignored-directories';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const IGNORED_ROOT: WorkspaceFileSummary = {
	id: 'wsfile:.context',
	isIgnored: true,
	kind: 'directory',
	name: '.context',
	path: '.context',
};

interface DirectoryEntry {
	isIgnored: boolean;
	kind: 'directory' | 'file';
	name: string;
	path: string;
}

function entry(path: string): DirectoryEntry {
	return {
		isIgnored: true,
		kind: 'file',
		name: path.split('/').pop() ?? path,
		path,
	};
}

function directoryEntry(path: string): DirectoryEntry {
	return { ...entry(path), kind: 'directory' };
}

afterEach(() => {
	clearEnsemblrApi();
});

/**
 * Renders the hook against a stub bridge that answers `readWorkspaceDirectory`
 * from a mutable script, so a test can change what the next fetch returns.
 */
function renderLazyDirectories(
	files: WorkspaceFileSummary[],
	entriesByCall: {
		current: DirectoryEntry[];
		byPath?: Record<string, DirectoryEntry[]>;
	},
) {
	const readWorkspaceDirectory = vi.fn(async ({ path }: { path: string }) => ({
		entries: entriesByCall.byPath?.[path] ?? entriesByCall.current,
		path,
	}));
	installEnsemblrApi({ readWorkspaceDirectory });
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const view = renderHook(
		({ current }: { current: WorkspaceFileSummary[] }) =>
			useLazyIgnoredDirectories({ files: current, workspaceCwd: '/repo' }),
		{ initialProps: { current: files }, wrapper },
	);
	return { client, readWorkspaceDirectory, ...view };
}

describe('useLazyIgnoredDirectories', () => {
	test('drops a child that disappeared from an opened directory on refetch', async () => {
		const entriesByCall = {
			current: [entry('.context/a.md'), entry('.context/b.md')],
		};
		const { client, result } = renderLazyDirectories(
			[IGNORED_ROOT],
			entriesByCall,
		);

		act(() => {
			result.current.loadIgnoredDirectory('.context');
		});
		await waitFor(() => {
			expect(result.current.allFiles.map((file) => file.path)).toContain(
				'.context/b.md',
			);
		});

		// The fs watcher invalidates this prefix; the second read no longer sees
		// the file, so the row has to go with it.
		entriesByCall.current = [entry('.context/a.md')];
		await client.invalidateQueries({
			queryKey: ensemblrQueryKeys.workspaceDirectories('/repo'),
		});

		await waitFor(() => {
			expect(result.current.allFiles.map((file) => file.path)).not.toContain(
				'.context/b.md',
			);
		});
		expect(result.current.allFiles.map((file) => file.path)).toContain(
			'.context/a.md',
		);
	});

	test('keeps a directory opened from inside another opened directory', async () => {
		const entriesByCall = {
			byPath: {
				node_modules: [directoryEntry('node_modules/react')],
				'node_modules/react': [entry('node_modules/react/index.js')],
			},
			current: [],
		};
		const nodeModules: WorkspaceFileSummary = {
			id: 'wsfile:node_modules',
			isIgnored: true,
			kind: 'directory',
			name: 'node_modules',
			path: 'node_modules',
		};
		const { rerender, result } = renderLazyDirectories(
			[nodeModules],
			entriesByCall,
		);

		act(() => {
			result.current.loadIgnoredDirectory('node_modules');
		});
		await waitFor(() => {
			expect(result.current.allFiles.map((file) => file.path)).toContain(
				'node_modules/react',
			);
		});

		// The nested folder exists only in its parent's children, never in the
		// base file list, so pruning must not treat it as gone.
		act(() => {
			result.current.loadIgnoredDirectory('node_modules/react');
		});
		await waitFor(() => {
			expect(result.current.allFiles.map((file) => file.path)).toContain(
				'node_modules/react/index.js',
			);
		});

		// A refetch hands back an equivalent list in a fresh array, which is what
		// re-runs the prune. Pruning against the base list alone would drop the
		// nested directory here, since it only ever exists in its parent's
		// children.
		rerender({ current: [nodeModules] });
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(result.current.allFiles.map((file) => file.path)).toContain(
			'node_modules/react/index.js',
		);
	});

	test('stops querying a directory that left the file list', async () => {
		const entriesByCall = { current: [entry('.context/a.md')] };
		const { readWorkspaceDirectory, rerender, result } = renderLazyDirectories(
			[IGNORED_ROOT],
			entriesByCall,
		);

		act(() => {
			result.current.loadIgnoredDirectory('.context');
		});
		await waitFor(() => {
			expect(readWorkspaceDirectory).toHaveBeenCalledTimes(1);
		});

		// The directory was deleted or moved away, so it is gone from the listing.
		rerender({ current: [] });

		await waitFor(() => {
			expect(result.current.allFiles).toEqual([]);
		});
		expect(readWorkspaceDirectory).toHaveBeenCalledTimes(1);
	});
});
