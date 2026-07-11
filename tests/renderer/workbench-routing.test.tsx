import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { afterEach, expect, test } from 'vitest';

import { repositoryWorkspaceNavigationQuery } from '../../src/renderer/api/ensemblr-queries';
import { normalizeWorkbenchSearch } from '../../src/renderer/lib/workbench';
import { refreshRepositoryWorkspaceNavigationCache } from '../../src/renderer/lib/workbench/seed-first-workspace';
import {
	loadProjectWorkbenchRoute,
	loadShellWorkbenchRoute,
	loadWorkbenchIndexRoute,
	loadWorkbenchRouteData,
	loadWorkspaceChatRoute,
	loadWorkspaceIndexRoute,
	loadWorkspaceWorkbenchRoute,
} from '../../src/renderer/routing/workbench-route-loaders';
import type { WorkspaceRouteLoaderData } from '../../src/renderer/types/routing';
import type { RepositoryWorkspaceNavigationSnapshot } from '../../src/shared/ipc';

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
});

function createNavigationSnapshot({
	repositoryId,
	workspaceId,
}: {
	repositoryId: string;
	workspaceId: string;
}): RepositoryWorkspaceNavigationSnapshot {
	return {
		generatedAt: '2026-06-08T00:00:00.000Z',
		repositories: [
			{
				createdAt: '2026-06-08T00:00:00.000Z',
				defaultBranch: 'main',
				id: repositoryId,
				metadata: {},
				name: repositoryId,
				path: `/tmp/${repositoryId}`,
				slug: repositoryId,
				updatedAt: '2026-06-08T00:00:00.000Z',
				workspaces: [
					{
						archivedAt: null,
						baseBranch: 'main',
						branchName: `feature/${workspaceId}`,
						createdAt: '2026-06-08T00:00:00.000Z',
						id: workspaceId,
						metadata: {},
						name: workspaceId,
						path: `/tmp/${repositoryId}/${workspaceId}`,
						repositoryId,
						slug: workspaceId,
						updatedAt: '2026-06-08T00:00:00.000Z',
					},
				],
			},
		],
	};
}

async function catchProjectRouteRedirect({
	params,
}: {
	params: {
		projectId: string;
	};
}) {
	Reflect.deleteProperty(globalThis, 'window');
	const queryClient = new QueryClient();
	const loaderData = await loadWorkbenchRouteData(queryClient);

	try {
		await loadProjectWorkbenchRoute({
			parentMatchPromise: Promise.resolve({ loaderData }),
			params,
			queryClient,
		});
	} catch (error) {
		if (isRedirect(error)) {
			return error.options;
		}

		throw error;
	}

	throw new Error('Expected project route loader to redirect.');
}

async function catchWorkspaceRouteRedirect({
	params,
	rawSearch = {},
	search = normalizeWorkbenchSearch(rawSearch),
}: {
	params: {
		projectId: string;
		workspaceId: string;
	};
	rawSearch?: Record<string, unknown>;
	search?: ReturnType<typeof normalizeWorkbenchSearch>;
}) {
	Reflect.deleteProperty(globalThis, 'window');
	const loaderData = await loadWorkbenchRouteData(new QueryClient());

	try {
		await loadWorkspaceWorkbenchRoute({
			parentMatchPromise: Promise.resolve({ loaderData }),
			params,
			rawSearch,
			search,
		});
	} catch (error) {
		if (isRedirect(error)) {
			return error.options;
		}

		throw error;
	}

	throw new Error('Expected workspace route loader to redirect.');
}

async function catchWorkbenchIndexRouteRedirect({
	queryClient = new QueryClient(),
}: {
	queryClient?: QueryClient;
} = {}) {
	const loaderData = await loadWorkbenchRouteData(queryClient);

	try {
		await loadWorkbenchIndexRoute({
			parentMatchPromise: Promise.resolve({ loaderData }),
			queryClient,
		});
	} catch (error) {
		if (isRedirect(error)) {
			return error.options;
		}

		throw error;
	}

	throw new Error('Expected workbench index route loader to redirect.');
}

async function loadDefaultWorkspaceRouteData(): Promise<WorkspaceRouteLoaderData> {
	Reflect.deleteProperty(globalThis, 'window');
	const loaderData = await loadWorkbenchRouteData(new QueryClient());
	const workspaceData = await loadWorkspaceWorkbenchRoute({
		parentMatchPromise: Promise.resolve({ loaderData }),
		params: {
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		rawSearch: {},
		search: normalizeWorkbenchSearch({}),
	});

	if (!workspaceData) {
		throw new Error('Expected workspace route loader data.');
	}

	return workspaceData;
}

async function catchWorkspaceIndexRouteRedirect({
	rawSearch = {},
	search = normalizeWorkbenchSearch(rawSearch),
}: {
	rawSearch?: Record<string, unknown>;
	search?: ReturnType<typeof normalizeWorkbenchSearch>;
}) {
	const workspaceData = await loadDefaultWorkspaceRouteData();

	try {
		await loadWorkspaceIndexRoute({
			parentMatchPromise: Promise.resolve({ loaderData: workspaceData }),
			params: {
				projectId: 'ensemblr',
				workspaceId: 'san-antonio',
			},
			search,
		});
	} catch (error) {
		if (isRedirect(error)) {
			return error.options;
		}

		throw error;
	}

	throw new Error('Expected workspace index route loader to redirect.');
}

async function catchWorkspaceChatRouteRedirect({
	params,
	rawSearch = {},
	search = normalizeWorkbenchSearch(rawSearch),
}: {
	params: {
		chatId: string;
		projectId: string;
		workspaceId: string;
	};
	rawSearch?: Record<string, unknown>;
	search?: ReturnType<typeof normalizeWorkbenchSearch>;
}) {
	const workspaceData = await loadDefaultWorkspaceRouteData();

	try {
		await loadWorkspaceChatRoute({
			parentMatchPromise: Promise.resolve({ loaderData: workspaceData }),
			params,
			rawSearch,
			search,
		});
	} catch (error) {
		if (isRedirect(error)) {
			return error.options;
		}

		throw error;
	}

	throw new Error('Expected workspace chat route loader to redirect.');
}

test('redirects invalid project routes to the default workspace URL', async () => {
	const redirectOptions = await catchProjectRouteRedirect({
		params: {
			projectId: 'missing-project',
		},
	});

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'review-shell',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('redirects workbench launch to the persisted workspace when available', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			localStorage: {
				getItem: () =>
					JSON.stringify({
						projectId: 'ensemblr',
						workspaceId: 'linear-issue-flow',
					}),
			},
		},
	});

	const redirectOptions = await catchWorkbenchIndexRouteRedirect();

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'issue-kickoff',
			projectId: 'ensemblr',
			workspaceId: 'linear-issue-flow',
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('fetches live navigation before redirecting workbench launch', async () => {
	const queryClient = new QueryClient();
	const snapshot = createNavigationSnapshot({
		repositoryId: 'repo-live',
		workspaceId: 'workspace-live',
	});
	let calls = 0;

	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			ensemblr: {
				repositoryWorkspaceNavigation: async () => {
					calls += 1;
					return snapshot;
				},
			},
			localStorage: {
				getItem: () => null,
			},
		},
	});

	const redirectOptions = await catchWorkbenchIndexRouteRedirect({
		queryClient,
	});

	expect(calls).toBe(1);
	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'workspace-live:overview',
			projectId: 'repo-live',
			workspaceId: 'workspace-live',
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('leaves workbench launch on welcome when no workspace exists', async () => {
	const queryClient = new QueryClient();

	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			ensemblr: {
				repositoryWorkspaceNavigation: async () => ({
					generatedAt: '2026-06-08T00:00:00.000Z',
					repositories: [],
				}),
			},
			localStorage: {
				getItem: () => null,
			},
		},
	});
	const loaderData = await loadWorkbenchRouteData(queryClient);
	const result = await loadWorkbenchIndexRoute({
		parentMatchPromise: Promise.resolve({ loaderData }),
		queryClient,
	});

	expect(result).toBeUndefined();
});

test('falls back to the stored project when its workspace is gone', async () => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			localStorage: {
				getItem: () =>
					JSON.stringify({
						projectId: 'agent-lab',
						workspaceId: 'archived-workspace',
					}),
			},
		},
	});

	const redirectOptions = await catchWorkbenchIndexRouteRedirect();

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'checks-pass',
			projectId: 'agent-lab',
			workspaceId: 'review-checks',
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('redirects missing workspace routes to the welcome screen', async () => {
	const redirectOptions = await catchWorkspaceRouteRedirect({
		params: {
			projectId: 'ensemblr',
			workspaceId: 'missing-workspace',
		},
	});

	expect(redirectOptions).toMatchObject({
		replace: true,
		to: '/',
	});
});

test('redirects legacy workspace chat search params to the chat route', async () => {
	const redirectOptions = await catchWorkspaceRouteRedirect({
		params: {
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		rawSearch: {
			chat: 'missing-session',
			dock: 'terminal',
			extra: 'ignored',
		},
	});

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'review-shell',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		replace: true,
		search: {
			dock: 'setup',
		},
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('redirects workspace index routes to the default chat route', async () => {
	const redirectOptions = await catchWorkspaceIndexRouteRedirect({
		rawSearch: {
			review: 'checks',
		},
	});

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'review-shell',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		replace: true,
		search: {
			review: 'checks',
		},
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('accepts valid typed chat route params without redirecting', async () => {
	const workspaceData = await loadDefaultWorkspaceRouteData();
	const result = await loadWorkspaceChatRoute({
		parentMatchPromise: Promise.resolve({ loaderData: workspaceData }),
		params: {
			chatId: 'review-shell',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		rawSearch: {
			dock: 'terminal:logs',
		},
		search: normalizeWorkbenchSearch({
			dock: 'terminal:logs',
		}),
	});

	expect(result).toBeUndefined();
});

test('accepts database-backed chat route params outside fixture sessions', async () => {
	const workspaceData = await loadDefaultWorkspaceRouteData();
	const result = await loadWorkspaceChatRoute({
		parentMatchPromise: Promise.resolve({ loaderData: workspaceData }),
		params: {
			chatId: 'chat-tab-from-database',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		rawSearch: {},
		search: normalizeWorkbenchSearch({}),
	});

	expect(result).toBeUndefined();
});

test('canonicalizes chat route search without replacing database tab ids', async () => {
	const redirectOptions = await catchWorkspaceChatRouteRedirect({
		params: {
			chatId: 'chat-tab-from-database',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		rawSearch: {
			dock: 'terminal',
		},
	});

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'chat-tab-from-database',
			projectId: 'ensemblr',
			workspaceId: 'san-antonio',
		},
		replace: true,
		search: {
			dock: 'setup',
		},
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('project loader reads fresh navigation cache before redirecting new project routes', async () => {
	Reflect.deleteProperty(globalThis, 'window');
	const queryClient = new QueryClient();
	const loaderData = await loadWorkbenchRouteData(queryClient);
	const freshSnapshot = createNavigationSnapshot({
		repositoryId: 'new-project',
		workspaceId: 'new-workspace',
	});

	queryClient.setQueryData(
		repositoryWorkspaceNavigationQuery.queryKey,
		freshSnapshot,
	);

	const projectData = await loadProjectWorkbenchRoute({
		parentMatchPromise: Promise.resolve({ loaderData }),
		params: {
			projectId: 'new-project',
		},
		queryClient,
	});

	expect(projectData?.projects[0]?.id).toBe('new-project');

	const workspaceData = await loadWorkspaceWorkbenchRoute({
		parentMatchPromise: Promise.resolve({ loaderData: projectData }),
		params: {
			projectId: 'new-project',
			workspaceId: 'new-workspace',
		},
		queryClient,
		rawSearch: {},
		search: normalizeWorkbenchSearch({}),
	});

	expect(workspaceData?.project.id).toBe('new-project');
	expect(workspaceData?.workspace.id).toBe('new-workspace');
});

test('reads fresh navigation cache when parent loaderData lacks the workspace', async () => {
	Reflect.deleteProperty(globalThis, 'window');
	const queryClient = new QueryClient();
	const loaderData = await loadWorkbenchRouteData(queryClient);

	const seededWorkspaceId = 'workspace-test-fresh-cache';
	const seededSnapshot: RepositoryWorkspaceNavigationSnapshot = {
		generatedAt: '2026-06-08T00:00:00.000Z',
		repositories: [
			{
				createdAt: '2026-06-08T00:00:00.000Z',
				defaultBranch: 'main',
				id: 'ensemblr',
				metadata: {},
				name: 'ensemblr',
				path: '/tmp/ensemblr',
				slug: 'ensemblr',
				updatedAt: '2026-06-08T00:00:00.000Z',
				workspaces: [
					{
						archivedAt: null,
						baseBranch: 'main',
						branchName: 'feature/test-fresh',
						createdAt: '2026-06-08T00:00:00.000Z',
						id: seededWorkspaceId,
						metadata: {},
						name: 'Test Fresh',
						path: '/tmp/ensemblr/test-fresh',
						repositoryId: 'ensemblr',
						slug: 'test-fresh',
						updatedAt: '2026-06-08T00:00:00.000Z',
					},
				],
			},
		],
	};
	queryClient.setQueryData(
		repositoryWorkspaceNavigationQuery.queryKey,
		seededSnapshot,
	);

	const workspaceData = await loadWorkspaceWorkbenchRoute({
		parentMatchPromise: Promise.resolve({ loaderData }),
		params: {
			projectId: 'ensemblr',
			workspaceId: seededWorkspaceId,
		},
		queryClient,
		rawSearch: {},
		search: normalizeWorkbenchSearch({}),
	});

	expect(workspaceData).toBeDefined();
	expect(workspaceData?.project.id).toBe('ensemblr');
	expect(workspaceData?.workspace.id).toBe(seededWorkspaceId);
});

test('refreshes navigation from IPC even when the cache is fresh', async () => {
	const queryClient = new QueryClient();
	const staleSnapshot = createNavigationSnapshot({
		repositoryId: 'repo-old',
		workspaceId: 'workspace-old',
	});
	const freshSnapshot = createNavigationSnapshot({
		repositoryId: 'repo-new',
		workspaceId: 'workspace-new',
	});
	let calls = 0;

	queryClient.setQueryData(
		repositoryWorkspaceNavigationQuery.queryKey,
		staleSnapshot,
	);
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			ensemblr: {
				repositoryWorkspaceNavigation: async () => {
					calls += 1;
					return freshSnapshot;
				},
			},
		},
	});

	const snapshot = await refreshRepositoryWorkspaceNavigationCache(queryClient);

	const cachedSnapshot =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			repositoryWorkspaceNavigationQuery.queryKey,
		);

	expect(calls).toBe(1);
	expect(snapshot).toEqual(freshSnapshot);
	expect(cachedSnapshot).toEqual(freshSnapshot);
});

test('redirects to welcome when neither parent loaderData nor fresh cache has the workspace', async () => {
	Reflect.deleteProperty(globalThis, 'window');
	const queryClient = new QueryClient();
	const loaderData = await loadWorkbenchRouteData(queryClient);

	try {
		await loadWorkspaceWorkbenchRoute({
			parentMatchPromise: Promise.resolve({ loaderData }),
			params: {
				projectId: 'missing-project',
				workspaceId: 'missing-workspace',
			},
			queryClient,
			rawSearch: {},
			search: normalizeWorkbenchSearch({}),
		});
	} catch (error) {
		if (isRedirect(error)) {
			expect(error.options).toMatchObject({
				replace: true,
				to: '/',
			});

			return;
		}

		throw error;
	}

	throw new Error('Expected workspace route loader to redirect.');
});

test('shell pass-through feeds workbench data to descendant loaders', async () => {
	Reflect.deleteProperty(globalThis, 'window');
	const queryClient = new QueryClient();
	const loaderData = await loadWorkbenchRouteData(queryClient);
	const shellData = await loadShellWorkbenchRoute({
		parentMatchPromise: Promise.resolve({ loaderData }),
	});

	expect(shellData).toBe(loaderData);

	try {
		await loadProjectWorkbenchRoute({
			parentMatchPromise: Promise.resolve({ loaderData: shellData }),
			params: {
				projectId: 'missing-project',
			},
			queryClient,
		});
	} catch (error) {
		if (isRedirect(error)) {
			expect(error.options).toMatchObject({
				to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
			});

			return;
		}

		throw error;
	}

	throw new Error('Expected project route loader to redirect.');
});
