// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { act } from 'react';
import { expect, test, vi } from 'vitest';

import { useConciergeRestoreOnOutsidePress } from '../../src/renderer/hooks/concierge/use-concierge-restore-on-outside-press';

/**
 * Mounts the hook over a panel element with an outside sibling and a portal
 * layer, mirroring the three places a press can land.
 * @param isFullscreen - Whether the panel is maximized.
 * @returns The restore spy and the three press targets.
 */
function renderHarness(isFullscreen: boolean) {
	const restore = vi.fn();

	function Harness() {
		const panelRef = { current: document.getElementById('panel') };
		useConciergeRestoreOnOutsidePress(isFullscreen, panelRef, restore);
		return null;
	}

	document.body.innerHTML = `
		<section id="panel"><button id="inside">inside</button></section>
		<nav id="sidebar"><button id="workspace-row">workspace</button></nav>
		<div data-radix-popper-content-wrapper><button id="model-picker">model</button></div>
	`;
	render(<Harness />);

	return {
		insideButton: document.getElementById('inside') as HTMLElement,
		pickerOption: document.getElementById('model-picker') as HTMLElement,
		restore,
		workspaceRow: document.getElementById('workspace-row') as HTMLElement,
	};
}

/**
 * Fires the capture-phase pointerdown the hook listens for.
 * @param target - Element the press lands on.
 */
function pressOn(target: HTMLElement): void {
	act(() => {
		target.dispatchEvent(
			new window.PointerEvent('pointerdown', { bubbles: true }),
		);
	});
}

test('a press outside the maximized panel puts it back to its docked card', () => {
	const { restore, workspaceRow } = renderHarness(true);

	pressOn(workspaceRow);

	expect(restore).toHaveBeenCalledTimes(1);
});

test('a press inside the panel leaves it maximized', () => {
	const { insideButton, restore } = renderHarness(true);

	pressOn(insideButton);

	expect(restore).not.toHaveBeenCalled();
});

test('a press in one of the panel’s portalled layers is not a press away', () => {
	const { pickerOption, restore } = renderHarness(true);

	pressOn(pickerOption);

	expect(restore).not.toHaveBeenCalled();
});

test('a docked panel is left alone — there is nothing to restore', () => {
	const { restore, workspaceRow } = renderHarness(false);

	pressOn(workspaceRow);

	expect(restore).not.toHaveBeenCalled();
});
