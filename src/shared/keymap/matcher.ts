import {
	type Binding,
	type Modifier,
	SHORTCUTS,
	type ShortcutDef,
	type ShortcutId,
} from './shortcuts';

/**
 * Look up the shortcut definition registered under an id.
 * @param id - Identifier of the shortcut to resolve
 * @returns The shortcut definition for the id
 */
function defOf(id: ShortcutId): ShortcutDef {
	return SHORTCUTS[id];
}

/**
 * Minimal shape required to match a binding. Covers both the DOM
 * `KeyboardEvent` and React's `KeyboardEvent<T>`.
 */
export interface KeyboardEventLike {
	readonly key: string;
	/**
	 * Physical key code (`KeyP`, `Digit1`, …). Layout-stable, and crucially
	 * unaffected by macOS composing Option+<letter> into a glyph. Optional so
	 * synthetic events (tests) can omit it and fall back to `key`.
	 */
	readonly code?: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}

/**
 * Detect whether the current platform is macOS, preferring the browser
 * `navigator.platform` and falling back to `process.platform`.
 * @returns True when running on macOS
 */
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
/**
 * Memoized macOS check that caches the first `detectIsMac` result.
 * @returns True when running on macOS
 */
function isMac(): boolean {
	if (cachedIsMac === null) {
		cachedIsMac = detectIsMac();
	}
	return cachedIsMac;
}

/** Physical modifier-key state, the layer bindings ultimately compare against. */
interface PhysicalModifiers {
	alt: boolean;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
}

/**
 * Resolves a binding's logical modifiers to physical keys. `mod` maps to ⌘
 * (meta) on macOS and Ctrl elsewhere; `ctrl` is always the physical Control
 * key — so on Windows/Linux `mod` and `ctrl` collapse onto the same flag, which
 * is correct because they are the same physical key there.
 */
function requiredPhysicalModifiers(
	modifiers: readonly Modifier[],
): PhysicalModifiers {
	const mac = isMac();
	const required: PhysicalModifiers = {
		alt: false,
		ctrl: false,
		meta: false,
		shift: false,
	};
	for (const modifier of modifiers) {
		switch (modifier) {
			case 'mod':
				if (mac) {
					required.meta = true;
				} else {
					required.ctrl = true;
				}
				break;
			case 'ctrl':
				required.ctrl = true;
				break;
			case 'alt':
				required.alt = true;
				break;
			case 'shift':
				required.shift = true;
				break;
		}
	}
	return required;
}

/** True for single ASCII letters, the keys macOS mangles under Option. */
function isAsciiLetter(key: string): boolean {
	return /^[a-z]$/i.test(key);
}

/**
 * Physical `event.code` for punctuation bindings whose printed character shifts
 * (Shift+`]` becomes `}`), so their `event.key` cannot be matched reliably. The
 * code is layout- and shift-stable, mirroring the alt+letter handling below.
 */
const PUNCTUATION_CODE_BY_KEY: Record<string, string> = {
	']': 'BracketRight',
	'[': 'BracketLeft',
};

/**
 * Matches the binding's key against the event. For alt+<letter> and shiftable
 * punctuation bindings we compare the physical `event.code` (`KeyP`,
 * `BracketRight`) instead of `event.key`, because macOS composes Option+<letter>
 * into a glyph (⌥P → "π") and Shift mangles punctuation (⇧] → "}") — neither
 * would equal the bound key. Falls back to `key` when `code` is absent
 * (synthetic events) or the binding needs no stabilization.
 */
function keyMatches(binding: Binding, event: KeyboardEventLike): boolean {
	const requiresAlt = (binding.modifiers ?? []).includes('alt');
	if (requiresAlt && event.code && isAsciiLetter(binding.key)) {
		return event.code === `Key${binding.key.toUpperCase()}`;
	}
	const punctuationCode = PUNCTUATION_CODE_BY_KEY[binding.key];
	if (punctuationCode && event.code) {
		return event.code === punctuationCode;
	}
	return event.key.toLowerCase() === binding.key.toLowerCase();
}

/**
 * Whether a keyboard event exactly matches a binding's key and physical
 * modifier state.
 * @param binding - The key binding to test
 * @param event - The keyboard event to compare against
 * @returns True when the event satisfies the binding exactly
 */
function matchesBinding(binding: Binding, event: KeyboardEventLike): boolean {
	if (!keyMatches(binding, event)) {
		return false;
	}
	// Every modifier the binding requires must be down, and every other physical
	// modifier must be up — an exact match against the event's physical state.
	const required = requiredPhysicalModifiers(binding.modifiers ?? []);
	return (
		required.meta === event.metaKey &&
		required.ctrl === event.ctrlKey &&
		required.alt === event.altKey &&
		required.shift === event.shiftKey
	);
}

/**
 * Whether a keyboard event matches any binding registered for a shortcut.
 * @param id - Identifier of the shortcut to test
 * @param event - The keyboard event to compare against
 * @returns True when any of the shortcut's bindings match
 */
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

/**
 * Electron accelerator string registered for a shortcut, consumed by
 * main-process menu code.
 * @param id - Identifier of the shortcut to resolve
 * @returns The accelerator string, or undefined when the shortcut has none
 */
export function getAccelerator(id: ShortcutId): string | undefined {
	return defOf(id).accelerator;
}

const MODIFIER_LABEL_MAC: Record<Modifier, string> = {
	mod: '⌘',
	ctrl: '⌃',
	alt: '⌥',
	shift: '⇧',
};

const MODIFIER_LABEL_OTHER: Record<Modifier, string> = {
	mod: 'Ctrl',
	ctrl: 'Ctrl',
	alt: 'Alt',
	shift: 'Shift',
};

/**
 * Normalize a binding key for display, upper-casing single characters and
 * leaving named keys (`Enter`, `ArrowUp`) untouched.
 * @param key - The binding key to format
 * @returns The display-ready key label
 */
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
	// Mac convention orders ⌃⌥⇧⌘; elsewhere Ctrl comes first.
	const order: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'mod'];
	const modifierSet = new Set<Modifier>(binding.modifiers ?? []);
	for (const mod of order) {
		if (modifierSet.has(mod)) {
			parts.push(labels[mod]);
		}
	}
	parts.push(formatKey(binding.key));
	return parts.join(separator);
}
