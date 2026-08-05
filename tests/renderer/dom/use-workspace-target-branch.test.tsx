// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import { useWorkspaceTargetBranch } from '@/renderer/hooks/workbench-shell/use-workspace-target-branch';
import type { SetWorkspaceBaseBranchResult } from '@/shared/ipc/contracts/workspace';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from '../support/dom';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
	clearEnsemblrApi();
	toastError.mockReset();
});

function setup(result: SetWorkspaceBaseBranchResult | Error) {
	const setWorkspaceBaseBranch = vi.fn(async () => {
		if (result instanceof Error) {
			throw result;
		}
		return result;
	});
	installEnsemblrApi({ setWorkspaceBaseBranch });

	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { result: hook } = renderHook(() => useWorkspaceTargetBranch('ws-1'), {
		wrapper,
	});
	return { client, hook, setWorkspaceBaseBranch };
}

const ok: SetWorkspaceBaseBranchResult = {
	baseBranch: 'origin/release',
	diagnostics: [],
	status: 'success',
};

test('qualifies a bare branch name before persisting it', async () => {
	const { hook, setWorkspaceBaseBranch } = setup(ok);

	act(() => hook.current.retargetBranch('release'));

	await waitFor(() => {
		expect(setWorkspaceBaseBranch).toHaveBeenCalledWith({
			baseBranch: 'origin/release',
			workspaceId: 'ws-1',
		});
	});
});

test('does not double-qualify an already-qualified ref', async () => {
	const { hook, setWorkspaceBaseBranch } = setup(ok);

	act(() => hook.current.retargetBranch('origin/release'));

	await waitFor(() => {
		expect(setWorkspaceBaseBranch).toHaveBeenCalledWith({
			baseBranch: 'origin/release',
			workspaceId: 'ws-1',
		});
	});
});

test('stores a typed ref verbatim rather than forcing it onto origin', async () => {
	const { hook, setWorkspaceBaseBranch } = setup(ok);

	act(() => hook.current.retargetRef('upstream/main'));

	await waitFor(() => {
		expect(setWorkspaceBaseBranch).toHaveBeenCalledWith({
			baseBranch: 'upstream/main',
			workspaceId: 'ws-1',
		});
	});
});

test('skips the call entirely for a blank branch name', async () => {
	const { hook, setWorkspaceBaseBranch } = setup(ok);

	act(() => hook.current.retargetBranch('   '));
	act(() => hook.current.retargetRef('   '));

	expect(setWorkspaceBaseBranch).not.toHaveBeenCalled();
	expect(toastError).not.toHaveBeenCalled();
});

test('refreshes the navigation snapshot so the review panel re-scopes', async () => {
	const { client, hook } = setup(ok);
	const invalidate = vi.spyOn(client, 'invalidateQueries');

	act(() => hook.current.retargetBranch('release'));

	await waitFor(() => {
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		});
	});
});

test('reports in-flight state while the write is running', async () => {
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const setWorkspaceBaseBranch = vi.fn(async () => {
		await held;
		return ok;
	});
	installEnsemblrApi({ setWorkspaceBaseBranch });

	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { result: hook } = renderHook(() => useWorkspaceTargetBranch('ws-1'), {
		wrapper,
	});

	expect(hook.current.isPending).toBe(false);

	act(() => hook.current.retargetBranch('release'));

	await waitFor(() => {
		expect(hook.current.isPending).toBe(true);
	});

	await act(async () => {
		release?.();
		await held;
	});

	await waitFor(() => {
		expect(hook.current.isPending).toBe(false);
	});
});

test('surfaces the service diagnostic and skips invalidation on failure', async () => {
	const { client, hook } = setup({
		baseBranch: null,
		diagnostics: [
			{
				code: 'base-branch-unresolvable',
				message: 'Could not resolve "origin/ghost".',
				severity: 'error',
			},
		],
		status: 'failure',
	});
	const invalidate = vi.spyOn(client, 'invalidateQueries');

	act(() => hook.current.retargetBranch('ghost'));

	await waitFor(() => {
		expect(toastError).toHaveBeenCalledWith(
			'Could not resolve "origin/ghost".',
		);
	});
	expect(invalidate).not.toHaveBeenCalled();
});

test('falls back to a generic message when the bridge throws', async () => {
	const { hook } = setup(new Error('ipc exploded'));

	act(() => hook.current.retargetBranch('release'));

	await waitFor(() => {
		expect(toastError).toHaveBeenCalledWith(
			'Could not change the target branch.',
		);
	});
});
