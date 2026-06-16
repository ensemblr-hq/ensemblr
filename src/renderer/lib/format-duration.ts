/**
 * Formats an elapsed turn duration as a comma-separated unit chain with one
 * decimal of seconds, e.g. `31.8s`, `11m, 31.8s`, `1h, 5m, 3.2s`. Used for both
 * live (ticking) and settled turn timers so the value reads identically across
 * the streaming → finalized handoff.
 *
 * Rules:
 * - Seconds always carry one decimal (`5.0s`), so a 100ms tick visibly counts up
 *   even on long sessions instead of freezing at whole minutes.
 * - Units render from the largest non-zero unit down to seconds; only the leading
 *   zero units are dropped (no `0h`, no leading `0m`). Past an hour, minutes show
 *   even when zero (`1h, 0m, 0.0s`).
 *
 * Computed in integer tenths-of-a-second so a value like 59.95s rounds once to
 * `1m, 0.0s` rather than rolling over to a nonsensical `60.0s`.
 */
export function formatTurnDuration(ms: number): string {
	const totalDs = Math.round(Math.max(0, ms) / 100); // tenths of a second
	const ds = totalDs % 10;
	const s = Math.floor(totalDs / 10) % 60;
	const m = Math.floor(totalDs / 600) % 60;
	const h = Math.floor(totalDs / 36000);

	const segments: string[] = [];
	if (h > 0) {
		segments.push(`${h}h`);
	}
	if (h > 0 || m > 0) {
		segments.push(`${m}m`);
	}
	segments.push(`${s}.${ds}s`);
	return segments.join(', ');
}
