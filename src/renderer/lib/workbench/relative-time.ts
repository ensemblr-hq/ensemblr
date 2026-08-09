/**
 * Relative-time helpers for the History screen. No date library exists in the
 * app, so bucketing is hand-rolled with the same `Date.parse` + `Number.isNaN`
 * guard style as `formatRelativeClosedAt` (src/renderer/state/workspace/
 * session-tabs.ts), using calendar-day boundaries (not raw elapsed
 * milliseconds) so "Yesterday" stays correct near midnight. The wording itself
 * comes from `Intl.RelativeTimeFormat`, which knows every locale's plural split
 * (`2 дня` vs `5 дней`) that a hand-written English branch cannot express.
 */

import { i18n } from '@/renderer/lib/i18n';

const DAY_MS = 24 * 60 * 60 * 1000;

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Returns a cached `Intl.RelativeTimeFormat` for a locale. Constructing one is
 * expensive enough to matter on a list that re-renders per History row.
 * @param locale - BCP-47 tag of the active UI language
 * @returns A formatter using explicit numbers, so "1 day ago" never collapses
 * into "yesterday" and duplicate the dedicated bucket
 */
function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
	const cached = relativeFormatters.get(locale);
	if (cached) {
		return cached;
	}

	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
	relativeFormatters.set(locale, formatter);
	return formatter;
}

/**
 * Compute the epoch-millisecond start of the calendar day containing a date.
 * @param date - The date to truncate to local midnight.
 * @returns Milliseconds since the epoch at the start of that day.
 */
function startOfDay(date: Date): number {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
}

/**
 * Returns the relative-time bucket label for an ISO timestamp: `Today`,
 * `Yesterday`, `N days ago` (2–6), `N weeks ago` (1–3), or a `Month YYYY` label
 * for anything older. `Today` and `Yesterday` are catalogue entries rather than
 * `Intl`'s `numeric: 'auto'` output because as section headings they need a
 * capital the automatic wording does not give. Returns `Unknown` when
 * unparseable so malformed rows still group somewhere instead of throwing.
 * @param iso - ISO timestamp of the row
 * @returns The heading the row groups under
 */
export function bucketForDate(iso: string): string {
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) {
		return i18n.t('workbench:history.bucket.unknown', 'Unknown');
	}

	const date = new Date(parsed);
	const dayDiff = Math.round(
		(startOfDay(new Date()) - startOfDay(date)) / DAY_MS,
	);

	if (dayDiff <= 0) {
		return i18n.t('workbench:history.bucket.today', 'Today');
	}
	if (dayDiff === 1) {
		return i18n.t('workbench:history.bucket.yesterday', 'Yesterday');
	}

	const formatter = relativeFormatter(i18n.language);
	if (dayDiff < 7) {
		return formatter.format(-dayDiff, 'day');
	}
	if (dayDiff < 28) {
		return formatter.format(-Math.floor(dayDiff / 7), 'week');
	}

	return date.toLocaleDateString(i18n.language, {
		month: 'long',
		year: 'numeric',
	});
}

/**
 * Compact per-row date shown on the right of a History row (e.g. `Jun 16`).
 * Adds the year only when the timestamp is not from the current calendar year.
 * Returns the raw input when it cannot be parsed.
 * @param iso - ISO timestamp of the row
 * @returns The formatted date in the active UI language
 */
export function formatRowDate(iso: string): string {
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) {
		return iso;
	}

	const date = new Date(parsed);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString(i18n.language, {
		day: 'numeric',
		month: 'short',
		...(sameYear ? {} : { year: 'numeric' }),
	});
}
