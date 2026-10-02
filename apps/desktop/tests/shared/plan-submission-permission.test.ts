import { describe, expect, it } from 'vitest';

import {
	classifyPermissionAction,
	PERMISSION_MODES,
} from '@/shared/permissions';

// Submitting a plan writes a file into `.context/plans/`, but it is also the only
// exit from Plan Mode. It was classified as a read to keep it from being blocked,
// which meant a `read-only` workspace gained a file with nothing shown to the
// user — neither blocked nor confirmed.
describe('the plan-submission permission action', () => {
	it('is never blocked, in any mode', () => {
		for (const mode of PERMISSION_MODES) {
			expect(
				classifyPermissionAction({ action: 'plan-submission', mode }).boundary,
				mode,
			).not.toBe('blocked');
		}
	});

	it('asks the user under read-only', () => {
		expect(
			classifyPermissionAction({
				action: 'plan-submission',
				mode: 'read-only',
			}).boundary,
		).toBe('confirmation-required');
	});

	it.each(['workspace-trusted', 'approval-required'] as const)(
		'runs untouched under %s',
		(mode) => {
			expect(
				classifyPermissionAction({ action: 'plan-submission', mode }).boundary,
			).toBe('allowed');
		},
	);

	// The read classification it used to share is still the right answer for an
	// actual read, and the write classification still blocks under read-only.
	it('leaves the neighbouring classifications alone', () => {
		expect(
			classifyPermissionAction({
				action: 'app-control-read',
				mode: 'read-only',
			}).boundary,
		).toBe('allowed');
		expect(
			classifyPermissionAction({
				action: 'app-control-write',
				mode: 'read-only',
			}).boundary,
		).toBe('blocked');
	});
});
