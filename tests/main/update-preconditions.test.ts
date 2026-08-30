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
	test('a packaged release build in /Applications may install', () => {
		expect(checkUpdatePreconditions(inputs())).toEqual({
			capability: 'install',
			failure: null,
		});
	});

	test('a packaged canary build in /Applications may install', () => {
		expect(checkUpdatePreconditions(inputs({ channel: 'canary' }))).toEqual({
			capability: 'install',
			failure: null,
		});
	});

	test('a packaged Linux build may check but not install', () => {
		expect(checkUpdatePreconditions(inputs({ platform: 'linux' }))).toEqual({
			capability: 'check-only',
			failure: null,
		});
	});

	test('a Linux build is not held to the /Applications rule', () => {
		expect(
			checkUpdatePreconditions(
				inputs({ inApplicationsFolder: false, platform: 'linux' }),
			),
		).toEqual({ capability: 'check-only', failure: null });
	});

	test('the dev channel refuses — it publishes no releases to read', () => {
		expect(checkUpdatePreconditions(inputs({ channel: 'dev' }))).toMatchObject({
			capability: 'none',
			failure: { code: 'update-unsupported-build' },
		});
	});

	test('an unpackaged build refuses', () => {
		expect(checkUpdatePreconditions(inputs({ packaged: false }))).toMatchObject(
			{
				capability: 'none',
				failure: { code: 'update-unsupported-build' },
			},
		);
	});

	test('an unpackaged Linux build refuses rather than checking', () => {
		expect(
			checkUpdatePreconditions(inputs({ packaged: false, platform: 'linux' })),
		).toMatchObject({
			capability: 'none',
			failure: { code: 'update-unsupported-build' },
		});
	});

	test('a platform with neither updater refuses', () => {
		expect(
			checkUpdatePreconditions(inputs({ platform: 'win32' })),
		).toMatchObject({
			capability: 'none',
			failure: { code: 'update-unsupported-build' },
		});
	});

	test('a build outside /Applications names the fix rather than failing later', () => {
		expect(
			checkUpdatePreconditions(inputs({ inApplicationsFolder: false })),
		).toMatchObject({
			capability: 'none',
			failure: { code: 'update-not-in-applications' },
		});
	});

	test('being unpackaged outranks being outside /Applications', () => {
		const result = checkUpdatePreconditions(
			inputs({ inApplicationsFolder: false, packaged: false }),
		);

		expect(result.failure?.code).toBe('update-unsupported-build');
	});
});
