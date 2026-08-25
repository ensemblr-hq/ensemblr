// @vitest-environment happy-dom

/**
 * The bottom-right corner is shared real estate: sonner stacks toasts 24px up
 * from it and the Setup pane floats its rerun control there. These tests pin the
 * undragged Concierge clear of both, and pin the drag that follows as still
 * being the thing that decides where the surface lives.
 */

import { renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { beforeEach, describe, expect, test } from 'vitest';

import { useConciergeAnchor } from '../../src/renderer/hooks/concierge/use-concierge-anchor';
import {
	CONCIERGE_MIN_PANEL_SIZE,
	CONCIERGE_UNPLACED,
	conciergeAnchorAtom,
} from '../../src/renderer/state/concierge';
import { installLocalStorage } from './support/dom';

const LAUNCHER_SIZE = { height: 44, width: 44 };

/** Bottom edge of the zone toasts and the rerun control occupy, in pixels. */
const OCCUPIED_CORNER_HEIGHT = 76;

/**
 * Mounts the anchor hook against a real node and reports where it placed it.
 * @param anchor - The persisted corner to place from.
 * @param size - The surface's own width and height.
 * @returns The node's offsets from the viewport's bottom and right edges.
 */
function placeSurface(anchor = CONCIERGE_UNPLACED, size = LAUNCHER_SIZE) {
	getDefaultStore().set(conciergeAnchorAtom, anchor);
	const node = document.createElement('button');
	document.body.append(node);
	const ref = { current: node };

	renderHook(() =>
		useConciergeAnchor<HTMLButtonElement>({ externalRef: ref, size }),
	);

	return {
		fromBottom:
			window.innerHeight - Number.parseFloat(node.style.top) - size.height,
		fromRight:
			window.innerWidth - Number.parseFloat(node.style.left) - size.width,
	};
}

describe('the undragged Concierge surface', () => {
	beforeEach(() => {
		installLocalStorage();
		document.body.replaceChildren();
	});

	test('docks clear of the toast stack and the rerun control', () => {
		const { fromBottom } = placeSurface();

		expect(fromBottom).toBeGreaterThan(OCCUPIED_CORNER_HEIGHT);
	});

	test('still hugs the right edge', () => {
		const { fromRight } = placeSurface();

		expect(fromRight).toBe(16);
	});

	// The panel opens where the bubble was, so the two have to dock on the same
	// corner: a launcher-only margin would make opening the panel jump.
	test('hands the panel the same corner it docked the bubble on', () => {
		const bubble = placeSurface();
		const panel = placeSurface(CONCIERGE_UNPLACED, CONCIERGE_MIN_PANEL_SIZE);

		expect(panel.fromBottom).toBe(bubble.fromBottom);
		expect(panel.fromRight).toBe(bubble.fromRight);
	});

	test('gives the corner back once the user has dragged it there', () => {
		const { fromBottom } = placeSurface({
			x: window.innerWidth - 16,
			y: window.innerHeight - 16,
		});

		expect(fromBottom).toBe(16);
	});
});
