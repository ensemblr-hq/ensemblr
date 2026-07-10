// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

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
		listener?.({ workspaceCwd: '/tmp/workspace' });
	});

	expect(invalidateQueries).toHaveBeenCalledWith({
		queryKey: ensemblrQueryKeys.workspaceFiles('/tmp/workspace'),
	});
	expect(invalidateQueries).toHaveBeenCalledWith({
		queryKey: ensemblrQueryKeys.settingsResolution('repo-1', '/tmp/workspace'),
	});
});
