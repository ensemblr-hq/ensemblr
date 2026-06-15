/**
 * Single source of truth for every keyboard shortcut in the app.
 *
 * Renderer code resolves shortcuts via `matchesShortcut` / `useHotkey` /
 * `useKeymapHandler`. Main-process menu code resolves via `getAccelerator`.
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

export type Scope =
	| 'global'
	| 'composer'
	| 'autocomplete'
	| 'dialog'
	| 'modelPicker'
	| 'menu';

export interface Binding {
	readonly key: string;
	readonly modifiers?: readonly Modifier[];
}

export interface ShortcutDef {
	readonly description: string;
	readonly scope: Scope;
	readonly bindings: readonly Binding[];
	readonly accelerator?: string;
}

const digitBindings: readonly Binding[] = Array.from(
	{ length: 9 },
	(_, index): Binding => ({ key: String(index + 1) }),
);

export const SHORTCUTS = {
	'sidebar.toggle': {
		description: 'Toggle sidebar',
		scope: 'global',
		bindings: [{ key: 'b', modifiers: ['mod'] }],
	},
	'palette.open': {
		description: 'Open command palette',
		scope: 'global',
		bindings: [{ key: 'k', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+K',
	},
	'settings.open': {
		description: 'Open settings',
		scope: 'global',
		bindings: [{ key: ',', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+,',
	},
	'files.search': {
		description: 'Open file search',
		scope: 'global',
		bindings: [{ key: 'p', modifiers: ['mod'] }],
	},
	'composer.focus': {
		description: 'Focus composer',
		scope: 'composer',
		bindings: [{ key: 'l', modifiers: ['mod'] }],
	},
	'composer.toggleModelPicker': {
		description: 'Toggle model picker',
		scope: 'composer',
		bindings: [{ key: 'p', modifiers: ['alt'] }],
	},
	'composer.cycleThinking': {
		description: 'Cycle thinking level',
		scope: 'composer',
		bindings: [{ key: 't', modifiers: ['alt'] }],
	},
	'composer.submit': {
		description: 'Send message',
		scope: 'composer',
		bindings: [{ key: 'Enter' }],
	},
	'composer.submitWithMod': {
		description: 'Send message',
		scope: 'composer',
		bindings: [{ key: 'Enter', modifiers: ['mod'] }],
	},
	'composer.newline': {
		description: 'Insert newline in composer',
		scope: 'composer',
		bindings: [{ key: 'Enter', modifiers: ['shift'] }],
	},
	'composer.queue': {
		description: 'Queue message as a follow-up',
		scope: 'composer',
		bindings: [{ key: 'j', modifiers: ['mod'] }],
	},
	'composer.removeLastMention': {
		description: 'Remove last mention attachment',
		scope: 'composer',
		bindings: [{ key: 'Backspace' }],
	},
	'autocomplete.next': {
		description: 'Next autocomplete entry',
		scope: 'autocomplete',
		bindings: [{ key: 'ArrowDown' }],
	},
	'autocomplete.prev': {
		description: 'Previous autocomplete entry',
		scope: 'autocomplete',
		bindings: [{ key: 'ArrowUp' }],
	},
	'autocomplete.confirm': {
		description: 'Confirm autocomplete selection',
		scope: 'autocomplete',
		bindings: [{ key: 'Enter' }, { key: 'Tab' }],
	},
	'autocomplete.dismiss': {
		description: 'Close autocomplete popover',
		scope: 'autocomplete',
		bindings: [{ key: 'Escape' }],
	},
	'dialog.submit': {
		description: 'Submit dialog form',
		scope: 'dialog',
		bindings: [{ key: 'Enter', modifiers: ['mod'] }],
	},
	'modelPicker.selectByIndex': {
		description: 'Select model by index (1-9)',
		scope: 'modelPicker',
		bindings: digitBindings,
	},
	'workspace.new': {
		description: 'New workspace',
		scope: 'menu',
		bindings: [{ key: 'n', modifiers: ['mod'] }],
		accelerator: 'CommandOrControl+N',
	},
	'toolCalls.toggleCollapse': {
		description: 'Expand or collapse all tool calls',
		scope: 'global',
		bindings: [{ key: 'o', modifiers: ['ctrl'] }],
	},
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = keyof typeof SHORTCUTS;
