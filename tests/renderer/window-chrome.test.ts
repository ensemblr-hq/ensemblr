// @vitest-environment happy-dom

import { beforeEach, expect, test } from 'vitest';

import { applyWindowChrome } from '../../src/renderer/lib/window-chrome';
import { resolveWindowChrome } from '../../src/shared/window-chrome';

beforeEach(() => {
	document.documentElement.className = '';
});

test('macOS inset controls mark the document so its toolbars drag', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system'));

	const root = document.documentElement;
	expect(root.classList.contains('inset-window-controls')).toBe(true);
	expect(root.classList.contains('app-window-controls')).toBe(false);
});

test('the Linux custom title bar marks own-controls, not inset', () => {
	applyWindowChrome(resolveWindowChrome('linux', 'custom'));

	const root = document.documentElement;
	expect(root.classList.contains('app-window-controls')).toBe(true);
	expect(root.classList.contains('inset-window-controls')).toBe(false);
});

test('a system-framed window claims neither drag marker', () => {
	applyWindowChrome(resolveWindowChrome('linux', 'system'));

	const root = document.documentElement;
	expect(root.classList.contains('app-window-controls')).toBe(false);
	expect(root.classList.contains('inset-window-controls')).toBe(false);
});

test('re-applying a different chrome clears the previous marker', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system'));
	applyWindowChrome(resolveWindowChrome('linux', 'system'));

	expect(
		document.documentElement.classList.contains('inset-window-controls'),
	).toBe(false);
});
