import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
	BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}));

const { createMenuItemFactory } = await import('../../src/main/menu/menu-item');
const { buildWorkspaceMenu } = await import(
	'../../src/main/menu/workspace-menu'
);
const { menuLabels } = await import('../../src/main/menu/menu-strings');
const { getAccelerator } = await import('../../src/shared/keymap/matcher');

import type { MenuContext } from '../../src/shared/menu-commands';

const LABELS = menuLabels('en', 'Ensemblr');

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

/** Reads a submenu as a plain array, which is the only form this factory emits. */
function submenuOf(
	item: MenuItemConstructorOptions | undefined,
): MenuItemConstructorOptions[] {
	return (item?.submenu ?? []) as MenuItemConstructorOptions[];
}

/** Finds one item of a built menu by its label. */
function itemLabelled(
	menu: MenuItemConstructorOptions,
	label: string,
): MenuItemConstructorOptions | undefined {
	return submenuOf(menu).find((item) => item.label === label);
}

describe('createMenuItemFactory', () => {
	test('a null context enables every item, so launch keeps its accelerators', () => {
		const items = createMenuItemFactory(null);

		expect(items.command('tab.close', 'Close Tab').enabled).toBe(true);
		expect(items.command('review.review', 'Review').enabled).toBe(true);
	});

	test('an unreported command is disabled', () => {
		const items = createMenuItemFactory(context({ commands: ['tab.close'] }));

		expect(items.command('review.review', 'Review').enabled).toBe(false);
	});

	test('a reported command is enabled', () => {
		const items = createMenuItemFactory(context({ commands: ['tab.close'] }));

		expect(items.command('tab.close', 'Close Tab').enabled).toBe(true);
	});

	test('only a command that owns its chord carries an accelerator', () => {
		const items = createMenuItemFactory(null);

		expect(items.command('tab.close', 'Close Tab').accelerator).toBe(
			getAccelerator('tab.close'),
		);
		expect(items.command('composer.submit', 'Send Message').accelerator).toBe(
			undefined,
		);
		expect(items.command('composer.focus', 'Focus Composer').accelerator).toBe(
			undefined,
		);
	});

	test('marks map to their Electron item type', () => {
		const items = createMenuItemFactory(null);

		expect(
			items.command('panel.files', 'All Files', { radio: true }).type,
		).toBe('radio');
		expect(
			items.command('layout.toggleDock', 'Dock', { checkbox: true }).type,
		).toBe('checkbox');
		expect(items.command('run.setup', 'Run Setup Script').type).toBe(undefined);
	});

	test('checked state comes from the reported context', () => {
		const items = createMenuItemFactory(
			context({ checked: ['theme.dark'], commands: ['theme.dark'] }),
		);

		expect(items.command('theme.dark', 'Dark', { radio: true }).checked).toBe(
			true,
		);
		expect(items.command('theme.light', 'Light', { radio: true }).checked).toBe(
			false,
		);
	});

	test('a dynamic submenu lists its entries in order', () => {
		const items = createMenuItemFactory(
			context({
				commands: ['run.script'],
				runScripts: [
					{ id: 'dev', label: 'dev' },
					{ id: 'build', label: 'build' },
				],
			}),
		);

		const item = items.submenu(
			'run.script',
			'Run Script',
			[
				{ id: 'dev', label: 'dev' },
				{ id: 'build', label: 'build' },
			],
			'No Run Scripts',
		);

		expect(item.enabled).toBe(true);
		expect(submenuOf(item).map((entry) => entry.label)).toEqual([
			'dev',
			'build',
		]);
	});

	test('an empty dynamic submenu is disabled and shows its empty row', () => {
		const items = createMenuItemFactory(context({ commands: ['run.script'] }));

		const item = items.submenu(
			'run.script',
			'Run Script',
			[],
			'No Run Scripts',
		);

		expect(item.enabled).toBe(false);
		expect(submenuOf(item)).toEqual([
			{ enabled: false, label: 'No Run Scripts' },
		]);
	});
});

describe('buildWorkspaceMenu', () => {
	test('fills its dynamic submenus from the reported context', () => {
		const reported = context({
			commands: ['run.script', 'workspace.openIn'],
			openTargets: [{ id: 'vscode', label: 'Visual Studio Code' }],
			runScripts: [{ id: 'dev', label: 'dev' }],
		});

		const menu = buildWorkspaceMenu(
			LABELS,
			createMenuItemFactory(reported),
			reported,
			true,
		);

		expect(submenuOf(itemLabelled(menu, LABELS.runScript))).toHaveLength(1);
		expect(submenuOf(itemLabelled(menu, LABELS.openIn))[0]?.label).toBe(
			'Visual Studio Code',
		);
	});

	test('falls back to empty submenus when the renderer has not reported', () => {
		const menu = buildWorkspaceMenu(
			LABELS,
			createMenuItemFactory(null),
			null,
			true,
		);
		const runScript = itemLabelled(menu, LABELS.runScript);

		expect(runScript?.enabled).toBe(false);
		expect(submenuOf(runScript)).toEqual([
			{ enabled: false, label: LABELS.noRunScripts },
		]);
	});

	test('renders the board statuses as a radio group', () => {
		const menu = buildWorkspaceMenu(
			LABELS,
			createMenuItemFactory(null),
			null,
			true,
		);

		expect(
			submenuOf(itemLabelled(menu, LABELS.status)).map((item) => item.type),
		).toEqual(['radio', 'radio', 'radio', 'radio', 'radio']);
	});
});
