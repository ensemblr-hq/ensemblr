import { useState } from 'react';

/**
 * Runs a Linear refresh and reports whether it is still in flight. A refresh
 * asks the main process to bypass its own freshness window, so it goes around
 * the query function rather than through it and the query's `isFetching` never
 * moves — a button showing progress has to track it here. The refresh helpers
 * write their answer into the query cache themselves and never reject, so there
 * is nothing to catch and nothing to return.
 * @param refresh - Performs the refresh.
 * @returns Whether a refresh is running, and the handler that starts one.
 */
export function useLinearRefresh(refresh: () => Promise<unknown>): {
	active: boolean;
	start: () => void;
} {
	const [running, setRunning] = useState(false);

	return {
		active: running,
		start: () => {
			setRunning(true);
			void refresh().finally(() => setRunning(false));
		},
	};
}
