import { describe, expect, test, vi } from 'vitest';

const sentWebContents = vi.fn();
const undo = vi.fn();

const fakeWindow = {
	isDestroyed: () => false,
	isMaximized: () => false,
	maximize: vi.fn(),
	unmaximize: vi.fn(),
	webContents: { undo },
};

vi.mock('electron', () => ({
	app: { showAboutPanel: vi.fn() },
	BrowserWindow: {
		getAllWindows: () => [{ webContents: { send: sentWebContents } }],
		getFocusedWindow: () => ({ webContents: { send: sentWebContents } }),
	},
}));

const { MenuBarStore } = await import('../../src/main/menu/menu-bar-store');
const { createMenuItemFactory } = await import('../../src/main/menu/menu-item');

import type { DescribedMenuItem } from '../../src/main/menu/menu-item';
import type { MenuBarAction } from '../../src/shared/menu-bar';

/** Wraps items in one top-level menu, which is the only shape the bar accepts. */
function oneMenu(items: DescribedMenuItem[]): DescribedMenuItem[] {
	return [{ label: 'Test', submenu: items }];
}

/** Reads the first chooseable row of a stored bar. */
function firstAction(store: InstanceType<typeof MenuBarStore>): MenuBarAction {
	const row = store.current.menus[0]?.items[0];
	if (row?.kind !== 'action') {
		throw new Error('expected the first row to be an action');
	}
	return row;
}

describe('MenuBarStore', () => {
	test('starts empty, so a window before the first build paints nothing', () => {
		expect(new MenuBarStore().current).toEqual({ menus: [], revision: 0 });
	});

	test('every apply mints a new revision', () => {
		const store = new MenuBarStore();
		const items = createMenuItemFactory(null);
		const template = oneMenu([items.command('tab.close', 'Close Tab')]);

		expect(store.apply(template).revision).toBe(1);
		expect(store.apply(template).revision).toBe(2);
	});

	test('a command row is dispatched to the renderer', () => {
		sentWebContents.mockClear();
		const store = new MenuBarStore();
		const items = createMenuItemFactory(null);
		store.apply(oneMenu([items.command('review.review', 'Review')]));

		store.invoke(
			{ id: firstAction(store).id, revision: store.current.revision },
			null,
		);

		expect(sentWebContents).toHaveBeenCalledWith(
			'ensemblr:menu-command',
			expect.objectContaining({ command: 'review.review' }),
		);
	});

	test('a role row is performed against the window that reported it', () => {
		undo.mockClear();
		const store = new MenuBarStore();
		store.apply(oneMenu([{ label: 'Undo', role: 'undo' }]));

		store.invoke(
			{ id: firstAction(store).id, revision: store.current.revision },
			fakeWindow as never,
		);

		expect(undo).toHaveBeenCalledTimes(1);
	});

	test('a row addressed against a superseded bar is dropped', () => {
		sentWebContents.mockClear();
		const store = new MenuBarStore();
		const items = createMenuItemFactory(null);
		store.apply(oneMenu([items.command('review.review', 'Review')]));
		const stale = {
			id: firstAction(store).id,
			revision: store.current.revision,
		};
		store.apply(oneMenu([items.command('tab.close', 'Close Tab')]));

		store.invoke(stale, null);

		expect(sentWebContents).not.toHaveBeenCalled();
	});

	test('an unknown row id is dropped rather than throwing', () => {
		sentWebContents.mockClear();
		const store = new MenuBarStore();
		const items = createMenuItemFactory(null);
		store.apply(oneMenu([items.command('review.review', 'Review')]));

		expect(() =>
			store.invoke({ id: '9.9.9', revision: store.current.revision }, null),
		).not.toThrow();
		expect(sentWebContents).not.toHaveBeenCalled();
	});
});
