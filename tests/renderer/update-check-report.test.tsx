// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useMenuCommandBridge } from '@/renderer/state/menu-commands';
import { navigationSidebarVisibleAtom } from '@/renderer/state/sidebar';
import { useUpdateSync } from '@/renderer/state/updates';
import type {
	UpdateState,
	UpdateStatusSnapshot,
} from '@/shared/ipc/contracts/update';
import type { MenuCommandBroadcast, MenuContext } from '@/shared/menu-commands';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const { checkForUpdates, installUpdate } = vi.hoisted(() => ({
	checkForUpdates: vi.fn(),
	installUpdate: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/renderer/api/ensemblr')>()),
	checkForUpdates,
	installUpdate,
	readUpdateStatus: () => Promise.resolve(null),
	subscribeUpdateStatusChanged: () => () => undefined,
}));

/** One toast the code under test raised, reduced to what a test asserts on. */
interface RaisedToast {
	action: string | null;
	kind: 'error' | 'info' | 'success';
	press: (() => void) | null;
}

let raised: RaisedToast[] = [];

/** Records a toast instead of rendering one, keeping its action pressable. */
function record(kind: RaisedToast['kind']) {
	return (
		_message: string,
		options?: { action?: { label: string; onClick: () => void } },
	) => {
		raised = [
			...raised,
			{
				action: options?.action?.label ?? null,
				kind,
				press: options?.action?.onClick ?? null,
			},
		];
	};
}

vi.mock('sonner', () => ({
	toast: {
		error: record('error'),
		info: record('info'),
		success: record('success'),
	},
}));

type MenuCommandListener = (payload: MenuCommandBroadcast) => void;

let listeners: MenuCommandListener[] = [];
const openExternal = vi.fn();

/** Builds a snapshot carrying an offered version unless a test drops it. */
function snapshot(
	state: UpdateState,
	overrides: Partial<UpdateStatusSnapshot> = {},
): UpdateStatusSnapshot {
	return {
		availableVersion: '0.1.0-beta.23',
		channel: 'release',
		currentVersion: '0.1.0-beta.22',
		failure: null,
		notes: null,
		releaseUrl: 'https://example.invalid/releases/0.1.0-beta.23',
		state,
		...overrides,
	};
}

/** Hosts the root-level sync under test behind the real menu-command bridge. */
function Host() {
	useMenuCommandBridge();
	useUpdateSync();
	return null;
}

/**
 * Mounts the sync with the sidebar reported as visible or not, and returns a
 * way to pick the "Check for Updates…" menu item the way the native menu does.
 */
function mountSync(sidebarVisible: boolean) {
	const store = createStore();
	store.set(navigationSidebarVisibleAtom, sidebarVisible);
	renderWithProviders(
		<Provider store={store}>
			<Host />
		</Provider>,
	);

	return async () => {
		await act(async () => {
			for (const listener of listeners) {
				listener({ command: 'app.checkForUpdates' });
			}
			await Promise.resolve();
		});
	};
}

beforeEach(() => {
	raised = [];
	listeners = [];
	checkForUpdates.mockReset();
	installUpdate.mockReset();
	openExternal.mockReset();
	installEnsemblrApi({
		onMenuCommand: (listener: MenuCommandListener) => {
			listeners = [...listeners, listener];
			return () => {
				listeners = listeners.filter((candidate) => candidate !== listener);
			};
		},
		openExternal,
		reportMenuContext: (_context: MenuContext) => Promise.resolve(),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('the update check the user asks for', () => {
	test('stays quiet when the sidebar panel is on screen to answer', async () => {
		checkForUpdates.mockResolvedValue(snapshot('ready'));
		const check = mountSync(true);

		await check();

		expect(raised).toEqual([]);
	});

	test('answers with the restart when the sidebar is collapsed', async () => {
		checkForUpdates.mockResolvedValue(snapshot('ready'));
		installUpdate.mockResolvedValue(snapshot('ready'));
		const check = mountSync(false);

		await check();

		expect(raised).toHaveLength(1);
		expect(raised[0]?.kind).toBe('success');
		await act(async () => {
			raised[0]?.press?.();
			await Promise.resolve();
		});
		expect(installUpdate).toHaveBeenCalledTimes(1);
	});

	test('offers the release page a check-only build cannot download itself', async () => {
		checkForUpdates.mockResolvedValue(snapshot('available'));
		const check = mountSync(false);

		await check();

		expect(raised).toHaveLength(1);
		expect(raised[0]?.kind).toBe('info');
		raised[0]?.press?.();
		expect(openExternal).toHaveBeenCalledWith(
			'https://example.invalid/releases/0.1.0-beta.23',
		);
	});

	test('names no release page when the feed gave none', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('available', { releaseUrl: null }),
		);
		const check = mountSync(false);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'info' }]);
	});

	test('reports a download already in flight', async () => {
		checkForUpdates.mockResolvedValue(snapshot('downloading'));
		const check = mountSync(false);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'info' }]);
	});

	test('reports a check that was already running', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('checking', { availableVersion: null, releaseUrl: null }),
		);
		const check = mountSync(true);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'info' }]);
	});

	test('reports a build that can never update at all', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('unsupported', {
				availableVersion: null,
				failure: {
					code: 'update-not-in-applications',
					message: 'Ensemblr is not running from /Applications.',
				},
				releaseUrl: null,
			}),
		);
		const check = mountSync(true);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'error' }]);
	});

	test('leaves a failed download to the panel that is showing it', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('error', {
				failure: { code: 'update-download-failed', message: 'socket hang up' },
			}),
		);
		const check = mountSync(true);

		await check();

		expect(raised).toEqual([]);
	});

	test('reports being up to date even with the sidebar open', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('idle', { availableVersion: null, releaseUrl: null }),
		);
		const check = mountSync(true);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'success' }]);
	});

	test('reports a failed check the panel would never raise', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('error', {
				availableVersion: null,
				failure: {
					code: 'update-feed-unreachable',
					message: 'no route to host',
				},
				releaseUrl: null,
			}),
		);
		const check = mountSync(true);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'error' }]);
	});

	test('reports updates being switched off, which no panel ever shows', async () => {
		checkForUpdates.mockResolvedValue(
			snapshot('disabled', { availableVersion: null, releaseUrl: null }),
		);
		const check = mountSync(true);

		await check();

		expect(raised).toMatchObject([{ action: null, kind: 'info' }]);
	});
});
