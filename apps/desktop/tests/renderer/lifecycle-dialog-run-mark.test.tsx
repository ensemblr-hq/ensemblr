// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => vi.fn().mockResolvedValue(undefined),
	useRouter: () => ({
		invalidate: vi.fn().mockResolvedValue(undefined),
		state: { location: { href: '/' } },
	}),
}));

import { useLifecycleDialogAction } from '@/renderer/hooks/workbench-shell/use-lifecycle-dialog-action';
import { workspaceLifecycleRunsAtom } from '@/renderer/state/workspace/workspace-lifecycle-runs';

const store = getDefaultStore();

/** The diagnostic shape the hook builds for an unexpected error. */
function failure(message: string) {
	return {
		code: 'delete-workspace-failed',
		message,
		severity: 'error' as const,
	};
}

/**
 * Renders the hook against a delete that resolves only when the returned
 * `finish` is called, so a second `start()` lands while the first is in flight.
 */
function renderPendingDelete() {
	let finish: () => void = () => undefined;
	const run = vi.fn(
		() =>
			new Promise<{ diagnostics: []; status: 'success' }>((resolve) => {
				finish = () => resolve({ diagnostics: [], status: 'success' });
			}),
	);

	const view = renderHook(() =>
		useLifecycleDialogAction({
			failure,
			lifecycleRun: { kind: 'deleting' as const, workspaceId: 'ws-doomed' },
			onOpenChange: vi.fn(),
			onSucceeded: vi.fn(),
			operationKey: 'delete-workspace:ws-doomed',
			run,
		}),
	);

	return { finish: () => finish(), run, view };
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	store.set(workspaceLifecycleRunsAtom, new Map());
});

// The mark used to be set by the caller around `start()`, so a second confirm
// the re-entrancy latch REFUSED still ran its own `finally` and cleared the mark
// the first, still-running teardown owned. The row dropped "Deleting…" and went
// interactive, the board card took drags again, and the loaders stopped refusing
// the workspace — while its worktree was still being removed.
test('keeps the run marked when a second start is refused by the latch', async () => {
	const { finish, run, view } = renderPendingDelete();

	await act(async () => {
		void view.result.current.start();
		await Promise.resolve();
	});

	expect(store.get(workspaceLifecycleRunsAtom).get('ws-doomed')).toBe(
		'deleting',
	);

	await act(async () => {
		await view.result.current.start();
	});

	expect(run).toHaveBeenCalledTimes(1);
	expect(store.get(workspaceLifecycleRunsAtom).get('ws-doomed')).toBe(
		'deleting',
	);

	await act(async () => {
		finish();
		await Promise.resolve();
	});

	expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(false);
});

// A dialog that runs no teardown of its own — the repository delete — passes no
// run to mark, and must not write one.
test('marks nothing when the dialog names no lifecycle run', async () => {
	const view = renderHook(() =>
		useLifecycleDialogAction({
			failure,
			onOpenChange: vi.fn(),
			onSucceeded: vi.fn(),
			operationKey: 'delete-repository:repo-1',
			run: async () => ({ diagnostics: [] as [], status: 'success' as const }),
		}),
	);

	await act(async () => {
		await view.result.current.start();
	});

	expect(store.get(workspaceLifecycleRunsAtom).size).toBe(0);
});
