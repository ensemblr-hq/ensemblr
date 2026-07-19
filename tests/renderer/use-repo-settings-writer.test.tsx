// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { RepoProject } from '../../src/renderer/types/settings';
import { createTestQueryClient } from './support/dom';

const updateRepositorySettings = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
	toast: { error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/renderer/api/ensemblr')>();
	return {
		...actual,
		updateRepositorySettings: (request: unknown) =>
			updateRepositorySettings(request),
	};
});

const { useRepoSettingsWriter } = await import(
	'../../src/renderer/hooks/use-repo-settings-writer'
);

const PROJECT = { id: 'repo-1', pathLabel: '/repos/demo' } as RepoProject;

/** Renders the writer hook against a fresh client and returns the save callback plus an invalidate spy. */
function renderWriter(project: RepoProject) {
	const client = createTestQueryClient();
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(
		() => useRepoSettingsWriter('repo-1', project),
		{ wrapper },
	);
	return { invalidate, save: result.current };
}

beforeEach(() => {
	updateRepositorySettings.mockReset();
	updateRepositorySettings.mockResolvedValue({ ok: true });
	toastError.mockClear();
});

test('a successful save persists the patch and invalidates the resolution', async () => {
	const { invalidate, save } = renderWriter(PROJECT);

	await save({ branchFrom: 'origin/main' });

	expect(updateRepositorySettings).toHaveBeenCalledWith({
		repositoryId: 'repo-1',
		settings: { branchFrom: 'origin/main' },
	});
	expect(invalidate).toHaveBeenCalledTimes(1);
	expect(toastError).not.toHaveBeenCalled();
});

test('an unknown repo no-ops without touching the IPC channel', async () => {
	const { invalidate, save } = renderWriter(undefined);

	await save({ branchFrom: 'origin/main' });

	expect(updateRepositorySettings).not.toHaveBeenCalled();
	expect(invalidate).not.toHaveBeenCalled();
});

test('a rejected write toasts and skips invalidation', async () => {
	updateRepositorySettings.mockResolvedValue({ error: 'nope', ok: false });
	const { invalidate, save } = renderWriter(PROJECT);

	await save({ branchFrom: 'origin/main' });

	expect(toastError).toHaveBeenCalledWith(
		'Could not save repository settings.',
	);
	expect(invalidate).not.toHaveBeenCalled();
});

test('a thrown write is caught and toasted', async () => {
	updateRepositorySettings.mockRejectedValue(new Error('boom'));
	const { invalidate, save } = renderWriter(PROJECT);

	await save({ branchFrom: 'origin/main' });

	expect(toastError).toHaveBeenCalledWith(
		'Could not save repository settings.',
	);
	expect(invalidate).not.toHaveBeenCalled();
});
