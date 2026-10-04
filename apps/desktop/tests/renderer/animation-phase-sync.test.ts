// @vitest-environment happy-dom

/**
 * A CSS animation starts its own clock when its element mounts, so every
 * spinner on screen used to turn at its own phase. The sync pins each synced
 * loop's `startTime` to the wall-clock grid of its own period the moment it
 * starts, so any two instances show the same frame whenever they mounted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncLoopingAnimationPhases } from '@/renderer/lib/animation-phase-sync';

interface FakeAnimation {
	animationName?: string;
	startTime: number | null;
	effect: {
		getComputedTiming: () => { duration: number | string };
	} | null;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

let stopSync: () => void = () => undefined;

beforeEach(() => {
	stopSync = syncLoopingAnimationPhases();
});

afterEach(() => {
	stopSync();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function cssAnimation(
	animationName: string,
	duration: number | string,
): FakeAnimation {
	return {
		animationName,
		startTime: null,
		effect: { getComputedTiming: () => ({ duration }) },
	};
}

function cssTransition(duration: number): FakeAnimation {
	return {
		startTime: null,
		effect: { getComputedTiming: () => ({ duration }) },
	};
}

function mountRunning(...animations: FakeAnimation[]): Element {
	const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
	document.body.append(icon);
	vi.spyOn(icon, 'getAnimations').mockReturnValue(
		animations as unknown as Animation[],
	);
	return icon;
}

function announceStart(element: Element, animationName: string): void {
	element.dispatchEvent(
		new AnimationEvent('animationstart', { animationName, bubbles: true }),
	);
}

function wallClockAnchor(period: number): number {
	return -(performance.timeOrigin % period);
}

describe('syncLoopingAnimationPhases', () => {
	it('pins a starting spinner to the wall-clock grid of its period', () => {
		const spin = cssAnimation('spin', 1000);
		announceStart(mountRunning(spin), 'spin');

		expect(spin.startTime).toBe(wallClockAnchor(1000));
		expect(spin.startTime).toBeLessThanOrEqual(0);
		expect(spin.startTime).toBeGreaterThan(-1000);
	});

	it('gives spinners that start at different moments the same phase', async () => {
		const first = cssAnimation('spin', 1000);
		announceStart(mountRunning(first), 'spin');
		await new Promise((resolve) => setTimeout(resolve, 5));
		const second = cssAnimation('spin', 1000);
		announceStart(mountRunning(second), 'spin');

		expect(second.startTime).toBe(first.startTime);
	});

	it('anchors pulse and the Concierge orbit to their own periods', () => {
		const pulse = cssAnimation('pulse', 2000);
		const orbit = cssAnimation('concierge-spin', 5000);
		const sheen = cssAnimation('concierge-spin', 3200);
		announceStart(mountRunning(pulse), 'pulse');
		announceStart(mountRunning(orbit), 'concierge-spin');
		announceStart(mountRunning(sheen), 'concierge-spin');

		expect(pulse.startTime).toBe(wallClockAnchor(2000));
		expect(orbit.startTime).toBe(wallClockAnchor(5000));
		expect(sheen.startTime).toBe(wallClockAnchor(3200));
	});

	it('leaves keyframes outside the synced set on their own clock', () => {
		const fade = cssAnimation('fade-in', 300);
		announceStart(mountRunning(fade), 'fade-in');

		expect(fade.startTime).toBeNull();
	});

	it('touches only the animation the event announced on its element', () => {
		const spin = cssAnimation('spin', 1000);
		const pulse = cssAnimation('pulse', 2000);
		const transition = cssTransition(150);
		announceStart(mountRunning(spin, pulse, transition), 'spin');

		expect(spin.startTime).toBe(wallClockAnchor(1000));
		expect(pulse.startTime).toBeNull();
		expect(transition.startTime).toBeNull();
	});

	it('skips an animation without a finite positive period', () => {
		const instant = cssAnimation('spin', 0);
		const auto = cssAnimation('spin', 'auto');
		announceStart(mountRunning(instant, auto), 'spin');

		expect(instant.startTime).toBeNull();
		expect(auto.startTime).toBeNull();
	});

	it('stops aligning once disposed', () => {
		stopSync();
		const spin = cssAnimation('spin', 1000);
		announceStart(mountRunning(spin), 'spin');

		expect(spin.startTime).toBeNull();
	});
});
