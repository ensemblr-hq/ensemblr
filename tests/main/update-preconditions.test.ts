import { describe, expect, test } from 'vitest';

import type { UpdatePreconditionInputs } from '../../src/main/updates/update-preconditions';
import { checkUpdatePreconditions } from '../../src/main/updates/update-preconditions';

/** A build that can update, overridden per test to the one condition under exam. */
function inputs(
	overrides: Partial<UpdatePreconditionInputs> = {},
): UpdatePreconditionInputs {
	return {
		channel: 'release',
		inApplicationsFolder: true,
		packaged: true,
		platform: 'darwin',
		...overrides,
	};
}

describe('checkUpdatePreconditions', () => {
	test('a packaged release build in /Applications may update', () => {
		expect(checkUpdatePreconditions(inputs())).toBeNull();
	});

	test('a packaged canary build in /Applications may update', () => {
		expect(checkUpdatePreconditions(inputs({ channel: 'canary' }))).toBeNull();
	});

	test('the dev channel refuses — it publishes no releases to read', () => {
		expect(checkUpdatePreconditions(inputs({ channel: 'dev' }))).toMatchObject({
			code: 'update-unsupported-build',
		});
	});

	test('an unpackaged build refuses', () => {
		expect(checkUpdatePreconditions(inputs({ packaged: false }))).toMatchObject(
			{
				code: 'update-unsupported-build',
			},
		);
	});

	test('a non-darwin build refuses before Squirrel.Mac is reached', () => {
		expect(
			checkUpdatePreconditions(inputs({ platform: 'win32' })),
		).toMatchObject({ code: 'update-unsupported-build' });
	});

	test('a build outside /Applications names the fix rather than failing later', () => {
		expect(
			checkUpdatePreconditions(inputs({ inApplicationsFolder: false })),
		).toMatchObject({ code: 'update-not-in-applications' });
	});

	test('being unpackaged outranks being outside /Applications', () => {
		const failure = checkUpdatePreconditions(
			inputs({ inApplicationsFolder: false, packaged: false }),
		);

		expect(failure?.code).toBe('update-unsupported-build');
	});
});
