import { describe, expect, test } from 'vitest';

import type { ShortcutDef, ShortcutId } from '../../src/shared/keymap';
import { SHORTCUTS } from '../../src/shared/keymap';
import type {
	MenuCommandId,
	MenuContext,
} from '../../src/shared/menu-commands';
import {
	isSameMenuContext,
	MENU_COMMANDS,
	menuCommandDef,
} from '../../src/shared/menu-commands';

const COMMAND_IDS = Object.keys(MENU_COMMANDS) as MenuCommandId[];

/** Reads a shortcut at the declared interface rather than its `as const` literal type. */
function shortcutDef(id: ShortcutId): ShortcutDef {
	return SHORTCUTS[id];
}

/** Every chord a shortcut binds, in a form comparable across shortcuts. */
function chordsOf(id: ShortcutId): string[] {
	return shortcutDef(id).bindings.map(
		(binding) =>
			`${[...(binding.modifiers ?? [])].sort().join('+')}+${binding.key}`,
	);
}

/** Shortcut ids that bind a given chord. */
function shortcutsBinding(chord: string): ShortcutId[] {
	return (Object.keys(SHORTCUTS) as ShortcutId[]).filter((id) =>
		chordsOf(id).includes(chord),
	);
}

/** Shortcut ids whose chord the native menu claims. */
function ownedShortcutIds(): ShortcutId[] {
	return COMMAND_IDS.flatMap((command) => {
		const { ownsAccelerator, shortcutId } = menuCommandDef(command);
		return ownsAccelerator && shortcutId ? [shortcutId] : [];
	});
}

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

describe('MENU_COMMANDS', () => {
	test('every declared shortcutId is a registered shortcut', () => {
		for (const command of COMMAND_IDS) {
			const { shortcutId } = menuCommandDef(command);
			if (shortcutId) {
				expect(SHORTCUTS).toHaveProperty(shortcutId);
			}
		}
	});

	test('every command the menu owns the accelerator for declares one', () => {
		for (const command of COMMAND_IDS) {
			const { ownsAccelerator, shortcutId } = menuCommandDef(command);
			if (!ownsAccelerator) {
				continue;
			}
			expect(shortcutId).toBeDefined();
			expect(shortcutId && shortcutDef(shortcutId).accelerator).toBeTruthy();
		}
	});

	test('a command the menu does not own has no accelerator to display', () => {
		// On macOS an accelerator on a menu item is registered with AppKit whether
		// or not that was intended, so "display only" is not a thing that exists.
		for (const command of COMMAND_IDS) {
			const { ownsAccelerator, shortcutId } = menuCommandDef(command);
			if (ownsAccelerator || !shortcutId) {
				continue;
			}
			expect(shortcutDef(shortcutId).accelerator).toBeUndefined();
		}
	});

	test('no shortcut declares an accelerator no menu command claims', () => {
		const claimed = new Set(ownedShortcutIds());
		for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
			if (shortcutDef(id).accelerator) {
				expect(claimed.has(id)).toBe(true);
			}
		}
	});

	test('a chord bound by more than one shortcut is left to the renderer', () => {
		// ⌘↵ is the live case: composer.submitWithMod, diffComment.submit,
		// question.submit and dialog.submit all bind it, and only the renderer's
		// layered handling can tell which one the focused view means.
		for (const shortcutId of ownedShortcutIds()) {
			for (const chord of chordsOf(shortcutId)) {
				expect(shortcutsBinding(chord)).toEqual([shortcutId]);
			}
		}
	});

	test('no two menu-owned commands claim the same accelerator', () => {
		const claimed = new Map<string, MenuCommandId>();
		for (const command of COMMAND_IDS) {
			const { ownsAccelerator, shortcutId } = menuCommandDef(command);
			if (!ownsAccelerator || !shortcutId) {
				continue;
			}
			const accelerator = shortcutDef(shortcutId).accelerator ?? '';
			expect(claimed.get(accelerator)).toBeUndefined();
			claimed.set(accelerator, command);
		}
	});

	test('no composer- or dialog-scoped shortcut has its accelerator taken by the menu', () => {
		for (const command of COMMAND_IDS) {
			const { ownsAccelerator, shortcutId } = menuCommandDef(command);
			if (!ownsAccelerator || !shortcutId) {
				continue;
			}
			expect(shortcutDef(shortcutId).scope).not.toBe('composer');
			expect(shortcutDef(shortcutId).scope).not.toBe('dialog');
		}
	});
});

describe('isSameMenuContext', () => {
	test('a null previous context always differs', () => {
		expect(isSameMenuContext(null, context())).toBe(false);
	});

	test('command order does not matter', () => {
		expect(
			isSameMenuContext(
				context({ commands: ['tab.close', 'workspace.new'] }),
				context({ commands: ['workspace.new', 'tab.close'] }),
			),
		).toBe(true);
	});

	test('a changed command set differs', () => {
		expect(
			isSameMenuContext(
				context({ commands: ['tab.close'] }),
				context({ commands: ['tab.close', 'workspace.new'] }),
			),
		).toBe(false);
	});

	test('a changed checked set differs', () => {
		expect(
			isSameMenuContext(
				context({ checked: ['theme.dark'] }),
				context({ checked: ['theme.light'] }),
			),
		).toBe(false);
	});

	test('dynamic entry order matters', () => {
		const first = { id: 'dev', label: 'dev' };
		const second = { id: 'build', label: 'build' };
		expect(
			isSameMenuContext(
				context({ runScripts: [first, second] }),
				context({ runScripts: [second, first] }),
			),
		).toBe(false);
	});

	test('a relabelled dynamic entry differs', () => {
		expect(
			isSameMenuContext(
				context({ chatTabs: [{ id: 'a', label: 'Untitled' }] }),
				context({ chatTabs: [{ id: 'a', label: 'Fix the menu' }] }),
			),
		).toBe(false);
	});
});
