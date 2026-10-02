// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { GithubOwnerEntry } from '../../src/shared/ipc/contracts/quick-start';
import { installLocalStorage } from './support/dom';

const { quickStartProject, seedFirstWorkspace, useQuery } = vi.hoisted(() => ({
	quickStartProject: vi.fn(),
	seedFirstWorkspace: vi.fn(),
	useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-query')>()),
	useQuery,
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => vi.fn(),
	useRouter: () => ({}),
}));

vi.mock('@/renderer/api/ensemblr-queries', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/renderer/api/ensemblr-queries')>()),
	githubOwnerListQuery: { queryKey: ['github-owner-list'] },
	isEnsemblrApiAvailable: () => true,
	quickStartProject,
	rootDirectoryQuery: { queryKey: ['root-directory'] },
}));

vi.mock('@/renderer/lib/failure-text', () => ({ failureText: () => null }));

vi.mock('@/renderer/lib/workbench/seed-first-workspace', () => ({
	seedFirstWorkspace,
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import { useQuickStartFlow } from '../../src/renderer/hooks/welcome/use-quick-start-flow';
import { lastQuickStartOwnerAtom } from '../../src/renderer/state/preferences';

function makeOwner(
	login: string,
	overrides: Partial<GithubOwnerEntry> = {},
): GithubOwnerEntry {
	return {
		avatarUrl: null,
		canCreate: true,
		displayName: null,
		kind: 'organization',
		login,
		restriction: null,
		...overrides,
	};
}

const VIEWER = makeOwner('alice', { kind: 'user' });
const ORG = makeOwner('ensemblr-hq');
const LOCKED = makeOwner('locked-org', { canCreate: false });

function stubOwnerQuery(
	owners: GithubOwnerEntry[] | null,
	{ pending = false }: { pending?: boolean } = {},
): void {
	useQuery.mockImplementation((options: { queryKey: readonly string[] }) => {
		if (options.queryKey[0] === 'github-owner-list') {
			return {
				data: owners
					? {
							generatedAt: '2026-06-07T12:00:00.000Z',
							owners,
							status: 'success',
						}
					: undefined,
				isPending: pending,
			};
		}
		return { data: { repositoriesPath: '/repos' }, isPending: false };
	});
}

function renderFlow(store: ReturnType<typeof createStore>) {
	return renderHook(() => useQuickStartFlow(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		),
	});
}

let store: ReturnType<typeof createStore>;

beforeEach(() => {
	installLocalStorage();
	store = createStore();
	vi.clearAllMocks();
	seedFirstWorkspace.mockResolvedValue({ status: 'success' });
	quickStartProject.mockResolvedValue({
		diagnostics: [],
		repository: { id: 'repo-1', name: 'my-app' },
		status: 'success',
		targetPath: '/repos/my-app',
	});
});

test('hides the picker when the signed-in user is the only account', () => {
	stubOwnerQuery([VIEWER]);

	const { result } = renderFlow(store);

	expect(result.current.owners).toEqual([]);
	expect(result.current.owner).toBe('');
});

test('offers the whole list once there is a real choice to make', () => {
	stubOwnerQuery([VIEWER, ORG, LOCKED]);

	const { result } = renderFlow(store);

	expect(result.current.owners.map((entry) => entry.login)).toEqual([
		'alice',
		'ensemblr-hq',
		'locked-org',
	]);
	expect(result.current.owner).toBe('alice');
});

test('preselects the remembered organization while it can still receive repos', () => {
	store.set(lastQuickStartOwnerAtom, 'ensemblr-hq');
	stubOwnerQuery([VIEWER, ORG]);

	const { result } = renderFlow(store);

	expect(result.current.owner).toBe('ensemblr-hq');
});

test('falls back to the signed-in user when the remembered owner lost access', () => {
	store.set(lastQuickStartOwnerAtom, 'locked-org');
	stubOwnerQuery([VIEWER, ORG, LOCKED]);

	const { result } = renderFlow(store);

	expect(result.current.owner).toBe('alice');
});

test('falls back to the signed-in user when the remembered owner is gone', () => {
	store.set(lastQuickStartOwnerAtom, 'departed-org');
	stubOwnerQuery([VIEWER, ORG]);

	const { result } = renderFlow(store);

	expect(result.current.owner).toBe('alice');
});

test('sends no owner when publishing under the signed-in user', async () => {
	stubOwnerQuery([VIEWER, ORG]);

	const { result } = renderFlow(store);
	await act(async () => {
		await result.current.startQuickStart({ name: 'my-app' });
	});

	expect(quickStartProject).toHaveBeenCalledWith({
		name: 'my-app',
		parentPath: '/repos',
	});
});

test('sends the organization prefix once one is picked', async () => {
	stubOwnerQuery([VIEWER, ORG]);

	const { result } = renderFlow(store);
	act(() => {
		result.current.setOwner('ensemblr-hq');
	});
	await act(async () => {
		await result.current.startQuickStart({ name: 'my-app' });
	});

	expect(quickStartProject).toHaveBeenCalledWith({
		name: 'my-app',
		owner: 'ensemblr-hq',
		parentPath: '/repos',
	});
});

test('remembers a published organization and forgets it again for the personal account', async () => {
	stubOwnerQuery([VIEWER, ORG]);

	const { result } = renderFlow(store);
	act(() => {
		result.current.setOwner('ensemblr-hq');
	});
	await act(async () => {
		await result.current.startQuickStart({ name: 'my-app' });
	});
	expect(store.get(lastQuickStartOwnerAtom)).toBe('ensemblr-hq');

	act(() => {
		result.current.setOwner('alice');
	});
	await act(async () => {
		await result.current.startQuickStart({ name: 'my-app' });
	});
	expect(store.get(lastQuickStartOwnerAtom)).toBeNull();
});

test('holds Create while gh answers only for a returning organization user', () => {
	stubOwnerQuery(null, { pending: true });

	const { result: fresh } = renderFlow(store);
	expect(fresh.current.ownersLoading).toBe(false);

	const returning = createStore();
	returning.set(lastQuickStartOwnerAtom, 'ensemblr-hq');
	const { result: remembered } = renderFlow(returning);
	expect(remembered.current.ownersLoading).toBe(true);
});
