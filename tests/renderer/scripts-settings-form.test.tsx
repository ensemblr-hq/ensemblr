// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	type ScriptsForm,
	useScriptsSettingsForm,
} from '@/renderer/hooks/use-scripts-settings-form';

const { updateRepositoryScriptsMock } = vi.hoisted(() => ({
	updateRepositoryScriptsMock: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr', () => ({
	settingsResolutionQuery: vi.fn(() => ({ queryKey: ['settings-resolution'] })),
	updateRepositoryScripts: updateRepositoryScriptsMock,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

/** Second positional arg type without re-deriving the repo project shape. */
type Project = Parameters<typeof useScriptsSettingsForm>[1];

const project = {
	pathLabel: '/repos/repo-1',
} as unknown as Project;

const initial: ScriptsForm = {
	archive: '',
	autoRun: false,
	run: '',
	runMode: 'concurrent',
	setup: '',
};

/** Fresh QueryClientProvider wrapper for the hook under test. */
function createWrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return function Wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
	};
}

function renderForm(
	repoProject: Project = project,
	seed: ScriptsForm = initial,
) {
	return renderHook(() => useScriptsSettingsForm('repo-1', repoProject, seed), {
		wrapper: createWrapper(),
	});
}

describe('useScriptsSettingsForm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateRepositoryScriptsMock.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('seeds the form from the initial snapshot', () => {
		const { result } = renderForm(project, {
			...initial,
			setup: 'bun install',
		});
		expect(result.current.form.setup).toBe('bun install');
	});

	test('coalesces rapid edits into one save with trimmed values (blank → null)', async () => {
		vi.useFakeTimers();
		const { result } = renderForm();

		act(() => {
			result.current.updateForm({ setup: 'bun ins' });
			result.current.updateForm({ setup: 'bun install' });
			result.current.updateForm({ run: '   ' });
		});

		expect(updateRepositoryScriptsMock).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(updateRepositoryScriptsMock).toHaveBeenCalledTimes(1);
		expect(updateRepositoryScriptsMock).toHaveBeenCalledWith({
			archive: null,
			autoRunAfterSetup: false,
			repositoryId: 'repo-1',
			run: null,
			runScriptMode: 'concurrent',
			setup: 'bun install',
		});
	});

	test('flushes a pending debounced save on unmount', async () => {
		vi.useFakeTimers();
		const { result, unmount } = renderForm();

		act(() => {
			result.current.updateForm({ setup: 'bun install' });
		});

		// Unmount before the debounce elapses — the edit must still be persisted.
		await act(async () => {
			unmount();
		});

		expect(updateRepositoryScriptsMock).toHaveBeenCalledTimes(1);
		expect(updateRepositoryScriptsMock).toHaveBeenCalledWith(
			expect.objectContaining({ setup: 'bun install' }),
		);
	});

	test('shows an error toast when the write reports ok:false', async () => {
		updateRepositoryScriptsMock.mockResolvedValueOnce({ ok: false });
		vi.useFakeTimers();
		const { result } = renderForm();

		act(() => {
			result.current.updateForm({ setup: 'bun install' });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
			'Could not save script settings.',
		);
	});

	test('shows an error toast when the write rejects', async () => {
		updateRepositoryScriptsMock.mockRejectedValueOnce(new Error('db locked'));
		vi.useFakeTimers();
		const { result } = renderForm();

		act(() => {
			result.current.updateForm({ setup: 'bun install' });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
			'Could not save script settings.',
		);
	});

	test('keeps edits local and does not persist for an unknown repo', async () => {
		vi.useFakeTimers();
		// Call renderHook directly: passing `undefined` to renderForm's defaulted
		// param would resolve to the default project and defeat the guard.
		const { result } = renderHook(
			() =>
				useScriptsSettingsForm(
					'repo-1',
					undefined as unknown as Project,
					initial,
				),
			{ wrapper: createWrapper() },
		);

		act(() => {
			result.current.updateForm({ setup: 'x' });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(result.current.form.setup).toBe('x');
		expect(updateRepositoryScriptsMock).not.toHaveBeenCalled();
	});
});
