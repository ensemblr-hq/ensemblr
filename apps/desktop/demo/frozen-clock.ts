/**
 * Pins every clock the renderer reads to one instant, so two captures of the
 * same scenario are byte-identical and no shot carries a relative timestamp that
 * ages ("2 minutes ago") between the shoot and the site build.
 *
 * `Date.now` and the no-argument `Date` constructor are redirected;
 * argument-taking `Date` calls are left alone so parsing a fixture's own ISO
 * strings still works.
 *
 * `performance.now` is deliberately left running: React's scheduler slices work
 * against it, and a frozen monotonic clock stalls rendering rather than stopping
 * time.
 * @param instant - ISO instant every clock reports.
 */
export function freezeClock(instant: string): void {
	const frozenMs = Date.parse(instant);
	if (Number.isNaN(frozenMs)) {
		throw new Error(`Demo scenario carries an unparseable clock: ${instant}`);
	}

	const RealDate = Date;

	class FrozenDate extends RealDate {
		/**
		 * Answers a bare `new Date()` with the frozen instant, and forwards every
		 * other call to the real constructor.
		 * @param args - Arguments the caller passed, if any.
		 */
		constructor(...args: ConstructorParameters<typeof Date> | []) {
			if (args.length === 0) {
				super(frozenMs);
				return;
			}
			super(...(args as ConstructorParameters<typeof Date>));
		}

		/** Reports the frozen instant in place of the wall clock. */
		static now(): number {
			return frozenMs;
		}
	}

	globalThis.Date = FrozenDate as DateConstructor;
}
