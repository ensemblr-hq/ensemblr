import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
	app: { showAboutPanel: () => undefined },
	BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}));

const { describeMenuBar } = await import(
	'../../src/main/menu/menu-bar-descriptor'
);
const { createMenuItemFactory, toElectronTemplate } = await import(
	'../../src/main/menu/menu-item'
);

import type { DescribedMenuItem } from '../../src/main/menu/menu-item';
import type {
	MenuBarAction,
	MenuBarNode,
	MenuBarSubmenu,
} from '../../src/shared/menu-bar';
import type { MenuContext } from '../../src/shared/menu-commands';

/** Builds a menu context, overriding only the groups a test cares about. */
function context(overrides: Partial<MenuContext> = {}): MenuContext {
	return {
		chatTabs: [],
		checked: [],
		commands: [],
		openTargets: [],
		recentProjects: [],
		runScripts: [],
		...overrides,
	};
}

/** Wraps items in one top-level menu, which is the only shape the bar accepts. */
function oneMenu(items: DescribedMenuItem[]): DescribedMenuItem[] {
	return [{ label: 'Test', submenu: items }];
}

/** Reads the rows of the first menu of a serialized bar. */
function rowsOf(template: DescribedMenuItem[]): readonly MenuBarNode[] {
	return describeMenuBar(template, 1).descriptor.menus[0]?.items ?? [];
}

/** Narrows a row to a chooseable one, failing the test when it is not. */
function actionAt(rows: readonly MenuBarNode[], index: number): MenuBarAction {
	const row = rows[index];
	if (row?.kind !== 'action') {
		throw new Error(`row ${index} is ${row?.kind ?? 'missing'}, not an action`);
	}
	return row;
}

/** Narrows a row to a submenu, failing the test when it is not. */
function submenuAt(
	rows: readonly MenuBarNode[],
	index: number,
): MenuBarSubmenu {
	const row = rows[index];
	if (row?.kind !== 'submenu') {
		throw new Error(`row ${index} is ${row?.kind ?? 'missing'}, not a submenu`);
	}
	return row;
}

describe('toElectronTemplate', () => {
	test('strips the dispatch annotation Electron has no use for', () => {
		const items = createMenuItemFactory(null);
		const [menu] = toElectronTemplate(
			oneMenu([items.command('tab.close', 'Close Tab')]),
		);
		const submenu = menu?.submenu as DescribedMenuItem[];

		expect(submenu[0]).not.toHaveProperty('dispatch');
		expect(submenu[0]?.label).toBe('Close Tab');
		expect(typeof submenu[0]?.click).toBe('function');
	});

	test('leaves the annotated tree intact for the drawn bar to read', () => {
		const items = createMenuItemFactory(null);
		const template = oneMenu([items.command('tab.close', 'Close Tab')]);

		toElectronTemplate(template);

		expect(template[0]?.submenu?.[0]?.dispatch).toEqual({
			command: 'tab.close',
		});
	});
});

describe('describeMenuBar', () => {
	test('only top-level submenus become menus of the bar', () => {
		const items = createMenuItemFactory(null);
		const { descriptor } = describeMenuBar(
			[
				{ label: 'Loose Item', role: 'undo' },
				...oneMenu([items.command('tab.close', 'Close Tab')]),
			],
			7,
		);

		expect(descriptor.revision).toBe(7);
		expect(descriptor.menus.map((menu) => menu.label)).toEqual(['Test']);
	});

	test('a command row resolves to the command it dispatches', () => {
		const items = createMenuItemFactory(null);
		const { descriptor, invocations } = describeMenuBar(
			oneMenu([items.command('review.review', 'Review')]),
			1,
		);
		const row = actionAt(descriptor.menus[0]?.items ?? [], 0);

		expect(invocations.get(row.id)).toEqual({
			dispatch: { command: 'review.review' },
			kind: 'command',
		});
	});

	test('a dynamic entry carries its own arg back', () => {
		const items = createMenuItemFactory(
			context({
				commands: ['run.script'],
				runScripts: [{ id: 'dev', label: 'Dev Server' }],
			}),
		);
		const { descriptor, invocations } = describeMenuBar(
			oneMenu([
				items.submenu(
					'run.script',
					'Run Script',
					[{ id: 'dev', label: 'Dev Server' }],
					'None',
				),
			]),
			1,
		);
		const entry = actionAt(
			submenuAt(descriptor.menus[0]?.items ?? [], 0).items,
			0,
		);

		expect(invocations.get(entry.id)).toEqual({
			dispatch: { arg: 'dev', command: 'run.script' },
			kind: 'command',
		});
	});

	test('a role the drawn bar performs resolves to that role', () => {
		const { descriptor, invocations } = describeMenuBar(
			oneMenu([{ label: 'Undo', role: 'undo' }]),
			1,
		);
		const row = actionAt(descriptor.menus[0]?.items ?? [], 0);

		expect(invocations.get(row.id)).toEqual({ kind: 'role', role: 'undo' });
		expect(row.accelerator).toBe('Ctrl+Z');
	});

	test('a macOS-owned role renders inert rather than clickable', () => {
		const { descriptor, invocations } = describeMenuBar(
			oneMenu([{ label: 'Paste and Match Style', role: 'pasteAndMatchStyle' }]),
			1,
		);
		const row = actionAt(descriptor.menus[0]?.items ?? [], 0);

		expect(row.enabled).toBe(false);
		expect(invocations.has(row.id)).toBe(false);
	});

	test('an unlabelled row is dropped, since there is nothing to draw', () => {
		const { descriptor } = describeMenuBar(oneMenu([{ role: 'services' }]), 1);

		expect(descriptor.menus[0]?.items).toEqual([]);
	});

	test('the placeholder of an empty dynamic submenu survives, disabled', () => {
		const items = createMenuItemFactory(null);
		const placeholder = actionAt(
			submenuAt(
				rowsOf(
					oneMenu([
						items.submenu('run.script', 'Run Script', [], 'No Run Scripts'),
					]),
				),
				0,
			).items,
			0,
		);

		expect(placeholder.label).toBe('No Run Scripts');
		expect(placeholder.enabled).toBe(false);
	});

	test('marks and their checked state come through', () => {
		const items = createMenuItemFactory(
			context({ checked: ['layout.toggleSidebar'], commands: [] }),
		);
		const rows = rowsOf(
			oneMenu([
				items.command('layout.toggleSidebar', 'Sidebar', { checkbox: true }),
				items.command('theme.dark', 'Dark', { radio: true }),
				items.command('review.review', 'Review'),
			]),
		);

		expect(actionAt(rows, 0).mark).toBe('checkbox');
		expect(actionAt(rows, 0).checked).toBe(true);
		expect(actionAt(rows, 1).mark).toBe('radio');
		expect(actionAt(rows, 1).checked).toBe(false);
		expect(actionAt(rows, 2).mark).toBeUndefined();
		expect(actionAt(rows, 2).checked).toBeUndefined();
	});

	test('a row the renderer did not report is drawn disabled', () => {
		const items = createMenuItemFactory(context({ commands: ['tab.close'] }));
		const rows = rowsOf(
			oneMenu([
				items.command('tab.close', 'Close Tab'),
				items.command('review.review', 'Review'),
			]),
		);

		expect(actionAt(rows, 0).enabled).toBe(true);
		expect(actionAt(rows, 1).enabled).toBe(false);
	});

	test('only a command that owns its chord shows one', () => {
		const items = createMenuItemFactory(null);
		const rows = rowsOf(
			oneMenu([
				items.command('tab.close', 'Close Tab'),
				items.command('composer.focus', 'Focus Composer'),
			]),
		);

		expect(actionAt(rows, 0).accelerator).toBeTruthy();
		expect(actionAt(rows, 1).accelerator).toBeUndefined();
	});

	test('separators are kept in place and carry a key of their own', () => {
		const items = createMenuItemFactory(null);
		const rows = rowsOf(
			oneMenu([
				items.command('tab.close', 'Close Tab'),
				{ type: 'separator' },
				items.command('review.review', 'Review'),
			]),
		);

		expect(rows.map((row) => row.kind)).toEqual([
			'action',
			'separator',
			'action',
		]);
		expect(new Set(rows.map((row) => row.id)).size).toBe(3);
	});

	test('row ids are unique across the whole bar', () => {
		const items = createMenuItemFactory(null);
		const { invocations } = describeMenuBar(
			[
				...oneMenu([items.command('tab.close', 'Close Tab')]),
				...oneMenu([items.command('review.review', 'Review')]),
			],
			1,
		);

		expect(invocations.size).toBe(2);
	});
});
