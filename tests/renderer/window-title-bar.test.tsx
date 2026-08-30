// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { WindowTitleBar } from '../../src/renderer/components/workbench-shell/window-controls';
import type { WindowMaximizedBroadcast } from '../../src/shared/ipc/contracts/repository-navigation';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

type MaximizedListener = (payload: WindowMaximizedBroadcast) => void;

/** Installs a bridge whose broadcast can be fired by hand, plus the toggle spy. */
function installWindowBridge() {
	const listeners = new Set<MaximizedListener>();
	const toggleMaximizeWindow = vi.fn(async () => undefined);

	installEnsemblrApi({
		closeWindow: vi.fn(async () => undefined),
		minimizeWindow: vi.fn(async () => undefined),
		onWindowMaximizedChanged: (listener: MaximizedListener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		toggleMaximizeWindow,
	});

	return {
		broadcast: (maximized: boolean) => {
			for (const listener of listeners) {
				listener({ maximized });
			}
		},
		toggleMaximizeWindow,
	};
}

/** Writes the bootstrap snapshot the maximized state seeds itself from. */
function seedShellSnapshot(maximized: boolean): void {
	(
		window as unknown as { ensemblrInitialShellSnapshot?: unknown }
	).ensemblrInitialShellSnapshot = { maximized };
}

afterEach(() => {
	clearEnsemblrApi();
	(
		window as unknown as { ensemblrInitialShellSnapshot?: unknown }
	).ensemblrInitialShellSnapshot = undefined;
	document.body.style.removeProperty('pointer-events');
});

test('mounts the strip ahead of the app so it outranks a body-portalled overlay', () => {
	const { container } = renderWithProviders(<WindowTitleBar />);

	const group = screen.getByRole('group', { name: 'Window controls' });

	expect(container).not.toContainElement(group);
	expect(document.body.firstElementChild).toContainElement(group);
});

test('draws the strip as a drag region so no toolbar below reserves room for it', () => {
	renderWithProviders(<WindowTitleBar />);

	const strip = screen
		.getByRole('group', { name: 'Window controls' })
		.closest('.window-title-bar');

	expect(strip).not.toBeNull();
	expect(strip?.parentElement).toHaveClass('fixed');
	expect(strip?.parentElement).toHaveClass('top-0');
});

test('stays clickable while a modal has nulled pointer events on the body', () => {
	renderWithProviders(<WindowTitleBar />);
	document.body.style.pointerEvents = 'none';

	const overlay = screen
		.getByRole('group', { name: 'Window controls' })
		.closest('.window-title-bar')?.parentElement;

	expect(overlay).toHaveClass('pointer-events-auto');
	expect(overlay).toHaveClass('z-100');
});

test('seeds the maximized state from the bootstrap snapshot', () => {
	seedShellSnapshot(true);

	renderWithProviders(<WindowTitleBar />);

	expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
});

test('leaves the label to the broadcast rather than to its own click', async () => {
	const bridge = installWindowBridge();
	renderWithProviders(<WindowTitleBar />);

	fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));

	expect(bridge.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
	expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();

	bridge.broadcast(true);

	expect(
		await screen.findByRole('button', { name: 'Restore' }),
	).toBeInTheDocument();
});

test('removes its host element from the body on unmount', () => {
	const { unmount } = renderWithProviders(<WindowTitleBar />);

	expect(document.querySelector('[data-window-title-bar]')).not.toBeNull();

	unmount();

	expect(document.querySelector('[data-window-title-bar]')).toBeNull();
});
