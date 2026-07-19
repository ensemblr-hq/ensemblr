import { useEffect, useState } from 'react';

/**
 * Live-ticking elapsed milliseconds since `startMs`, re-rendering on an interval
 * so an in-flight duration label stays current. Clamped at zero so a clock skew
 * or future `startMs` never shows a negative span.
 * @param startMs - Epoch milliseconds the elapsed span is measured from.
 * @param intervalMs - Tick cadence in milliseconds; defaults to 100.
 * @returns Elapsed milliseconds since `startMs`, never below zero.
 */
export function useElapsedMs(startMs: number, intervalMs = 100): number {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return Math.max(0, nowMs - startMs);
}
