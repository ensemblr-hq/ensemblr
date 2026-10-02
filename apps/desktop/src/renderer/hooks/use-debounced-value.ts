import { useEffect, useState } from 'react';

/**
 * Trails a rapidly changing value by a fixed delay, so a search box can stay
 * fully responsive while the query behind it fires once the typing settles.
 * @param value - The value to trail.
 * @param delayMs - How long the value must hold still before it is published.
 * @returns The most recent value that held still for `delayMs`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [settled, setSettled] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), delayMs);

		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return settled;
}
