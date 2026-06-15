import { animate, type MotionValue, useMotionValue } from 'motion/react';
import { useEffect } from 'react';

const inactiveShadow = '0px 0px 0px rgba(0,0,0,0.8)';

/**
 * Returns a motion-driven `boxShadow` value that lifts a draggable item while
 * `value` is non-zero (i.e. while the item is being dragged).
 * @param value - Motion value driving the drag state.
 * @returns A {@link MotionValue} producing the active/inactive `boxShadow`.
 */
export function useRaisedShadow(value: MotionValue<number>) {
	const boxShadow = useMotionValue(inactiveShadow);

	useEffect(() => {
		let isActive = false;
		const unsubscribe = value.on('change', (latest) => {
			const wasActive = isActive;
			if (latest !== 0) {
				isActive = true;
				if (isActive !== wasActive) {
					animate(boxShadow, '5px 5px 10px rgba(0,0,0,0.3)');
				}
			} else {
				isActive = false;
				if (isActive !== wasActive) {
					animate(boxShadow, inactiveShadow);
				}
			}
		});
		return () => {
			unsubscribe();
		};
	}, [value, boxShadow]);

	return boxShadow;
}
