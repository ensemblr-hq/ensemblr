import { describe, expect, test } from 'vitest';

import { DEFAULT_IDLE_SWEEP_INTERVAL_MS } from '../../src/main/github/workspace-pr-sweeper.ts';
import { CHECK_REGISTRATION_GRACE_MS } from '../../src/shared/github-pr-presentation.ts';

describe('check-registration grace against the sweep cadence', () => {
	test('the grace outlives one idle sweep interval', () => {
		expect(CHECK_REGISTRATION_GRACE_MS).toBeGreaterThan(
			DEFAULT_IDLE_SWEEP_INTERVAL_MS,
		);
	});
});
