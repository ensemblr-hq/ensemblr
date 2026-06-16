/**
 * Relative-time helpers for the History screen. No date library exists in the
 * app, so these are hand-rolled with the same `Date.parse` + `Number.isNaN`
 * guard style as `formatRelativeClosedAt` (src/renderer/state/workspace/
 * session-tabs.ts). Bucketing uses calendar-day boundaries (not raw elapsed
 * milliseconds) so "Yesterday" stays correct near midnight.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
}

/**
 * Returns the relative-time bucket label for an ISO timestamp: `Today`,
 * `Yesterday`, `N days ago` (2–6), `1 week ago`, `N weeks ago` (2–3), or a
 * `Month YYYY` label for anything older. Returns `Unknown` when unparseable so
 * malformed rows still group somewhere instead of throwing.
 */
export function bucketForDate(iso: string): string {
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) {
		return 'Unknown';
	}

	const date = new Date(parsed);
	const dayDiff = Math.round(
		(startOfDay(new Date()) - startOfDay(date)) / DAY_MS,
	);

	if (dayDiff <= 0) {
		return 'Today';
	}
	if (dayDiff === 1) {
		return 'Yesterday';
	}
	if (dayDiff < 7) {
		return `${dayDiff} days ago`;
	}
	if (dayDiff < 14) {
		return '1 week ago';
	}
	if (dayDiff < 28) {
		return `${Math.floor(dayDiff / 7)} weeks ago`;
	}
	return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Compact per-row date shown on the right of a History row (e.g. `Jun 16`).
 * Adds the year only when the timestamp is not from the current calendar year.
 * Returns the raw input when it cannot be parsed.
 */
export function formatRowDate(iso: string): string {
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) {
		return iso;
	}

	const date = new Date(parsed);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		...(sameYear ? {} : { year: 'numeric' }),
	});
}
