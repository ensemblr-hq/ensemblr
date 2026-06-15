/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import {
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

	test('on macOS, ⌘O does NOT match the ctrl-bound toggle', () => {
		// The runner is darwin, so metaKey is ⌘ — a distinct key from Control.
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

describe('matchesShortcut — composer submit', () => {
	test('plain Enter matches composer.submit, not the mod variant', () => {
		const e = event({ key: 'Enter', code: 'Enter' });
		expect(matchesShortcut('composer.submit', e)).toBe(true);
		expect(matchesShortcut('composer.submitWithMod', e)).toBe(false);
	});

	test('mod+Enter matches composer.submitWithMod, not the plain variant', () => {
		// `mod` resolves to ⌘ on macOS (the test runner is darwin).
		const e = event({ key: 'Enter', code: 'Enter', metaKey: true });
		expect(matchesShortcut('composer.submitWithMod', e)).toBe(true);
		expect(matchesShortcut('composer.submit', e)).toBe(false);
	});
});
