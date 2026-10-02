// @vitest-environment happy-dom

import { beforeEach, expect, test } from 'vitest';

import {
	applyWindowChrome,
	readWindowChrome,
	readWindowChromeInsetsPx,
} from '../../src/renderer/lib/window-chrome';
import {
	resolveWindowChrome,
	TRAFFIC_LIGHT_INSET_REM,
} from '../../src/shared/window-chrome';

const INSET_START = '--ensemblr-window-chrome-inset-start';

beforeEach(() => {
	document.documentElement.className = '';
	document.documentElement.removeAttribute('style');
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

test('macOS full screen gives back the gutter the traffic lights held', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system', true));

	expect(document.documentElement.style.getPropertyValue(INSET_START)).toBe(
		'0rem',
	);
});

test('leaving full screen reserves the traffic lights their corner again', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system', true));
	applyWindowChrome(resolveWindowChrome('darwin', 'system', false));

	expect(document.documentElement.style.getPropertyValue(INSET_START)).toBe(
		`${TRAFFIC_LIGHT_INSET_REM}rem`,
	);
});

test('full screen keeps macOS toolbars marked as the drag surface', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system', true));

	expect(
		document.documentElement.classList.contains('inset-window-controls'),
	).toBe(true);
});

test('the pixel insets follow the chrome into full screen and back out', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system', true));

	expect(readWindowChromeInsetsPx().start).toBe(0);

	applyWindowChrome(resolveWindowChrome('darwin', 'system', false));

	expect(readWindowChromeInsetsPx().start).toBe(TRAFFIC_LIGHT_INSET_REM * 16);
});

test('the readers report the applied chrome rather than the boot snapshot', () => {
	applyWindowChrome(resolveWindowChrome('darwin', 'system', true));

	expect(readWindowChrome().fullScreen).toBe(true);
	expect(readWindowChrome().insets.start).toBe(0);
	expect(readWindowChrome().insets.start * 16).toBe(
		readWindowChromeInsetsPx().start,
	);
});
