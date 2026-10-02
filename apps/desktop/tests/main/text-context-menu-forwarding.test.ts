import type { ContextMenuParams } from 'electron';
import { expect, test } from 'vitest';

import { toTextContextMenuTarget } from '../../src/main/app/text-context-menu-forwarding';

/** Chromium's report of an ordinary right-click, before a case varies it. */
function params(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
	return {
		dictionarySuggestions: [],
		editFlags: {
			canCopy: true,
			canCut: true,
			canDelete: true,
			canEditRichly: true,
			canPaste: true,
			canRedo: true,
			canSelectAll: true,
			canUndo: true,
		},
		isEditable: false,
		misspelledWord: '',
		selectionText: '',
		x: 120,
		y: 240,
		...overrides,
	} as ContextMenuParams;
}

test('every field Chromium reports reaches the renderer', () => {
	const target = toTextContextMenuTarget(
		params({
			dictionarySuggestions: ['receive'],
			isEditable: true,
			misspelledWord: 'recieve',
			selectionText: 'recieve',
		}),
		1,
	);

	expect(target).toEqual({
		canCopy: true,
		canCut: true,
		canPaste: true,
		canRedo: true,
		canSelectAll: true,
		canUndo: true,
		dictionarySuggestions: ['receive'],
		isEditable: true,
		misspelledWord: 'recieve',
		selectionText: 'recieve',
		x: 120,
		y: 240,
	});
});

test("the edit flags survive individually rather than as one 'everything is allowed'", () => {
	const target = toTextContextMenuTarget(
		params({
			editFlags: {
				canCopy: false,
				canCut: false,
				canDelete: false,
				canEditRichly: false,
				canPaste: true,
				canRedo: false,
				canSelectAll: true,
				canUndo: true,
			},
		}),
		1,
	);

	expect(target.canCopy).toBe(false);
	expect(target.canCut).toBe(false);
	expect(target.canPaste).toBe(true);
	expect(target.canRedo).toBe(false);
	expect(target.canSelectAll).toBe(true);
	expect(target.canUndo).toBe(true);
});

test('a zoomed window reports the click in CSS pixels', () => {
	const zoomedIn = toTextContextMenuTarget(params(), 1.5);
	expect(zoomedIn.x).toBe(80);
	expect(zoomedIn.y).toBe(160);

	const zoomedOut = toTextContextMenuTarget(params(), 0.5);
	expect(zoomedOut.x).toBe(240);
	expect(zoomedOut.y).toBe(480);
});

test('an unreported zoom leaves the coordinates alone rather than voiding them', () => {
	for (const zoomFactor of [0, Number.NaN]) {
		const target = toTextContextMenuTarget(params(), zoomFactor);

		expect(target.x).toBe(120);
		expect(target.y).toBe(240);
	}
});
