// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useChangesSource } from '@/renderer/hooks/workbench-shell/review-files/use-changes-source';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const FROM_REF = 'a'.repeat(40);
const OLDER_REF = 'c'.repeat(40);

/** Minimal workspace model: the hook reads only these fields. */
function workspace(): WorkspaceShellModel {
	return {
		changeSummary: { additions: 0, deletions: 0, files: 0 },
		id: 'ws-1',
		pathLabel: '/tmp/ws',
		reviewFiles: [],
	} as unknown as WorkspaceShellModel;
}

/** A checkpoint row as the workspace listing returns it. */
function checkpoint(gitHash: string, turnId: string, label: string) {
	return {
		agentSessionId: 'session-1',
		createdAt: '2026-09-13T15:48:00.000Z',
		gitHash,
		gitRef: `refs/ensemblr/checkpoints/ws-1/${turnId}`,
		id: `checkpoint-${turnId}`,
		label,
		turnId,
		workspaceId: 'ws-1',
	};
}

function wrapper({ children }: { children: ReactNode }) {
	const client = createTestQueryClient();
	return (
		<QueryClientProvider client={client}>
			<Provider>{children}</Provider>
		</QueryClientProvider>
	);
}

beforeEach(() => {
	clearEnsemblrApi();
});

test('the latest-turn source resolves to the newest checkpoint, run live', async () => {
	const getWorkspaceGitStatus = vi.fn(async () => ({
		files: [],
		summary: { additions: 0, deletions: 0, files: 0 },
	}));
	installEnsemblrApi({
		getWorkspaceGitStatus,
		listWorkspaceCheckpoints: async () => ({
			checkpoints: [
				checkpoint(OLDER_REF, 'turn-1', 'an earlier turn'),
				checkpoint(FROM_REF, 'turn-2', 'the newest turn'),
			],
		}),
	});

	const { result } = renderHook(() => useChangesSource(workspace()), {
		wrapper,
	});
	result.current.setSource({ kind: 'latest-turn' });

	await waitFor(() => {
		expect(result.current.scope).toEqual({ fromRef: FROM_REF, kind: 'turn' });
	});
	expect(result.current.latestTurnLabel).toBe('the newest turn');
});

test('a workspace with no checkpoint degrades to the working tree', async () => {
	installEnsemblrApi({
		getWorkspaceGitStatus: async () => ({
			files: [],
			summary: { additions: 0, deletions: 0, files: 0 },
		}),
		listWorkspaceCheckpoints: async () => ({ checkpoints: [] }),
	});

	const { result } = renderHook(() => useChangesSource(workspace()), {
		wrapper,
	});
	result.current.setSource({ kind: 'latest-turn' });

	await waitFor(() => {
		expect(result.current.source.kind).toBe('latest-turn');
	});
	expect(result.current.scope).toEqual({ kind: 'working-tree' });
	expect(result.current.latestTurnLabel).toBeNull();
});
