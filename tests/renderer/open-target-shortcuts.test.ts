import { afterAll, beforeAll, expect, test } from 'bun:test';

import { shouldIgnoreShortcut } from '../../src/renderer/hooks/workbench-shell/use-open-target-shortcuts';

function makeEvent(target: EventTarget | null): KeyboardEvent {
	return { target } as unknown as KeyboardEvent;
}

class FakeElement {
	constructor(
		public readonly tagName: string,
		public readonly isContentEditable: boolean = false,
	) {}
}

const globalScope = globalThis as unknown as {
	HTMLElement?: typeof FakeElement | typeof HTMLElement;
};
const originalHtmlElement = globalScope.HTMLElement;

// `shouldIgnoreShortcut` uses `instanceof HTMLElement`; we expose a constructor
// so our fakes pass the check in this Node test environment. Restore the
// original value afterwards so co-running test files (e.g. SSR-based ones)
// don't see a polluted global.
beforeAll(() => {
	globalScope.HTMLElement = FakeElement;
});
afterAll(() => {
	if (originalHtmlElement) {
		globalScope.HTMLElement = originalHtmlElement;
	} else {
		delete globalScope.HTMLElement;
	}
});

test('lets shortcuts fire when the event target is not an element', () => {
	expect(shouldIgnoreShortcut(makeEvent(null))).toBe(false);
});

test('blocks shortcuts while typing in inputs / textareas / selects', () => {
	for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
		const element = new FakeElement(tag);
		expect(
			shouldIgnoreShortcut(makeEvent(element as unknown as EventTarget)),
		).toBe(true);
	}
});

test('blocks shortcuts while typing in a contenteditable surface', () => {
	const element = new FakeElement('DIV', true);
	expect(
		shouldIgnoreShortcut(makeEvent(element as unknown as EventTarget)),
	).toBe(true);
});

test('lets shortcuts fire when the event target is a non-editable element', () => {
	const element = new FakeElement('BUTTON');
	expect(
		shouldIgnoreShortcut(makeEvent(element as unknown as EventTarget)),
	).toBe(false);
});
