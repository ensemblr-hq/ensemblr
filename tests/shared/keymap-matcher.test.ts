import { describe, expect, test } from 'vitest';

import {
	formatChord,
	formatShortcut,
	type KeyboardEventLike,
	matchesShortcut,
} from '../../src/shared/keymap';

function event(overrides: Partial<KeyboardEventLike>): KeyboardEventLike {
	return {
		key: '',
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...overrides,
	};
}

/**
 * The physical key `mod` resolves to on the running platform: Command on macOS,
 * Control everywhere else. The suite runs on both CI legs now that Ensemblr
 * ships a Linux build, so a `metaKey: true` literal would assert the macOS
 * mapping against a Linux runner and fail for the right reason in the wrong
 * place.
 */
const MOD_KEY: 'ctrlKey' | 'metaKey' =
	process.platform === 'darwin' ? 'metaKey' : 'ctrlKey';

/** Builds an event with the platform's `mod` key held, plus any other overrides. */
function modEvent(overrides: Partial<KeyboardEventLike>): KeyboardEventLike {
	return event({ ...overrides, [MOD_KEY]: true });
}

describe('matchesShortcut — alt+letter on macOS', () => {
	test('⌥P matches the model-picker toggle via physical code (key is "π")', () => {
		expect(
			matchesShortcut(
				'composer.toggleModelPicker',
				event({ key: 'π', code: 'KeyP', altKey: true }),
			),
		).toBe(true);
	});

	test('⌥T matches cycle-thinking via physical code (key is "†")', () => {
		expect(
			matchesShortcut(
				'composer.cycleThinking',
				event({ key: '†', code: 'KeyT', altKey: true }),
			),
		).toBe(true);
	});

	test('falls back to key when code is absent (synthetic events)', () => {
		expect(
			matchesShortcut(
				'composer.toggleModelPicker',
				event({ key: 'p', altKey: true }),
			),
		).toBe(true);
	});

	test('does not fire without the alt modifier', () => {
		expect(
			matchesShortcut(
				'composer.toggleModelPicker',
				event({ key: 'p', code: 'KeyP' }),
			),
		).toBe(false);
	});

	test('does not fire with an extra modifier held', () => {
		expect(
			matchesShortcut(
				'composer.toggleModelPicker',
				event({ key: 'π', code: 'KeyP', altKey: true, metaKey: true }),
			),
		).toBe(false);
	});

	test('the wrong physical key does not match', () => {
		expect(
			matchesShortcut(
				'composer.cycleThinking',
				event({ key: 'π', code: 'KeyP', altKey: true }),
			),
		).toBe(false);
	});
});

describe('matchesShortcut — ctrl is the physical Control key', () => {
	test('Ctrl+O matches the tool-call toggle', () => {
		expect(
			matchesShortcut(
				'toolCalls.toggleCollapse',
				event({ key: 'o', code: 'KeyO', ctrlKey: true }),
			),
		).toBe(true);
	});

	test('⌘O does NOT match the ctrl-bound toggle', () => {
		// Command is a distinct physical key from Control, and nothing binds it
		// here — on Linux there is no Command key at all, so this holds either way.
		expect(
			matchesShortcut(
				'toolCalls.toggleCollapse',
				event({ key: 'o', code: 'KeyO', metaKey: true }),
			),
		).toBe(false);
	});

	test('bare O (no modifier) does not match', () => {
		expect(
			matchesShortcut('toolCalls.toggleCollapse', event({ key: 'o' })),
		).toBe(false);
	});
});

describe('matchesShortcut — non-alt bindings unaffected', () => {
	test('plain digit matches the model-picker index shortcut', () => {
		expect(
			matchesShortcut('modelPicker.selectByIndex', event({ key: '1' })),
		).toBe(true);
	});
});

describe('matchesShortcut — tab navigation', () => {
	test('mod+⇧] matches next-tab via physical code (shifted key is "}")', () => {
		expect(
			matchesShortcut(
				'tab.next',
				modEvent({
					key: '}',
					code: 'BracketRight',
					shiftKey: true,
				}),
			),
		).toBe(true);
	});

	test('mod+⇧[ matches prev-tab via physical code (shifted key is "{")', () => {
		expect(
			matchesShortcut(
				'tab.prev',
				modEvent({ key: '{', code: 'BracketLeft', shiftKey: true }),
			),
		).toBe(true);
	});

	test('the wrong bracket does not match', () => {
		expect(
			matchesShortcut(
				'tab.next',
				modEvent({ key: '{', code: 'BracketLeft', shiftKey: true }),
			),
		).toBe(false);
	});

	test('bracket without shift does not match the shifted binding', () => {
		expect(
			matchesShortcut('tab.next', modEvent({ key: ']', code: 'BracketRight' })),
		).toBe(false);
	});

	test('falls back to key when code is absent (synthetic events)', () => {
		expect(
			matchesShortcut('tab.next', modEvent({ key: ']', shiftKey: true })),
		).toBe(true);
	});

	test('mod+1 matches select-tab-by-index', () => {
		expect(
			matchesShortcut(
				'tab.selectByIndex',
				modEvent({ key: '1', code: 'Digit1' }),
			),
		).toBe(true);
	});

	test('bare digit does not match the mod-bound index shortcut', () => {
		expect(
			matchesShortcut('tab.selectByIndex', event({ key: '1', code: 'Digit1' })),
		).toBe(false);
	});
});

describe('matchesShortcut — composer submit', () => {
	test('plain Enter matches composer.submit, not the mod variant', () => {
		const e = event({ key: 'Enter', code: 'Enter' });
		expect(matchesShortcut('composer.submit', e)).toBe(true);
		expect(matchesShortcut('composer.submitWithMod', e)).toBe(false);
	});

	test('mod+Enter matches composer.submitWithMod, not the plain variant', () => {
		const e = modEvent({ key: 'Enter', code: 'Enter' });
		expect(matchesShortcut('composer.submitWithMod', e)).toBe(true);
		expect(matchesShortcut('composer.submit', e)).toBe(false);
	});

	// Four shortcuts sit on Enter and are told apart by modifiers alone, so adding
	// the queue-bypassing send is exactly the kind of change that silently steals
	// a chord from one of the other three.
	test('mod+shift+Enter matches composer.sendNow and none of the other Enter bindings', () => {
		const e = modEvent({ key: 'Enter', code: 'Enter', shiftKey: true });
		expect(matchesShortcut('composer.sendNow', e)).toBe(true);
		expect(matchesShortcut('composer.submit', e)).toBe(false);
		expect(matchesShortcut('composer.submitWithMod', e)).toBe(false);
		expect(matchesShortcut('composer.newline', e)).toBe(false);
	});

	test('composer.sendNow does not fire on the plain or mod-only Enter', () => {
		expect(
			matchesShortcut(
				'composer.sendNow',
				event({ key: 'Enter', code: 'Enter' }),
			),
		).toBe(false);
		expect(
			matchesShortcut(
				'composer.sendNow',
				modEvent({ key: 'Enter', code: 'Enter' }),
			),
		).toBe(false);
	});
});

/**
 * Modifier order is a platform convention, not a preference: macOS renders the
 * fixed run ⌃⌥⇧⌘, while Windows and Linux put Ctrl first. The suite runs on
 * both CI legs, so each case states the expectation for the running platform.
 */
const IS_MAC = process.platform === 'darwin';

describe('formatChord — modifier order per platform', () => {
	test('mod alone', () => {
		expect(formatChord(['mod'], 'O')).toBe(IS_MAC ? '⌘O' : 'Ctrl+O');
	});

	test('shift+mod puts Ctrl first off macOS', () => {
		expect(formatChord(['shift', 'mod'], 'Z')).toBe(
			IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z',
		);
	});

	test('alt+mod puts Ctrl first off macOS', () => {
		expect(formatChord(['alt', 'mod'], 'U')).toBe(
			IS_MAC ? '⌥⌘U' : 'Ctrl+Alt+U',
		);
	});

	test('the order the modifiers are passed in does not change the label', () => {
		expect(formatChord(['mod', 'shift'], 'N')).toBe(
			formatChord(['shift', 'mod'], 'N'),
		);
	});

	test('every modifier at once', () => {
		expect(formatChord(['mod', 'ctrl', 'alt', 'shift'], 'K')).toBe(
			IS_MAC ? '⌃⌥⇧⌘K' : 'Ctrl+Alt+Shift+K',
		);
	});

	test('mod and ctrl collapse to one Ctrl off macOS', () => {
		expect(formatChord(['mod', 'ctrl'], 'K')).toBe(IS_MAC ? '⌃⌘K' : 'Ctrl+K');
	});

	test('named keys render as glyphs on macOS and words elsewhere', () => {
		expect(formatChord(['mod'], 'Enter')).toBe(IS_MAC ? '⌘↵' : 'Ctrl+Enter');
	});

	test('formatShortcut labels a registered shortcut the same way', () => {
		expect(formatShortcut('tab.next')).toBe(IS_MAC ? '⇧⌘]' : 'Ctrl+Shift+]');
	});
});
