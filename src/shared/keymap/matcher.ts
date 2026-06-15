import {
	type Binding,
	type Modifier,
	SHORTCUTS,
	type ShortcutDef,
	type ShortcutId,
} from './shortcuts';

function defOf(id: ShortcutId): ShortcutDef {
	return SHORTCUTS[id];
}

/**
 * Minimal shape required to match a binding. Covers both the DOM
 * `KeyboardEvent` and React's `KeyboardEvent<T>`.
 */
export interface KeyboardEventLike {
	readonly key: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}

function detectIsMac(): boolean {
	if (
		typeof navigator !== 'undefined' &&
		typeof navigator.platform === 'string'
	) {
		return /Mac/i.test(navigator.platform);
	}
	if (typeof process !== 'undefined' && process.platform === 'darwin') {
		return true;
	}
	return false;
}

let cachedIsMac: boolean | null = null;
function isMac(): boolean {
	if (cachedIsMac === null) {
		cachedIsMac = detectIsMac();
	}
	return cachedIsMac;
}

function modifierPressed(mod: Modifier, event: KeyboardEventLike): boolean {
	switch (mod) {
		case 'mod':
			return isMac() ? event.metaKey : event.ctrlKey;
		case 'alt':
			return event.altKey;
		case 'shift':
			return event.shiftKey;
	}
}

function matchesBinding(binding: Binding, event: KeyboardEventLike): boolean {
	if (event.key.toLowerCase() !== binding.key.toLowerCase()) {
		return false;
	}
	const required = new Set<Modifier>(binding.modifiers ?? []);
	const allMods: readonly Modifier[] = ['mod', 'alt', 'shift'];
	for (const mod of allMods) {
		const need = required.has(mod);
		const have = modifierPressed(mod, event);
		if (need !== have) {
			return false;
		}
	}
	return true;
}

export function matchesShortcut(
	id: ShortcutId,
	event: KeyboardEventLike,
): boolean {
	for (const binding of defOf(id).bindings) {
		if (matchesBinding(binding, event)) {
			return true;
		}
	}
	return false;
}

export function getAccelerator(id: ShortcutId): string | undefined {
	return defOf(id).accelerator;
}

const MODIFIER_LABEL_MAC: Record<Modifier, string> = {
	mod: '⌘',
	alt: '⌥',
	shift: '⇧',
};

const MODIFIER_LABEL_OTHER: Record<Modifier, string> = {
	mod: 'Ctrl',
	alt: 'Alt',
	shift: 'Shift',
};

function formatKey(key: string): string {
	if (key.length === 1) {
		return key.toUpperCase();
	}
	return key;
}

/**
 * Human-readable label for the first binding of a shortcut. Used in tooltips
 * and hint chips. Returns e.g. `⌘L` on macOS or `Ctrl+L` elsewhere.
 */
export function formatShortcut(id: ShortcutId): string {
	const binding = defOf(id).bindings[0];
	if (!binding) {
		return '';
	}
	const mac = isMac();
	const labels = mac ? MODIFIER_LABEL_MAC : MODIFIER_LABEL_OTHER;
	const separator = mac ? '' : '+';
	const parts: string[] = [];
	const order: readonly Modifier[] = ['mod', 'alt', 'shift'];
	const modifierSet = new Set<Modifier>(binding.modifiers ?? []);
	for (const mod of order) {
		if (modifierSet.has(mod)) {
			parts.push(labels[mod]);
		}
	}
	parts.push(formatKey(binding.key));
	return parts.join(separator);
}
