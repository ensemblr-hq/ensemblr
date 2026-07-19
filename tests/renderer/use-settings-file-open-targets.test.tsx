// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { WorkspaceOpenTargetSnapshot } from '../../src/shared/ipc/contracts/open-target';
import { createTestQueryClient } from './support/dom';

const TARGETS: WorkspaceOpenTargetSnapshot[] = [
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
];

const openSettingsFileInTarget = vi.fn().mockResolvedValue({ ok: true });
const getEnsemblrApiOrNull = vi.fn<() => unknown>(() => ({}));
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
	toast: {
		error: (...args: unknown[]) => toastError(...args),
		success: (...args: unknown[]) => toastSuccess(...args),
	},
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/renderer/api/ensemblr')>();
	return {
		...actual,
		getEnsemblrApiOrNull: () => getEnsemblrApiOrNull(),
		openSettingsFileInTarget: (request: unknown) =>
			openSettingsFileInTarget(request),
		workspaceOpenTargetsQuery: {
			queryFn: () => Promise.resolve({ targets: TARGETS }),
			queryKey: ['ensemblr', 'workspace-open-targets'],
			staleTime: Number.POSITIVE_INFINITY,
		},
	};
});

const { useSettingsFileOpenTargets } = await import(
	'../../src/renderer/hooks/use-settings-file-open-targets'
);

/** Renders the hook against a fresh query client and resolves its primary target. */
async function renderReady(
	config: Parameters<typeof useSettingsFileOpenTargets>[0],
) {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(() => useSettingsFileOpenTargets(config), {
		wrapper,
	});
	await waitFor(() => expect(result.current.primaryTarget?.id).toBe('vscode'));
	return result;
}

beforeEach(() => {
	openSettingsFileInTarget.mockClear();
	openSettingsFileInTarget.mockResolvedValue({ ok: true });
	getEnsemblrApiOrNull.mockReset();
	getEnsemblrApiOrNull.mockReturnValue({});
	toastError.mockClear();
	toastSuccess.mockClear();
	window.localStorage.clear();
});

test('invokes the settings IPC channel with the resolved user config', async () => {
	const result = await renderReady({ scope: 'user' });

	const target = result.current.primaryTarget;
	if (!target) {
		throw new Error('Expected a primary target.');
	}
	await result.current.invokeTarget(target);

	expect(openSettingsFileInTarget).toHaveBeenCalledWith({
		config: { scope: 'user' },
		targetId: 'vscode',
	});
});

test('remembers the last-used target for a repo settings file', async () => {
	const result = await renderReady({
		repositoryPath: '/repos/demo',
		scope: 'repo',
	});
	const target = result.current.primaryTarget;
	if (!target) {
		throw new Error('Expected a primary target.');
	}
	await result.current.invokeTarget(target);

	expect(openSettingsFileInTarget).toHaveBeenCalledWith({
		config: { repositoryPath: '/repos/demo', scope: 'repo' },
		targetId: 'vscode',
	});
	const stored = window.localStorage.getItem(
		'ensemblr_workspace_open_target_last_used_v1',
	);
	expect(stored).toContain('settings:repo:/repos/demo');
	expect(stored).toContain('vscode');
});

test('copy-path targets toast success and are never remembered', async () => {
	const result = await renderReady({ scope: 'user' });
	const target = result.current.primaryTarget;
	if (!target) {
		throw new Error('Expected a primary target.');
	}
	await result.current.invokeTarget({ ...target, behavior: 'copy-path' });

	expect(toastSuccess).toHaveBeenCalledWith('Path copied to clipboard.');
	expect(
		window.localStorage.getItem('ensemblr_workspace_open_target_last_used_v1'),
	).toBeNull();
});

test('a failed open surfaces an error toast and does not remember the target', async () => {
	openSettingsFileInTarget.mockResolvedValueOnce({
		error: 'boom',
		ok: false,
	});
	const result = await renderReady({ scope: 'user' });
	const target = result.current.primaryTarget;
	if (!target) {
		throw new Error('Expected a primary target.');
	}
	await result.current.invokeTarget(target);

	expect(toastError).toHaveBeenCalledWith('Failed to open in VS Code: boom');
	expect(
		window.localStorage.getItem('ensemblr_workspace_open_target_last_used_v1'),
	).toBeNull();
});

test('a missing Electron bridge short-circuits before the IPC call', async () => {
	const result = await renderReady({ scope: 'user' });
	const target = result.current.primaryTarget;
	if (!target) {
		throw new Error('Expected a primary target.');
	}
	getEnsemblrApiOrNull.mockReturnValue(null);
	await result.current.invokeTarget(target);

	expect(openSettingsFileInTarget).not.toHaveBeenCalled();
	expect(toastError).toHaveBeenCalledWith(
		'Open in… is unavailable without the Electron bridge.',
	);
});
