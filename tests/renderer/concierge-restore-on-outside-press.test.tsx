// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { useConciergeRestoreOnOutsidePress } from '../../src/renderer/hooks/concierge/use-concierge-restore-on-outside-press';

/**
 * Mounts the hook over a panel element beside the shapes a press can land on:
 * a navigating row in the nav sidebar, the sidebar's own collapse controls, the
 * window-control cluster, and a portalled layer.
 * @param isFullscreen - Whether the panel is maximized.
 * @returns The restore spy and every press target.
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
		<div data-slot="sidebar">
			<button data-slot="sidebar-trigger" id="sidebar-toggle">toggle</button>
			<button data-slot="sidebar-rail" id="sidebar-rail">rail</button>
			<button id="workspace-row">workspace</button>
		</div>
		<div class="fixed top-0 right-0 z-50"><button id="minimize">minimize</button></div>
		<div data-radix-popper-content-wrapper><button id="model-picker">model</button></div>
		<div data-slot="dialog-overlay" id="dialog-overlay"></div>
	`;
	render(<Harness />);

	return {
		dialogOverlay: document.getElementById('dialog-overlay') as HTMLElement,
		insideButton: document.getElementById('inside') as HTMLElement,
		minimizeButton: document.getElementById('minimize') as HTMLElement,
		pickerOption: document.getElementById('model-picker') as HTMLElement,
		restore,
		sidebarRail: document.getElementById('sidebar-rail') as HTMLElement,
		sidebarToggle: document.getElementById('sidebar-toggle') as HTMLElement,
		workspaceRow: document.getElementById('workspace-row') as HTMLElement,
	};
}

/**
 * Fires the capture-phase pointerdown the hook listens for.
 * @param target - Element the press lands on.
 */
function pressOn(target: Element): void {
	act(() => {
		target.dispatchEvent(
			new window.PointerEvent('pointerdown', { bubbles: true }),
		);
	});
}

afterEach(() => {
	document.body.style.pointerEvents = '';
});

test('a press on a navigating sidebar row puts the panel back to its docked card', () => {
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

test('dismissing a modal layer, which hit-tests to <html>, leaves the panel maximized', () => {
	const { restore } = renderHarness(true);
	document.body.style.pointerEvents = 'none';

	pressOn(document.documentElement);

	expect(restore).not.toHaveBeenCalled();
});

test('a press on a dialog backdrop leaves the panel maximized', () => {
	const { dialogOverlay, restore } = renderHarness(true);

	pressOn(dialogOverlay);

	expect(restore).not.toHaveBeenCalled();
});

test('collapsing the sidebar from its own trigger leaves the panel maximized', () => {
	const { restore, sidebarToggle } = renderHarness(true);

	pressOn(sidebarToggle);

	expect(restore).not.toHaveBeenCalled();
});

test('dragging the sidebar rail leaves the panel maximized', () => {
	const { restore, sidebarRail } = renderHarness(true);

	pressOn(sidebarRail);

	expect(restore).not.toHaveBeenCalled();
});

test('minimizing the window from the control cluster leaves the panel maximized', () => {
	const { minimizeButton, restore } = renderHarness(true);

	pressOn(minimizeButton);

	expect(restore).not.toHaveBeenCalled();
});

test('a docked panel is left alone — there is nothing to restore', () => {
	const { restore, workspaceRow } = renderHarness(false);

	pressOn(workspaceRow);

	expect(restore).not.toHaveBeenCalled();
});
