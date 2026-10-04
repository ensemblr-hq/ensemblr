/**
 * Keyframes whose running instances share one phase across the window: the
 * Tailwind `spin` and `pulse` loops, and the Concierge mark's `concierge-spin`.
 */
const SYNCED_KEYFRAMES: ReadonlySet<string> = new Set([
	'spin',
	'pulse',
	'concierge-spin',
]);

/**
 * Reports whether an animation is the CSS animation running a given keyframe.
 * @param animation - One of the event target's animations
 * @param keyframes - Keyframe name the `animationstart` event carried
 * @returns True when the animation is a CSS animation running those keyframes
 */
function isCssAnimationOf(
	animation: Animation,
	keyframes: string,
): animation is CSSAnimation {
	return 'animationName' in animation && animation.animationName === keyframes;
}

/**
 * Moves an animation's start onto the wall-clock grid of its own period, so
 * every instance of a loop shows the same frame at the same moment however late
 * it mounted.
 * @param animation - A looping CSS animation that has just started
 */
function alignToWallClock(animation: Animation): void {
	const period = animation.effect?.getComputedTiming().duration;
	if (typeof period !== 'number' || period <= 0) {
		return;
	}
	animation.startTime = -(performance.timeOrigin % period);
}

/**
 * Snaps the animation an `animationstart` event announces onto the shared phase
 * when its keyframes are one of the synced loops.
 * @param event - The `animationstart` event, from any element in the document
 */
function alignStartedAnimation(event: AnimationEvent): void {
	const { animationName, target } = event;
	if (!SYNCED_KEYFRAMES.has(animationName) || !(target instanceof Element)) {
		return;
	}
	for (const animation of target.getAnimations()) {
		if (isCssAnimationOf(animation, animationName)) {
			alignToWallClock(animation);
		}
	}
}

/**
 * Keeps every spinner, pulse, and Concierge orbit in the window moving in
 * lockstep.
 *
 * A CSS animation starts its own clock when its element mounts, so two spinners
 * that appeared a moment apart turn out of step for as long as both are on
 * screen. One capturing `animationstart` listener sees each synced loop as it
 * starts — a class toggled on later, or an element shown from `display: none`,
 * included — and pins its `startTime` so its phase is the wall clock modulo its
 * own period. Loops that share a period line up; loops with different periods,
 * like the Concierge ring and sheen, still drift against each other as
 * designed. The event arrives the frame after the animation starts, so a fresh
 * loop can paint one frame at its own phase before it snaps; catching it
 * earlier would mean watching every DOM mutation and forcing a style recalc on
 * each.
 * @returns A disposer that removes the listener
 */
export function syncLoopingAnimationPhases(): () => void {
	document.addEventListener('animationstart', alignStartedAnimation, true);
	return () => {
		document.removeEventListener('animationstart', alignStartedAnimation, true);
	};
}
