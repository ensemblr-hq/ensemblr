import { useCallback, useMemo, useState } from 'react';

/** Tracks work in flight, keyed by the chat tab or agent session it belongs to. */
export interface InFlightTurns {
	isBusy: (key: string | null) => boolean;
	track: <T>(key: string, work: () => Promise<T>) => Promise<T>;
}

/**
 * Tracks which chat tabs and agent sessions currently have work in flight.
 *
 * One composer controller serves whichever tab is active, so a mutation's own
 * `isPending` describes the tab that fired it rather than the tab now rendering,
 * and a shared observer only remembers its most recent call. Keying the in-flight
 * set by tab id and session id instead lets any number of tabs run turns at once
 * without one reporting another's work as its own.
 * @returns A busy predicate and a wrapper that marks work for the duration of a promise
 */
export function useInFlightTurns(): InFlightTurns {
	const [countsByKey, setCountsByKey] = useState<
		Readonly<Record<string, number>>
	>({});

	const track = useCallback(
		async <T>(key: string, work: () => Promise<T>): Promise<T> => {
			setCountsByKey((previous) => ({
				...previous,
				[key]: (previous[key] ?? 0) + 1,
			}));
			try {
				return await work();
			} finally {
				setCountsByKey((previous) => {
					const remaining = (previous[key] ?? 0) - 1;
					if (remaining > 0) {
						return { ...previous, [key]: remaining };
					}
					const { [key]: _settled, ...rest } = previous;
					return rest;
				});
			}
		},
		[],
	);

	const isBusy = useCallback(
		(key: string | null) => key !== null && (countsByKey[key] ?? 0) > 0,
		[countsByKey],
	);

	return useMemo(() => ({ isBusy, track }), [isBusy, track]);
}
