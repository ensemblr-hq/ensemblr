// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

import { installLocalStorage } from './support/dom';

const cancelComputeJob = vi.fn();
const startComputeJob = vi.fn();
const stopWorkspaceScript = vi.fn();
const toastError = vi.fn();

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('sonner', () => ({ toast: { error: toastError, warning: vi.fn() } }));

vi.mock('@/renderer/api/ensemblr/compute-queue', () => ({
	cancelComputeJob: (...args: unknown[]) => cancelComputeJob(...args),
	startComputeJob: (...args: unknown[]) => startComputeJob(...args),
}));

vi.mock('@/renderer/api/ensemblr/workspace-scripts', () => ({
	runWorkspaceScript: vi.fn(),
	stopWorkspaceScript: (...args: unknown[]) => stopWorkspaceScript(...args),
}));

const { useWorkspaceDockActions } = await import(
	'@/renderer/state/workspace/dock-actions'
);

/** Mounts the dock actions over stub terminal plumbing and returns them. */
function renderActions(): WorkbenchDockActions {
	const { result } = renderHook(() =>
		useWorkspaceDockActions({
			activeDockTab: 'setup',
			askAgentSetupScript: vi.fn(),
			closeTerminal: vi.fn(),
			createTerminal: vi.fn(),
			repositoryId: 'repo-1',
			sessions: [],
			updateSearch: vi.fn(),
			workspaceId: 'ws-1',
		}),
	);
	return result.current;
}

/** Lets the queue promise and its `.then` settle before assertions run. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	installLocalStorage();
	vi.clearAllMocks();
	cancelComputeJob.mockResolvedValue({ cancelled: true });
	startComputeJob.mockResolvedValue({ started: true });
});

test('starts exactly the queued job it was handed, without relaunching the script', async () => {
	renderActions().onStartQueuedScript('job-7');
	await flush();

	expect(startComputeJob).toHaveBeenCalledWith('job-7');
	expect(toastError).not.toHaveBeenCalled();
});

test('cancels exactly the queued job it was handed, never stopping the script kind', async () => {
	renderActions().onCancelQueuedScript('job-7');
	await flush();

	expect(cancelComputeJob).toHaveBeenCalledWith('job-7');
	expect(stopWorkspaceScript).not.toHaveBeenCalled();
	expect(toastError).not.toHaveBeenCalled();
});

test('says so when the job had already left the queue before Start now landed', async () => {
	startComputeJob.mockResolvedValue({ started: false });

	renderActions().onStartQueuedScript('job-7');
	await flush();

	expect(toastError).toHaveBeenCalledWith(
		'Could not start it now. It may have already started or been cancelled.',
	);
});

test('says so when the job had already finished before Cancel landed', async () => {
	cancelComputeJob.mockResolvedValue({ cancelled: false });

	renderActions().onCancelQueuedScript('job-7');
	await flush();

	expect(toastError).toHaveBeenCalledWith(
		'Could not cancel it. It may have already finished.',
	);
});
