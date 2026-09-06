// @vitest-environment happy-dom

import { act, fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test, vi } from 'vitest';

import {
	SidebarUpdatePanel,
	UpdatePanel,
} from '../../src/renderer/components/workbench-shell/navigation-sidebar/update-panel';
import {
	resolveUpdatePanelKind,
	type UpdatePanelKind,
	updateStatusAtom,
} from '../../src/renderer/state/updates';
import type {
	UpdateState,
	UpdateStatusSnapshot,
} from '../../src/shared/ipc/contracts/update';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

/**
 * Builds a snapshot carrying an offered version, which is what most states the
 * panel renders have in common.
 */
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

/** Renders the panel with inert updater actions unless a test supplies its own. */
function renderPanel(
	value: UpdateStatusSnapshot,
	overrides: Partial<Parameters<typeof UpdatePanel>[0]> = {},
) {
	const kind = resolveUpdatePanelKind(value);
	if (!kind) {
		throw new Error(
			`${value.state} renders no panel; drive the wrapper instead`,
		);
	}
	return renderWithProviders(
		<UpdatePanel
			actions={{
				check: () => Promise.resolve(),
				install: () => Promise.resolve(),
			}}
			kind={kind}
			onOpenRelease={() => undefined}
			snapshot={value}
			{...overrides}
		/>,
	);
}

/** Mounts the wired wrapper over a store the test seeds and then advances. */
function renderWiredPanel(value: UpdateStatusSnapshot | null) {
	const store = createStore();
	store.set(updateStatusAtom, value);
	const result = renderWithProviders(
		<Provider store={store}>
			<SidebarUpdatePanel />
		</Provider>,
	);
	return {
		...result,
		advance: (next: UpdateStatusSnapshot | null) => {
			act(() => store.set(updateStatusAtom, next));
		},
	};
}

/** Reads the shape the panel says it is rendering, or null when it renders none. */
function shownKind(container: HTMLElement): UpdatePanelKind | null {
	const panel = container.querySelector('[data-sidebar-update-panel]');
	return (panel?.getAttribute('data-sidebar-update-panel') ??
		null) as UpdatePanelKind | null;
}

describe('resolveUpdatePanelKind', () => {
	test('pins a panel for every state that names a version the user lacks', () => {
		expect(resolveUpdatePanelKind(snapshot('ready'))).toBe('ready');
		expect(resolveUpdatePanelKind(snapshot('downloading'))).toBe('downloading');
		expect(resolveUpdatePanelKind(snapshot('available'))).toBe('available');
	});

	test('keeps the panel for an error on an update already offered', () => {
		const failed = snapshot('error', {
			failure: { code: 'update-download-failed', message: 'socket hang up' },
		});

		expect(resolveUpdatePanelKind(failed)).toBe('failed');
	});

	test('stays out of every state the user cannot act on', () => {
		expect(resolveUpdatePanelKind(null)).toBeNull();
		expect(
			resolveUpdatePanelKind(snapshot('idle', { availableVersion: null })),
		).toBeNull();
		expect(
			resolveUpdatePanelKind(snapshot('disabled', { availableVersion: null })),
		).toBeNull();
		expect(
			resolveUpdatePanelKind(
				snapshot('unsupported', { availableVersion: null }),
			),
		).toBeNull();
		expect(
			resolveUpdatePanelKind(
				snapshot('error', {
					availableVersion: null,
					failure: {
						code: 'update-feed-unreachable',
						message: 'no route to host',
					},
				}),
			),
		).toBeNull();
	});

	test('never headlines a state that carries no version of its own', () => {
		expect(
			resolveUpdatePanelKind(
				snapshot('downloading', { availableVersion: null }),
			),
		).toBeNull();
		expect(
			resolveUpdatePanelKind(snapshot('available', { availableVersion: null })),
		).toBeNull();
	});

	test('reports no shape while a check is in flight', () => {
		expect(resolveUpdatePanelKind(snapshot('checking'))).toBeNull();
	});
});

describe('UpdatePanel', () => {
	test('names the staged version and offers the restart', () => {
		renderPanel(snapshot('ready'));

		expect(screen.getByText(/0\.1\.0-beta\.23 is ready/)).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: /restart to update/i }),
		).toBeInTheDocument();
	});

	test('carries no dismiss or opt-out control in any state it renders', () => {
		for (const state of ['ready', 'downloading', 'available'] as const) {
			const { container, unmount } = renderPanel(snapshot(state));

			expect(container.querySelector('[data-sidebar-update-panel]')).not.toBe(
				null,
			);
			expect(
				screen.queryByRole('button', {
					name: /dismiss|close|later|not now|turn off/i,
				}),
			).toBeNull();
			unmount();
		}
	});

	test('reports a download in flight without offering an action', () => {
		renderPanel(snapshot('downloading'));

		expect(
			screen.getByText(/downloading ensemblr 0\.1\.0-beta\.23/i),
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /restart to update/i }),
		).toBeNull();
	});

	test('sends a check-only build to the release page', () => {
		const onOpenRelease = vi.fn();
		renderPanel(snapshot('available'), { onOpenRelease });

		fireEvent.click(screen.getByRole('button', { name: /release page/i }));

		expect(onOpenRelease).toHaveBeenCalledWith(
			'https://example.invalid/releases/0.1.0-beta.23',
		);
	});

	test('retries a failed download and shows the coded reason', () => {
		const check = vi.fn(() => Promise.resolve());
		renderPanel(
			snapshot('error', {
				failure: {
					code: 'update-download-failed',
					message: 'The update could not be downloaded: socket hang up',
				},
			}),
			{ actions: { check, install: () => Promise.resolve() } },
		);

		expect(
			screen.getByText(/0\.1\.0-beta\.23 did not download/),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /try again/i }));

		expect(check).toHaveBeenCalledTimes(1);
	});

	test('offers the release page beside the retry, so a failure is not a dead end', () => {
		const onOpenRelease = vi.fn();
		renderPanel(
			snapshot('error', {
				failure: {
					code: 'update-download-failed',
					message: 'The update could not be downloaded: socket hang up',
				},
			}),
			{ onOpenRelease },
		);

		fireEvent.click(screen.getByRole('button', { name: /release page/i }));

		expect(onOpenRelease).toHaveBeenCalledWith(
			'https://example.invalid/releases/0.1.0-beta.23',
		);
	});

	test('drops the release link when the feed named no page', () => {
		renderPanel(
			snapshot('error', {
				failure: { code: 'update-download-failed', message: 'socket hang up' },
				releaseUrl: null,
			}),
		);

		expect(screen.queryByRole('button', { name: /release page/i })).toBeNull();
		expect(
			screen.getByRole('button', { name: /try again/i }),
		).toBeInTheDocument();
	});

	test('installs on the restart button', () => {
		const install = vi.fn(() => Promise.resolve());
		renderPanel(snapshot('ready'), {
			actions: { check: () => Promise.resolve(), install },
		});

		fireEvent.click(screen.getByRole('button', { name: /restart to update/i }));

		expect(install).toHaveBeenCalledTimes(1);
	});
});

describe('SidebarUpdatePanel', () => {
	test('shows nothing before the first snapshot lands', () => {
		const { container } = renderWiredPanel(null);

		expect(shownKind(container)).toBeNull();
	});

	test('renders nothing once the update is installed', () => {
		const { container } = renderWiredPanel(
			snapshot('idle', { availableVersion: null, releaseUrl: null }),
		);

		expect(shownKind(container)).toBeNull();
	});

	test('renders nothing once updates are switched off', () => {
		const { container } = renderWiredPanel(
			snapshot('disabled', { availableVersion: null, releaseUrl: null }),
		);

		expect(shownKind(container)).toBeNull();
	});

	test('keeps a live region mounted so the panel is announced when it arrives', () => {
		const { container } = renderWiredPanel(
			snapshot('idle', { availableVersion: null, releaseUrl: null }),
		);

		expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
	});

	test('holds the panel still while a re-check is in flight', () => {
		const failed = snapshot('error', {
			failure: { code: 'update-download-failed', message: 'socket hang up' },
		});
		const { advance, container } = renderWiredPanel(failed);
		expect(shownKind(container)).toBe('failed');

		advance(snapshot('checking'));

		expect(shownKind(container)).toBe('failed');
	});

	test('takes the shape the finished check landed on', () => {
		const { advance, container } = renderWiredPanel(snapshot('available'));

		advance(snapshot('checking'));
		advance(snapshot('downloading'));

		expect(shownKind(container)).toBe('downloading');
	});

	test('does not resurrect a retracted offer on the next check', () => {
		const { advance, container } = renderWiredPanel(snapshot('available'));

		advance(snapshot('disabled', { availableVersion: null, releaseUrl: null }));
		advance(snapshot('checking', { availableVersion: null, releaseUrl: null }));

		expect(shownKind(container)).toBeNull();
	});

	test('opens the release page through the bridge', () => {
		const openExternal = vi.fn();
		installEnsemblrApi({ openExternal });
		try {
			renderWiredPanel(snapshot('available'));

			fireEvent.click(screen.getByRole('button', { name: /release page/i }));

			expect(openExternal).toHaveBeenCalledWith(
				'https://example.invalid/releases/0.1.0-beta.23',
			);
		} finally {
			clearEnsemblrApi();
		}
	});
});
