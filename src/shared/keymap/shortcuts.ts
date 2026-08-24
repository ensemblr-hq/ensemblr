/**
 * Single source of truth for every keyboard shortcut in the app.
 *
 * Renderer code resolves shortcuts via `matchesShortcut` / `useHotkey` /
 * `useKeymapHandler`. Main-process menu code resolves via `getAccelerator`.
 *
 * Bindings only — a shortcut's user-facing name lives in the renderer
 * catalogues under `settings:shortcuts.name.*`, keyed by the ids below, so the
 * reference screen renders it in the app language.
 *
 * Modifier semantics: every modifier listed in `modifiers` must be pressed,
 * every modifier NOT listed must NOT be pressed. `mod` resolves to Cmd on
 * macOS, Ctrl elsewhere.
 */

/**
 * `mod` is the platform command key (⌘ on macOS, Ctrl elsewhere). `ctrl` is
 * always the physical Control key — distinct from `mod` on macOS, but the same
 * physical key as `mod` on Windows/Linux.
 */
export type Modifier = 'mod' | 'ctrl' | 'alt' | 'shift';

/** UI context a shortcut is active within, used to route key events to the right layer. */
export type Scope =
	| 'global'
	| 'composer'
	| 'concierge'
	| 'autocomplete'
	| 'dialog'
	| 'modelPicker'
	| 'menu';

/** A single key plus the modifiers that must be held for it. */
export interface Binding {
	readonly key: string;
	readonly modifiers?: readonly Modifier[];
}

/**
 * Definition of a shortcut: its scope, key bindings, and optional Electron
 * accelerator.
 *
 * `accelerator` belongs only to a chord the native menu is allowed to claim. On
 * macOS a menu item's key equivalent is matched by AppKit before the renderer
 * sees the keydown, so an accelerator is never merely decorative — a
 * `composer`- or `dialog`-scoped chord must not carry one, or the menu steals it
 * from the layer that knows which of several handlers applies. Which commands
 * claim theirs is `ownsAccelerator` in `src/shared/menu-commands.ts`.
 */
export interface ShortcutDef {
	readonly scope: Scope;
	readonly bindings: readonly Binding[];
	readonly accelerator?: string;
}

const digitBindings: readonly Binding[] = Array.from(
	{ length: 9 },
	(_, index): Binding => ({ key: String(index + 1) }),
);

const tabIndexBindings: readonly Binding[] = Array.from(
	{ length: 9 },
	(_, index): Binding => ({ key: String(index + 1), modifiers: ['mod'] }),
);

export const SHORTCUTS = {
	'sidebar.toggle': {
		scope: 'global',
		bindings: [{ key: 'b', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+B',
	},
	'layout.toggleRightSidebar': {
		scope: 'menu',
		bindings: [{ key: 'b', modifiers: ['mod', 'alt'] }],
		accelerator: 'CommandOrControl+Alt+B',
	},
	'layout.toggleDock': {
		scope: 'menu',
		bindings: [{ key: 'j', modifiers: ['mod', 'alt'] }],
		accelerator: 'CommandOrControl+Alt+J',
	},
	'help.shortcuts': {
		scope: 'menu',
		bindings: [{ key: '/', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+/',
	},
	'terminal.new': {
		scope: 'menu',
		bindings: [{ key: '`', modifiers: ['ctrl', 'shift'] }],
		accelerator: 'Control+Shift+`',
	},
	'palette.open': {
		scope: 'global',
		bindings: [{ key: 'k', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+K',
	},
	'settings.open': {
		scope: 'global',
		bindings: [{ key: ',', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+,',
	},
	'files.search': {
		scope: 'global',
		bindings: [{ key: 'p', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+P',
	},
	'composer.focus': {
		scope: 'composer',
		bindings: [{ key: 'l', modifiers: ['mod'] }],
	},
	'composer.toggleModelPicker': {
		scope: 'composer',
		bindings: [{ key: 'p', modifiers: ['alt'] }],
	},
	'composer.cycleThinking': {
		scope: 'composer',
		bindings: [{ key: 't', modifiers: ['alt'] }],
	},
	'composer.togglePlanMode': {
		scope: 'composer',
		bindings: [{ key: 'p', modifiers: ['alt', 'shift'] }],
	},
	'composer.toggleDictation': {
		scope: 'composer',
		bindings: [{ key: 'd', modifiers: ['alt'] }],
	},
	'composer.submit': {
		scope: 'composer',
		bindings: [{ key: 'Enter' }],
	},
	'composer.submitWithMod': {
		scope: 'composer',
		bindings: [{ key: 'Enter', modifiers: ['mod'] }],
	},
	'composer.newline': {
		scope: 'composer',
		bindings: [{ key: 'Enter', modifiers: ['shift'] }],
	},
	'diffComment.submit': {
		scope: 'composer',
		bindings: [{ key: 'Enter', modifiers: ['mod'] }],
	},
	'question.submit': {
		scope: 'dialog',
		bindings: [{ key: 'Enter', modifiers: ['mod'] }],
	},
	'composer.queue': {
		scope: 'composer',
		bindings: [{ key: 'j', modifiers: ['mod'] }],
	},
	'autocomplete.next': {
		scope: 'autocomplete',
		bindings: [{ key: 'ArrowDown' }],
	},
	'autocomplete.prev': {
		scope: 'autocomplete',
		bindings: [{ key: 'ArrowUp' }],
	},
	'autocomplete.confirm': {
		scope: 'autocomplete',
		bindings: [{ key: 'Enter' }, { key: 'Tab' }],
	},
	'autocomplete.dismiss': {
		scope: 'autocomplete',
		bindings: [{ key: 'Escape' }],
	},
	'dialog.submit': {
		scope: 'dialog',
		bindings: [{ key: 'Enter', modifiers: ['mod'] }],
	},
	'modelPicker.selectByIndex': {
		scope: 'modelPicker',
		bindings: digitBindings,
	},
	'workspace.new': {
		scope: 'menu',
		bindings: [{ key: 'n', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+N',
	},
	'toolCalls.toggleCollapse': {
		scope: 'global',
		bindings: [{ key: 'o', modifiers: ['ctrl'] }],
		accelerator: 'Control+O',
	},
	'tab.close': {
		scope: 'menu',
		bindings: [{ key: 'w', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+W',
	},
	'tab.new': {
		scope: 'global',
		bindings: [{ key: 't', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+T',
	},
	'tab.keepOpen': {
		scope: 'global',
		bindings: [{ key: 'Enter', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+Return',
	},
	'tab.next': {
		scope: 'global',
		bindings: [{ key: ']', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+]',
	},
	'tab.prev': {
		scope: 'global',
		bindings: [{ key: '[', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+[',
	},
	'tab.selectByIndex': {
		scope: 'global',
		bindings: tabIndexBindings,
	},
	'changes.uncommitted': {
		scope: 'global',
		bindings: [{ key: 'u', modifiers: ['mod', 'alt'] }],
		accelerator: 'CommandOrControl+Alt+U',
	},
	'run.start': {
		scope: 'global',
		bindings: [{ key: 'r', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+R',
	},
	'agents.open': {
		scope: 'global',
		bindings: [{ key: 'a', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+A',
	},
	'concierge.toggle': {
		scope: 'global',
		bindings: [{ key: 'c', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+C',
	},
	'concierge.focusComposer': {
		scope: 'global',
		bindings: [{ key: 'l', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+L',
	},
	'concierge.toggleFullscreen': {
		scope: 'concierge',
		bindings: [{ key: 'm', modifiers: ['mod', 'shift'] }],
		accelerator: 'CommandOrControl+Shift+M',
	},
	// No accelerator, so the menu leaves the chord to the panel: an item that
	// claimed it would take ⌘⇧K from every other surface in the window, and this
	// one throws a conversation away.
	'concierge.clear': {
		scope: 'concierge',
		bindings: [{ key: 'k', modifiers: ['mod', 'shift'] }],
	},
	'concierge.close': {
		scope: 'concierge',
		bindings: [{ key: 'Escape' }],
	},
} as const satisfies Record<string, ShortcutDef>;

/** Union of every registered shortcut id (the keys of `SHORTCUTS`). */
export type ShortcutId = keyof typeof SHORTCUTS;
