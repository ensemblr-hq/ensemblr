import type { ShortcutId } from './keymap';

/**
 * Definition of one native-menu command: the keymap entry it borrows its
 * accelerator from, whether the menu owns that accelerator, and whether the
 * item is filled in from a renderer-supplied submenu.
 */
export interface MenuCommandDef {
	/**
	 * Keymap id supplying the Electron accelerator. Omitted for the majority of
	 * commands, which are menu-only and carry no key equivalent.
	 */
	readonly shortcutId?: ShortcutId;
	/**
	 * Whether the menu claims this command's chord. Only a command that sets this
	 * carries an accelerator at all.
	 *
	 * On macOS — the only platform this app ships — displaying an accelerator
	 * *is* registering it: an `NSMenuItem` key equivalent is matched by AppKit
	 * before the event reaches the web contents, and Electron's
	 * `registerAccelerator: false` escape hatch is documented Windows/Linux only.
	 * So there is no display-for-discoverability-without-claiming option, and
	 * this one flag decides both.
	 *
	 * A command may claim its chord only when the menu reproduces the renderer's
	 * handling exactly: either the shortcut is `menu`-scoped and has no renderer
	 * handler at all, or its `useHotkey` handler and its `useMenuCommand` handler
	 * are the same callback. Layered scopes are the counterexample and are
	 * excluded by `tests/shared/menu-commands.test.ts` — ⌘↵ is four different
	 * submits (`composer.submitWithMod`, `diffComment.submit`, `question.submit`,
	 * `dialog.submit`) that only the renderer can tell apart.
	 */
	readonly ownsAccelerator?: true;
	/**
	 * Whether the command is dispatched from a renderer-supplied submenu and so
	 * arrives with an `arg` naming the specific script, target, or project.
	 */
	readonly dynamic?: true;
}

/**
 * Every command the native menu can dispatch to the renderer.
 *
 * This is a separate id space from {@link ShortcutId} on purpose: most menu
 * items have no key equivalent, and minting a placeholder shortcut for each
 * would force a user-facing name plus a Russian and Greek translation onto the
 * shortcuts reference screen, whose `shortcutName` map is typed
 * `Record<ShortcutId, string>`. The optional `shortcutId` link is checked
 * against `SHORTCUTS` by `tests/shared/menu-commands.test.ts`.
 */
export const MENU_COMMANDS = {
	'app.checkForUpdates': {},
	'settings.open': { ownsAccelerator: true, shortcutId: 'settings.open' },

	'workspace.new': { ownsAccelerator: true, shortcutId: 'workspace.new' },
	'tab.new': { ownsAccelerator: true, shortcutId: 'tab.new' },
	'terminal.new': { ownsAccelerator: true, shortcutId: 'terminal.new' },
	'project.addFromGithub': {},
	'project.addFromLocal': {},
	'project.quickStart': {},
	'project.openRecent': { dynamic: true },
	'tab.close': { ownsAccelerator: true, shortcutId: 'tab.close' },

	'palette.open': { ownsAccelerator: true, shortcutId: 'palette.open' },
	'layout.toggleSidebar': {
		ownsAccelerator: true,
		shortcutId: 'sidebar.toggle',
	},
	'layout.toggleRightSidebar': {
		ownsAccelerator: true,
		shortcutId: 'layout.toggleRightSidebar',
	},
	'layout.toggleDock': {
		ownsAccelerator: true,
		shortcutId: 'layout.toggleDock',
	},
	'changes.uncommitted': {
		ownsAccelerator: true,
		shortcutId: 'changes.uncommitted',
	},
	'panel.files': {},
	'panel.changes': {},
	'panel.checks': {},
	'go.workbench': {},
	'go.linear': {},
	'go.history': {},
	'theme.system': {},
	'theme.light': {},
	'theme.dark': {},
	'toolCalls.toggleCollapse': {
		ownsAccelerator: true,
		shortcutId: 'toolCalls.toggleCollapse',
	},
	'concierge.toggle': { ownsAccelerator: true, shortcutId: 'concierge.toggle' },
	'concierge.toggleFullscreen': {
		ownsAccelerator: true,
		shortcutId: 'concierge.toggleFullscreen',
	},
	'concierge.focusComposer': {
		ownsAccelerator: true,
		shortcutId: 'concierge.focusComposer',
	},
	'concierge.clear': { shortcutId: 'concierge.clear' },

	'run.toggle': { ownsAccelerator: true, shortcutId: 'run.start' },
	'run.script': { dynamic: true },
	'run.setup': {},
	'agents.open': { ownsAccelerator: true, shortcutId: 'agents.open' },
	'files.search': { ownsAccelerator: true, shortcutId: 'files.search' },
	'workspace.openIn': { dynamic: true },
	'workspace.rename': {},
	'workspace.status.backlog': {},
	'workspace.status.inProgress': {},
	'workspace.status.inReview': {},
	'workspace.status.done': {},
	'workspace.status.cancelled': {},
	'workspace.archive': {},
	'workspace.delete': {},

	'composer.focus': { shortcutId: 'composer.focus' },
	'composer.submit': { shortcutId: 'composer.submitWithMod' },
	'composer.togglePlanMode': { shortcutId: 'composer.togglePlanMode' },
	'composer.toggleAfkMode': { shortcutId: 'composer.toggleAfkMode' },
	'composer.cycleThinking': { shortcutId: 'composer.cycleThinking' },
	'composer.toggleModelPicker': { shortcutId: 'composer.toggleModelPicker' },
	'tab.next': { ownsAccelerator: true, shortcutId: 'tab.next' },
	'tab.prev': { ownsAccelerator: true, shortcutId: 'tab.prev' },
	'tab.selectByIndex': { dynamic: true },
	'tab.keepOpen': { ownsAccelerator: true, shortcutId: 'tab.keepOpen' },

	'review.review': {},
	'review.commitAndPush': {},
	'review.pushBranch': {},
	'review.createPullRequest': {},
	'review.mergePullRequest': {},
	'review.resolveConflicts': {},
	'review.fixCheckErrors': {},
	'review.discardChanges': {},

	'help.shortcuts': { ownsAccelerator: true, shortcutId: 'help.shortcuts' },
	'help.diagnostics': {},
	'help.configFile': {},
} as const satisfies Record<string, MenuCommandDef>;

/** Union of every command the native menu can dispatch. */
export type MenuCommandId = keyof typeof MENU_COMMANDS;

/**
 * Reads a command's definition at the declared interface rather than at the
 * literal type `as const` infers, so callers can branch on the optional fields.
 * @param command - The command to look up
 * @returns The command's definition
 */
export function menuCommandDef(command: MenuCommandId): MenuCommandDef {
	return MENU_COMMANDS[command];
}

/** One renderer-supplied entry in a dynamic submenu (a run script, an open-in target, a recent project). */
export interface MenuDynamicEntry {
	/** Value handed back as the command's `arg` when the item is chosen. */
	readonly id: string;
	/** Already-localized label; the main process never translates these. */
	readonly label: string;
}

/**
 * The renderer's contribution to the native menu: which commands currently have
 * a handler, and the entries filling each dynamic submenu. Main enables items
 * from `commands` and skips the rebuild when nothing here changed.
 */
export interface MenuContext {
	readonly commands: readonly MenuCommandId[];
	/**
	 * Commands whose item renders with a checkmark — the sidebar and dock
	 * toggles, the active panel and theme, Plan Mode, and Run while a script is
	 * running. A set of ids rather than a mirror of renderer values, so the
	 * payload stays the same shape as `commands`.
	 */
	readonly checked: readonly MenuCommandId[];
	readonly runScripts: readonly MenuDynamicEntry[];
	readonly openTargets: readonly MenuDynamicEntry[];
	readonly recentProjects: readonly MenuDynamicEntry[];
	readonly chatTabs: readonly MenuDynamicEntry[];
}

/** Payload the native menu broadcasts to the focused window when an item is chosen. */
export interface MenuCommandBroadcast {
	readonly command: MenuCommandId;
	/** Identifier of the chosen entry, for the commands marked `dynamic`. */
	readonly arg?: string;
}

/**
 * Whether two menu contexts would produce the same menu, so a report that
 * changed nothing does not cost a full `Menu.setApplicationMenu` replacement.
 * @param left - Previously applied context, or null before the first report
 * @param right - Newly reported context
 * @returns True when the two would build an identical menu
 */
export function isSameMenuContext(
	left: MenuContext | null,
	right: MenuContext,
): boolean {
	if (!left) {
		return false;
	}
	return (
		sameIds(left.commands, right.commands) &&
		sameIds(left.checked, right.checked) &&
		sameEntries(left.runScripts, right.runScripts) &&
		sameEntries(left.openTargets, right.openTargets) &&
		sameEntries(left.recentProjects, right.recentProjects) &&
		sameEntries(left.chatTabs, right.chatTabs)
	);
}

/**
 * Compares two command lists as sets, since registration order carries no
 * meaning for the menu.
 * @param left - First command list
 * @param right - Second command list
 * @returns True when both hold the same command ids
 */
function sameIds(
	left: readonly MenuCommandId[],
	right: readonly MenuCommandId[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const seen = new Set(left);
	return right.every((command) => seen.has(command));
}

/**
 * Compares two dynamic submenu lists, where order is the display order and so
 * is significant.
 * @param left - First entry list
 * @param right - Second entry list
 * @returns True when both hold the same entries in the same order
 */
export function sameEntries(
	left: readonly MenuDynamicEntry[],
	right: readonly MenuDynamicEntry[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(entry, index) =>
				entry.id === right[index]?.id && entry.label === right[index]?.label,
		)
	);
}
