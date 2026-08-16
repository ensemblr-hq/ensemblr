import { useEffect, useState } from 'react';

/** How long one full turn of the refresh icon takes. */
const SPIN_TURN_MS = 1000;

/**
 * Keeps a refresh icon spinning for at least one full turn. A cache-first
 * refetch resolves before a browser paints, so keying the spin purely off the
 * query's in-flight flag leaves a click with no visible response at all.
 * @param refreshing - Whether the underlying query is still in flight
 * @returns Whether the icon should spin, and the handler that starts a turn
 */
export function useRefreshSpin(refreshing: boolean): {
	active: boolean;
	start: () => void;
} {
	const [spinning, setSpinning] = useState(false);

	useEffect(() => {
		if (!spinning) {
			return;
		}

		const timer = window.setTimeout(() => setSpinning(false), SPIN_TURN_MS);

		return () => window.clearTimeout(timer);
	}, [spinning]);

	return { active: spinning || refreshing, start: () => setSpinning(true) };
}
