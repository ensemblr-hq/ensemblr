import { describe, expect, it } from 'vitest';

import {
	clampZoom,
	fitViewport,
	IDENTITY_VIEWPORT,
	panViewport,
	wheelZoom,
	ZOOM,
	zoomAbout,
} from '../../src/renderer/lib/architecture-diagram/viewport';

describe('clampZoom', () => {
	it('holds the requested scale inside the advertised bounds', () => {
		expect(clampZoom(99)).toBe(ZOOM.max);
		expect(clampZoom(0)).toBe(ZOOM.min);
		expect(clampZoom(1.4)).toBe(1.4);
	});
});

describe('zoomAbout', () => {
	// Without this the drawing walks out of the pane on every zoom and the user
	// has to chase it back with the scrollbars that no longer exist.
	it('keeps the point under the cursor exactly where it was', () => {
		const focus = { x: 300, y: 180 };
		const before = { x: -120, y: -40, zoom: 1 };
		const after = zoomAbout(before, 2, focus);

		const at = (view: typeof before, axis: 'x' | 'y') =>
			(focus[axis] - view[axis]) / view.zoom;

		expect(at(after, 'x')).toBeCloseTo(at(before, 'x'), 10);
		expect(at(after, 'y')).toBeCloseTo(at(before, 'y'), 10);
	});

	it('clamps rather than running past the bounds', () => {
		expect(zoomAbout(IDENTITY_VIEWPORT, 40, { x: 0, y: 0 }).zoom).toBe(
			ZOOM.max,
		);
	});
});

describe('wheelZoom', () => {
	it('zooms in on a negative delta and out on a positive one', () => {
		expect(wheelZoom(1, -100, 'wheel')).toBeGreaterThan(1);
		expect(wheelZoom(1, 100, 'wheel')).toBeLessThan(1);
	});

	// A trackpad pinch arrives as a wheel event with deltas an order of
	// magnitude smaller, so sharing the wheel's divisor makes it feel dead.
	it('responds harder to a pinch than to a wheel of the same delta', () => {
		expect(wheelZoom(1, -20, 'pinch')).toBeGreaterThan(
			wheelZoom(1, -20, 'wheel'),
		);
	});
});

describe('fitViewport', () => {
	it('frames a drawing larger than the pane and centres it', () => {
		const view = fitViewport([1000, 2000], { height: 400, width: 800 });

		expect(view.zoom).toBeCloseTo((400 - 48) / 2000, 10);
		expect(view.x).toBeCloseTo((800 - 1000 * view.zoom) / 2, 10);
		expect(view.y).toBeCloseTo((400 - 2000 * view.zoom) / 2, 10);
	});

	it('never magnifies a small drawing past actual size', () => {
		expect(fitViewport([100, 100], { height: 900, width: 1600 }).zoom).toBe(1);
	});

	it('stays at identity while the pane is still unmeasured', () => {
		expect(fitViewport([1000, 1000], { height: 0, width: 0 })).toEqual(
			IDENTITY_VIEWPORT,
		);
	});
});

describe('panViewport', () => {
	it('moves the drawing and leaves the scale alone', () => {
		expect(panViewport({ x: 10, y: 20, zoom: 1.5 }, -4, 6)).toEqual({
			x: 6,
			y: 26,
			zoom: 1.5,
		});
	});
});
