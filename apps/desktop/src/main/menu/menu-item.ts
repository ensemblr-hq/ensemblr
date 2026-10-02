import type { MenuItemConstructorOptions } from 'electron';

import { getAccelerator } from '../../shared/keymap/matcher';
import type { DrawnMenuItemRole } from '../../shared/menu-bar';
import type {
	MenuCommandId,
	MenuContext,
	MenuDynamicEntry,
} from '../../shared/menu-commands';
import { menuCommandDef } from '../../shared/menu-commands';
import { sendMenuCommand } from './menu-command';

/** Mark for an item whose state the renderer reports: a standalone toggle, or one option of a one-of-N group. */
type MenuItemMark = { checkbox: true } | { radio: true };

/** The command a menu item dispatches, and the dynamic entry it carries. */
export interface MenuItemDispatch {
	readonly command: MenuCommandId;
	/** Identifier of the chosen entry, for the commands marked `dynamic`. */
	readonly arg?: string;
}

/**
 * A template item annotated with the command behind it.
 *
 * Electron only ever sees the `click` closure, which is opaque — so a menu bar
 * the app draws for itself could not tell what a row would do. Recording the
 * dispatch alongside the closure is what lets the drawn bar reproduce the
 * native one instead of keeping a second copy of the structure.
 * `toElectronTemplate` strips the annotation again before Electron is handed
 * the tree.
 */
export interface DescribedMenuItem extends MenuItemConstructorOptions {
	readonly dispatch?: MenuItemDispatch;
	/**
	 * Role the drawn bar performs for an item Electron is given a `click` for
	 * rather than a `role`, which is how a row opts out of the accelerator
	 * Electron would attach to the role.
	 */
	readonly drawnRole?: DrawnMenuItemRole;
	readonly submenu?: DescribedMenuItem[];
}

/**
 * Drops the annotations from a described template, leaving the plain Electron
 * one. Structural rather than in-place so the annotated tree survives for the
 * drawn menu bar to read.
 * @param nodes - The annotated template
 * @returns The same tree as Electron accepts it
 */
export function toElectronTemplate(
	nodes: readonly DescribedMenuItem[],
): MenuItemConstructorOptions[] {
	return nodes.map(
		({ dispatch: _dispatch, drawnRole: _drawnRole, submenu, ...rest }) => ({
			...rest,
			...(submenu ? { submenu: toElectronTemplate(submenu) } : {}),
		}),
	);
}

/** Builds the menu items that dispatch commands, against one reported context. */
export interface MenuItemFactory {
	/**
	 * A plain command item. Pass `checkbox` for a standalone toggle such as a
	 * sidebar, or `radio` for one option of a mutually exclusive group such as
	 * the theme or the active panel.
	 */
	command: (
		command: MenuCommandId,
		label: string,
		mark?: MenuItemMark,
	) => DescribedMenuItem;
	/**
	 * A submenu whose entries the renderer supplied — run scripts, open-in
	 * targets, recent repositories, open chats. Renders a single disabled row
	 * when there are none, so the submenu never opens empty.
	 */
	submenu: (
		command: MenuCommandId,
		label: string,
		entries: readonly MenuDynamicEntry[],
		emptyLabel: string,
	) => DescribedMenuItem;
}

/**
 * Creates the item factory for one menu build.
 *
 * A null context means the renderer has not reported yet, which enables every
 * item: a menu that greys out until the first report would swallow the
 * accelerators it owns during launch.
 * @param context - The last context the renderer reported, or null
 * @returns Factory bound to that context
 */
export function createMenuItemFactory(
	context: MenuContext | null,
): MenuItemFactory {
	const enabled = context ? new Set(context.commands) : null;
	const checked = new Set(context?.checked ?? []);

	/**
	 * Whether a command currently has a renderer handler.
	 * @param command - The command to test
	 * @returns True when the item should be enabled
	 */
	const isEnabled = (command: MenuCommandId): boolean =>
		!enabled || enabled.has(command);

	return {
		command: (command, label, mark) => ({
			accelerator: acceleratorFor(command),
			checked: mark ? checked.has(command) : undefined,
			click: () => sendMenuCommand(command),
			dispatch: { command },
			enabled: isEnabled(command),
			label,
			type: markType(mark),
		}),
		submenu: (command, label, entries, emptyLabel) => ({
			enabled: isEnabled(command) && entries.length > 0,
			label,
			submenu:
				entries.length > 0
					? entries.map(
							(entry): DescribedMenuItem => ({
								click: () => sendMenuCommand(command, entry.id),
								dispatch: { arg: entry.id, command },
								label: entry.label,
							}),
						)
					: [{ enabled: false, label: emptyLabel }],
		}),
	};
}

/**
 * Resolves the accelerator a command claims. Only a command flagged
 * `ownsAccelerator` gets one: on macOS an item's key equivalent is matched by
 * AppKit ahead of the web contents, so attaching an accelerator takes the chord
 * away from the renderer whether or not that was the intent.
 * @param command - The command whose accelerator to resolve
 * @returns The accelerator string, or undefined when the menu claims no chord
 */
function acceleratorFor(command: MenuCommandId): string | undefined {
	const { ownsAccelerator, shortcutId } = menuCommandDef(command);
	return ownsAccelerator && shortcutId ? getAccelerator(shortcutId) : undefined;
}

/**
 * Maps a state mark to the Electron item type, leaving unmarked items `normal`.
 * @param mark - The item's state mark, if it carries one
 * @returns The Electron menu item type, or undefined for a plain item
 */
function markType(
	mark: MenuItemMark | undefined,
): 'checkbox' | 'radio' | undefined {
	if (!mark) {
		return undefined;
	}
	return 'radio' in mark ? 'radio' : 'checkbox';
}
