// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useCloneDialogForm } from '../../src/renderer/hooks/welcome/use-clone-dialog-form';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const CLONE_URL = 'https://github.com/ensemblr-hq/ensemblr.git';

const startClone = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/renderer/hooks/welcome/use-clone-flow', () => ({
	useCloneFlow: () => ({
		diagnostics: [],
		isBusy: false,
		logs: [],
		retry: () => {},
		stage: 'idle' as const,
		startClone,
		successResult: null,
	}),
}));

function wrapper({ children }: { children: ReactNode }) {
	const client = createTestQueryClient();
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderForm() {
	return renderHook(() => useCloneDialogForm({ onOpenChange: () => {} }), {
		wrapper,
	});
}

beforeEach(() => {
	startClone.mockClear();
	installEnsemblrApi({
		githubRemoteBranchList: async () => ({ branches: [], status: 'ok' }),
		githubRepositoryList: async () => ({
			entries: [],
			generatedAt: '2026-06-07T12:00:00.000Z',
			status: 'success',
		}),
		rootDirectory: async () => ({ repositoriesPath: '' }),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

test('the branch picker stays disabled until the URL names a repository', () => {
	const { result } = renderForm();

	expect(result.current.branchDisabled).toBe(true);

	act(() => result.current.search.handleUrlChange(CLONE_URL));
	expect(result.current.branchDisabled).toBe(false);
});

test('a listed branch reaches the clone as both --branch and branchFrom', async () => {
	const { result } = renderForm();

	act(() => result.current.search.handleUrlChange(CLONE_URL));
	act(() =>
		result.current.setBranchSelection({
			branchFrom: 'origin/develop',
			cloneBranch: 'develop',
		}),
	);
	await act(async () => {
		await result.current.handleClone();
	});

	expect(startClone).toHaveBeenCalledExactlyOnceWith({
		branch: 'develop',
		branchFrom: 'origin/develop',
		url: CLONE_URL,
	});
});

test('a hand-typed ref sets branchFrom without asking git to check it out', async () => {
	const { result } = renderForm();

	act(() => result.current.search.handleUrlChange(CLONE_URL));
	act(() =>
		result.current.setBranchSelection({
			branchFrom: 'upstream/release',
			cloneBranch: null,
		}),
	);
	await act(async () => {
		await result.current.handleClone();
	});

	expect(startClone).toHaveBeenCalledExactlyOnceWith({
		branchFrom: 'upstream/release',
		url: CLONE_URL,
	});
});

test('leaving the picker alone sends no branch at all', async () => {
	const { result } = renderForm();

	act(() => result.current.search.handleUrlChange(CLONE_URL));
	await act(async () => {
		await result.current.handleClone();
	});

	expect(startClone).toHaveBeenCalledExactlyOnceWith({
		url: CLONE_URL,
	});
});

test('retargeting the dialog at another repository drops the picked branch', () => {
	const { result } = renderForm();

	act(() => result.current.search.handleUrlChange(CLONE_URL));
	act(() =>
		result.current.setBranchSelection({
			branchFrom: 'origin/develop',
			cloneBranch: 'develop',
		}),
	);
	expect(result.current.branchSelection).not.toBeNull();

	act(() =>
		result.current.search.handleUrlChange(
			'https://github.com/ensemblr-hq/other.git',
		),
	);
	expect(result.current.branchSelection).toBeNull();
});
