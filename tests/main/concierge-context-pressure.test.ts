import { describe, expect, test } from 'vitest';

import { conciergeContextPressure } from '../../src/main/concierge/concierge-session-service.ts';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config.ts';

/** The shipped default, so the cases below describe real behaviour. */
const DEFAULT_FRACTION = DEFAULT_APP_SETTINGS.concierge.autoClearAtPercent;

describe('the Concierge context-pressure threshold', () => {
	test('reports nothing before the runtime has measured any usage', () => {
		expect(
			conciergeContextPressure({
				autoClearAtFraction: DEFAULT_FRACTION,
				percent: null,
			}),
		).toMatchObject({ overThreshold: false, percent: null });
	});

	// The setting is a 0-1 fraction and every runtime reports
	// `(tokens / window) * 100`. Compared raw, a fresh session two percent into
	// its window cleared 0.8 and the panel offered to wipe a conversation that
	// had barely started.
	test.each([0, 0.5, 2, 25, 79.9])(
		'stays quiet at %s%% used, well under the default threshold',
		(percent) => {
			expect(
				conciergeContextPressure({
					autoClearAtFraction: DEFAULT_FRACTION,
					percent,
				}).overThreshold,
			).toBe(false);
		},
	);

	test.each([80, 80.1, 95, 100])('fires at %s%% used', (percent) => {
		expect(
			conciergeContextPressure({
				autoClearAtFraction: DEFAULT_FRACTION,
				percent,
			}).overThreshold,
		).toBe(true);
	});

	test('reports the threshold on the same 0-100 scale as the usage', () => {
		expect(
			conciergeContextPressure({ autoClearAtFraction: 0.8, percent: 10 }),
		).toMatchObject({ percent: 10, thresholdPercent: 80 });
	});

	test('a zero threshold disables the offer rather than firing at once', () => {
		expect(
			conciergeContextPressure({ autoClearAtFraction: 0, percent: 100 })
				.overThreshold,
		).toBe(false);
	});
});
