import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';

import { normalizeWorkbenchSearch } from '../../src/renderer/lib/workbench';
import {
	loadProjectWorkbenchRoute,
	loadShellWorkbenchRoute,
	loadWorkbenchRouteData,
	loadWorkspaceChatRoute,
	loadWorkspaceIndexRoute,
	loadWorkspaceWorkbenchRoute,
} from '../../src/renderer/routing/workbench-route-loaders';
import type { WorkspaceRouteLoaderData } from '../../src/renderer/types/routing';

async function catchProjectRouteRedirect({
	params,
}: {
	params: {
		projectId: string;
	};
}) {
	Reflect.deleteProperty(globalThis, 'window');
	const loaderData = await loadWorkbenchRouteData(new QueryClient());

	try {
		await loadProjectWorkbenchRoute({
			parentMatchPromise: Promise.resolve({ loaderData }),
			params,
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

async function loadDefaultWorkspaceRouteData(): Promise<WorkspaceRouteLoaderData> {
	Reflect.deleteProperty(globalThis, 'window');
	const loaderData = await loadWorkbenchRouteData(new QueryClient());
	const workspaceData = await loadWorkspaceWorkbenchRoute({
		parentMatchPromise: Promise.resolve({ loaderData }),
		params: {
			projectId: 'ensemble',
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
				projectId: 'ensemble',
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
			projectId: 'ensemble',
			workspaceId: 'san-antonio',
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('redirects invalid workspace routes to the default workspace URL', async () => {
	const redirectOptions = await catchWorkspaceRouteRedirect({
		params: {
			projectId: 'missing-project',
			workspaceId: 'missing-workspace',
		},
	});

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'review-shell',
			projectId: 'ensemble',
			workspaceId: 'san-antonio',
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('redirects legacy workspace chat search params to the chat route', async () => {
	const redirectOptions = await catchWorkspaceRouteRedirect({
		params: {
			projectId: 'ensemble',
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
			projectId: 'ensemble',
			workspaceId: 'san-antonio',
		},
		replace: true,
		search: {
			dock: 'terminal:default',
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
			projectId: 'ensemble',
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

	await expect(
		loadWorkspaceChatRoute({
			parentMatchPromise: Promise.resolve({ loaderData: workspaceData }),
			params: {
				chatId: 'review-shell',
				projectId: 'ensemble',
				workspaceId: 'san-antonio',
			},
			rawSearch: {
				dock: 'terminal:default',
			},
			search: normalizeWorkbenchSearch({
				dock: 'terminal:default',
			}),
		}),
	).resolves.toBeUndefined();
});

test('redirects invalid typed chat route params to the default chat', async () => {
	const redirectOptions = await catchWorkspaceChatRouteRedirect({
		params: {
			chatId: 'missing-session',
			projectId: 'ensemble',
			workspaceId: 'san-antonio',
		},
		rawSearch: {
			dock: 'terminal',
		},
	});

	expect(redirectOptions).toMatchObject({
		params: {
			chatId: 'review-shell',
			projectId: 'ensemble',
			workspaceId: 'san-antonio',
		},
		replace: true,
		search: {
			dock: 'terminal:default',
		},
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('shell pass-through feeds workbench data to descendant loaders', async () => {
	Reflect.deleteProperty(globalThis, 'window');
	const loaderData = await loadWorkbenchRouteData(new QueryClient());
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
