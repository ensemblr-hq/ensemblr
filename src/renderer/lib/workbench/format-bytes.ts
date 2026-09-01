/**
 * Decimal, not binary: `Intl` knows `kilobyte` but has no unit for `kibibyte`,
 * so a 1024 step would print SI prefixes over binary maths. This also matches
 * what Finder reports for the same folder, which is where a user goes to check.
 */
const UNIT_STEP = 1000;

/** Largest-first is not an option — the step above walks these in order. */
const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * Renders a byte count as a short size in the user's own language.
 *
 * Sizes here describe reclaimed disk, which runs from hundreds of megabytes to
 * gigabytes, so one decimal place is the useful precision: "1.8 GB" reads,
 * "1932735283 bytes" does not. `Intl` rather than a hand-rolled suffix because
 * the result is interpolated into translated copy, and both the unit and the
 * decimal separator differ per locale — Russian wants `1,8 ГБ`, not `1.8 GB`.
 * @param bytes - Size in bytes.
 * @param language - Active i18next language tag.
 * @returns The formatted size, or null when there is no number to show.
 */
export function formatBytes(
	bytes: number | null,
	language: string,
): string | null {
	if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
		return null;
	}

	let value = bytes;
	let unitIndex = 0;
	while (value >= UNIT_STEP && unitIndex < UNITS.length - 1) {
		value /= UNIT_STEP;
		unitIndex += 1;
	}

	const unit = UNITS[unitIndex] ?? 'byte';
	try {
		return new Intl.NumberFormat(language, {
			maximumFractionDigits: unitIndex === 0 ? 0 : 1,
			style: 'unit',
			unit,
			unitDisplay: 'short',
		}).format(value);
	} catch {
		// A language tag Intl rejects must not cost the user the number itself.
		return `${Math.round(value)} ${unit}`;
	}
}
