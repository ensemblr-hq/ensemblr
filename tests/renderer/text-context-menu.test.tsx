// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { TextContextMenu } from '../../src/renderer/components/text-context-menu';
import type { TextContextMenuTarget } from '../../src/shared/ipc/contracts/text-editing';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const writeText = vi.fn(async () => {});
const runTextEditCommand = vi.fn(async () => {});
const replaceMisspelling = vi.fn(async () => {});
const addWordToDictionary = vi.fn(async () => {});

let emit: ((payload: TextContextMenuTarget) => void) | null = null;

/** The payload main sends for a plain right-click with nothing special about it. */
function target(
	overrides: Partial<TextContextMenuTarget> = {},
): TextContextMenuTarget {
	return {
		canCopy: true,
		canCut: true,
		canPaste: true,
		canRedo: true,
		canSelectAll: true,
		canUndo: true,
		dictionarySuggestions: [],
		isEditable: false,
		misspelledWord: '',
		selectionText: '',
		x: 10,
		y: 20,
		...overrides,
	};
}

/**
 * Pretends the click landed on the given element, which is how the component
 * decides whether the right-click was inside its own subtree.
 */
function clickLandedOn(element: Element | null) {
	vi.spyOn(document, 'elementFromPoint').mockReturnValue(element);
}

/** Delivers a right-click payload the way the main process would. */
async function rightClick(payload: TextContextMenuTarget) {
	await act(async () => {
		emit?.(payload);
	});
}

/** Reads the open menu's rows in order, label plus shortcut as rendered. */
function menuRows(): (string | null)[] {
	return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

/**
 * Finds one open menu row by its label.
 * @param label - The row's visible label
 * @returns The matching menu item element
 */
async function findMenuItem(label: string): Promise<HTMLElement> {
	const items = await screen.findAllByRole('menuitem');
	const match = items.find((item) => item.textContent?.startsWith(label));

	if (!match) {
		throw new Error(`No "${label}" row among: ${menuRows().join(', ')}`);
	}

	return match;
}

/** A read-only transcript wrapped in the menu. */
function renderTranscript() {
	const view = renderWithProviders(
		<TextContextMenu>
			<p data-testid='transcript'>selected prose</p>
		</TextContextMenu>,
	);
	clickLandedOn(screen.getByTestId('transcript'));
	return view;
}

/** An editable composer stand-in wrapped in the menu. */
function renderComposer() {
	const view = renderWithProviders(
		<TextContextMenu>
			<div data-testid='composer'>
				{/* biome-ignore lint/a11y/useSemanticElements: stands in for the composer's Lexical surface */}
				<div
					contentEditable
					role='textbox'
					suppressContentEditableWarning
					tabIndex={0}
				>
					draft
				</div>
			</div>
		</TextContextMenu>,
	);
	clickLandedOn(screen.getByRole('textbox'));
	return view;
}

beforeEach(() => {
	writeText.mockClear();
	runTextEditCommand.mockClear();
	replaceMisspelling.mockClear();
	addWordToDictionary.mockClear();
	emit = null;
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
	installEnsemblrApi({
		addWordToDictionary,
		onTextContextMenu: (listener: (payload: TextContextMenuTarget) => void) => {
			emit = listener;
			return () => {
				emit = null;
			};
		},
		replaceMisspelling,
		runTextEditCommand,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	clearEnsemblrApi();
});

test('a read-only surface offers only the commands it can run', async () => {
	renderTranscript();

	await rightClick(target({ selectionText: 'selected prose' }));

	await findMenuItem('Copy');
	expect(menuRows()).toEqual(['Copy⌘C', 'Select all']);
});

test('an editable surface offers the clipboard and history commands', async () => {
	renderComposer();

	await rightClick(target({ isEditable: true, selectionText: 'draft' }));

	await findMenuItem('Paste');
	expect(menuRows()).toEqual([
		'Undo⌘Z',
		'Redo⇧⌘Z',
		'Cut⌘X',
		'Copy⌘C',
		'Paste⌘V',
		'Select all⌘A',
	]);
});

test("Chromium's edit flags drive which rows are available", async () => {
	renderComposer();

	await rightClick(
		target({
			canCopy: false,
			canCut: false,
			canPaste: true,
			isEditable: true,
		}),
	);

	expect(await findMenuItem('Cut')).toHaveAttribute('data-disabled');
	expect(await findMenuItem('Copy')).toHaveAttribute('data-disabled');
	expect(await findMenuItem('Paste')).not.toHaveAttribute('data-disabled');
});

test('undo and redo stay available whatever Chromium reports', async () => {
	renderComposer();

	await rightClick(
		target({ canRedo: false, canUndo: false, isEditable: true }),
	);

	expect(await findMenuItem('Undo')).not.toHaveAttribute('data-disabled');
	expect(await findMenuItem('Redo')).not.toHaveAttribute('data-disabled');

	fireEvent.click(await findMenuItem('Undo'));
	await waitFor(() => {
		expect(runTextEditCommand).toHaveBeenCalledWith('undo');
	});
});

test('a right-click outside the surface never opens its menu', async () => {
	renderTranscript();
	clickLandedOn(document.createElement('div'));

	await rightClick(target({ selectionText: 'prose from elsewhere' }));

	expect(screen.queryByRole('menuitem')).toBeNull();
});

test('a misspelled word offers its corrections first', async () => {
	renderComposer();

	await rightClick(
		target({
			dictionarySuggestions: ['receive', 'relieve'],
			isEditable: true,
			misspelledWord: 'recieve',
			selectionText: 'recieve',
		}),
	);

	await findMenuItem('receive');
	expect(menuRows().slice(0, 3)).toEqual([
		'receive',
		'relieve',
		'Add to dictionary',
	]);
});

test('picking a correction replaces the word in the focused field', async () => {
	renderComposer();

	await rightClick(
		target({
			dictionarySuggestions: ['receive'],
			isEditable: true,
			misspelledWord: 'recieve',
		}),
	);
	fireEvent.click(await findMenuItem('receive'));

	await waitFor(() => {
		expect(replaceMisspelling).toHaveBeenCalledWith({ replacement: 'receive' });
	});
	expect(document.activeElement).toBe(screen.getByRole('textbox'));
});

test('a flagged word with no correction still offers the dictionary', async () => {
	renderComposer();

	await rightClick(target({ isEditable: true, misspelledWord: 'ensemblr' }));

	expect(await findMenuItem('No suggestions')).toHaveAttribute('data-disabled');

	fireEvent.click(await findMenuItem('Add to dictionary'));
	await waitFor(() => {
		expect(addWordToDictionary).toHaveBeenCalledWith({ word: 'ensemblr' });
	});
});

test('copying on a read-only surface writes the live selection, not the truncated one', async () => {
	vi.spyOn(window, 'getSelection').mockReturnValue({
		toString: () => 'the whole untruncated selection',
	} as unknown as Selection);
	renderTranscript();

	await rightClick(target({ selectionText: 'the whole untrunc' }));
	fireEvent.click(await findMenuItem('Copy'));

	await waitFor(() => {
		expect(writeText).toHaveBeenCalledWith('the whole untruncated selection');
	});
	expect(runTextEditCommand).not.toHaveBeenCalled();
});

test('an editable command focuses the field before the main process runs it', async () => {
	renderComposer();

	await rightClick(target({ isEditable: true }));
	fireEvent.click(await findMenuItem('Paste'));

	await waitFor(() => {
		expect(runTextEditCommand).toHaveBeenCalledWith('paste');
	});
	expect(document.activeElement).toBe(screen.getByRole('textbox'));
});

test("select all follows Chromium's verdict only where Chromium runs it", async () => {
	const { unmount } = renderComposer();

	await rightClick(target({ canSelectAll: false, isEditable: true }));
	expect(await findMenuItem('Select all')).toHaveAttribute('data-disabled');
	unmount();

	renderTranscript();

	await rightClick(target({ canSelectAll: false }));
	expect(await findMenuItem('Select all')).not.toHaveAttribute('data-disabled');
});

test('dismissing without picking a row puts focus back in the field', async () => {
	renderComposer();

	await rightClick(target({ isEditable: true }));
	await findMenuItem('Paste');

	await act(async () => {
		fireEvent.keyDown(document, { key: 'Escape' });
	});

	await waitFor(() => {
		expect(document.activeElement).toBe(screen.getByRole('textbox'));
	});
	expect(runTextEditCommand).not.toHaveBeenCalled();
});

test('select all on a read-only surface scopes the range to the surface', async () => {
	const addRange = vi.fn();
	vi.spyOn(window, 'getSelection').mockReturnValue({
		addRange,
		removeAllRanges: vi.fn(),
	} as unknown as Selection);
	renderTranscript();

	await rightClick(target());
	fireEvent.click(await findMenuItem('Select all'));

	await waitFor(() => {
		expect(addRange).toHaveBeenCalledTimes(1);
	});
	const range = addRange.mock.calls[0]?.[0] as unknown as Range;
	expect(range.commonAncestorContainer).toContainElement(
		screen.getByTestId('transcript'),
	);
	expect(runTextEditCommand).not.toHaveBeenCalled();
});
