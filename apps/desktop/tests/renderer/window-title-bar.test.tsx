// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { WindowTitleBar } from '../../src/renderer/components/workbench-shell/window-controls';
import type { WindowMaximizedBroadcast } from '../../src/shared/ipc/contracts/repository-navigation';
import type { MenuBarDescriptor } from '../../src/shared/menu-bar';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

type MaximizedListener = (payload: WindowMaximizedBroadcast) => void;
type MenuBarListener = (payload: MenuBarDescriptor) => void;

/** One menu with one row, enough to prove the strip mounts the bar it is given. */
const MENU_BAR: MenuBarDescriptor = {
	menus: [
		{
			enabled: true,
			id: '0',
			items: [
				{ enabled: true, id: '0.0', kind: 'action', label: 'New Workspace' },
			],
			kind: 'submenu',
			label: 'File',
		},
	],
	revision: 4,
};

/** Installs a bridge whose broadcasts can be fired by hand, plus the spies. */
function installWindowBridge({
	menuBar = { menus: [], revision: 0 },
}: {
	menuBar?: MenuBarDescriptor;
} = {}) {
	const listeners = new Set<MaximizedListener>();
	const menuBarListeners = new Set<MenuBarListener>();
	const toggleMaximizeWindow = vi.fn(async () => undefined);
	const invokeMenuBarItem = vi.fn(async () => undefined);

	installEnsemblrApi({
		closeWindow: vi.fn(async () => undefined),
		getMenuBar: vi.fn(async () => menuBar),
		invokeMenuBarItem,
		minimizeWindow: vi.fn(async () => undefined),
		onMenuBarChanged: (listener: MenuBarListener) => {
			menuBarListeners.add(listener);
			return () => menuBarListeners.delete(listener);
		},
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
		invokeMenuBarItem,
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

test('mounts the menu bar main sent inside the strip', async () => {
	installWindowBridge({ menuBar: MENU_BAR });
	renderWithProviders(<WindowTitleBar />);

	const bar = await screen.findByRole('menubar', { name: 'Application menu' });

	expect(bar.closest('.window-title-bar')).not.toBeNull();
	expect(screen.getByRole('menuitem', { name: 'File' })).toBeInTheDocument();
});

test('reports a picked row against the revision it was drawn from', async () => {
	const bridge = installWindowBridge({ menuBar: MENU_BAR });
	renderWithProviders(<WindowTitleBar />);

	await userEvent.click(await screen.findByRole('menuitem', { name: 'File' }));
	await userEvent.click(
		await screen.findByRole('menuitem', { name: 'New Workspace' }),
	);

	expect(bridge.invokeMenuBarItem).toHaveBeenCalledWith({
		id: '0.0',
		revision: 4,
	});
});

test('leaves the strip as it was when main has no menu to draw', async () => {
	installWindowBridge();
	renderWithProviders(<WindowTitleBar />);

	expect(
		await screen.findByRole('group', { name: 'Window controls' }),
	).toBeInTheDocument();
	expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
});

test('removes its host element from the body on unmount', () => {
	const { unmount } = renderWithProviders(<WindowTitleBar />);

	expect(document.querySelector('[data-window-title-bar]')).not.toBeNull();

	unmount();

	expect(document.querySelector('[data-window-title-bar]')).toBeNull();
});
