import { describe, expect, test } from 'vitest';

import type { UpdatePreconditionInputs } from '../../src/main/updates/update-preconditions';
import { checkUpdatePreconditions } from '../../src/main/updates/update-preconditions';

/** A build that can update, overridden per test to the one condition under exam. */
function inputs(
	overrides: Partial<UpdatePreconditionInputs> = {},
): UpdatePreconditionInputs {
	return {
		appImageDirectoryWritable: false,
		appImagePath: null,
		arch: 'arm64',
		channel: 'release',
		homebrewCask: null,
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

	test('a Linux build running from a writable AppImage may install', () => {
		expect(
			checkUpdatePreconditions(
				inputs({
					appImageDirectoryWritable: true,
					appImagePath: '/home/dev/.local/share/ensemblr/Ensemblr.AppImage',
					platform: 'linux',
				}),
			),
		).toEqual({ capability: 'install', failure: null });
	});

	test('a Linux build not running as an AppImage may check but not install', () => {
		expect(checkUpdatePreconditions(inputs({ platform: 'linux' }))).toEqual({
			capability: 'check-only',
			failure: null,
		});
	});

	test('a Linux build whose AppImage directory is read-only may only check', () => {
		expect(
			checkUpdatePreconditions(
				inputs({
					appImageDirectoryWritable: false,
					appImagePath: '/opt/ensemblr/Ensemblr.AppImage',
					platform: 'linux',
				}),
			),
		).toEqual({ capability: 'check-only', failure: null });
	});

	test('a Linux build is not held to the /Applications rule', () => {
		expect(
			checkUpdatePreconditions(
				inputs({
					appImageDirectoryWritable: true,
					appImagePath: '/home/dev/.local/share/ensemblr/Ensemblr.AppImage',
					inApplicationsFolder: false,
					platform: 'linux',
				}),
			),
		).toEqual({ capability: 'install', failure: null });
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

	test('an x64 Mac may install', () => {
		expect(checkUpdatePreconditions(inputs({ arch: 'x64' }))).toEqual({
			capability: 'install',
			failure: null,
		});
	});

	test('an x64 Linux build may install', () => {
		expect(
			checkUpdatePreconditions(
				inputs({
					appImageDirectoryWritable: true,
					appImagePath: '/home/dev/.local/share/ensemblr/Ensemblr.AppImage',
					arch: 'x64',
					platform: 'linux',
				}),
			),
		).toEqual({ capability: 'install', failure: null });
	});

	test('an architecture Ensemblr ships no build for refuses', () => {
		expect(checkUpdatePreconditions(inputs({ arch: 'ia32' }))).toMatchObject({
			capability: 'none',
			failure: { code: 'update-unsupported-build' },
		});
	});

	test('an unsupported architecture refuses on Linux too', () => {
		expect(
			checkUpdatePreconditions(
				inputs({
					appImageDirectoryWritable: true,
					appImagePath: '/home/dev/.local/share/ensemblr/Ensemblr.AppImage',
					arch: 'armv7l',
					platform: 'linux',
				}),
			),
		).toMatchObject({
			capability: 'none',
			failure: { code: 'update-unsupported-build' },
		});
	});

	test('an unsupported platform outranks an unsupported architecture', () => {
		expect(
			checkUpdatePreconditions(inputs({ arch: 'ia32', platform: 'win32' })),
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

	test('a copy Homebrew installed leaves every update to Homebrew', () => {
		expect(
			checkUpdatePreconditions(inputs({ homebrewCask: 'ensemblr' })),
		).toMatchObject({
			capability: 'none',
			failure: {
				code: 'update-managed-by-homebrew',
				message: expect.stringContaining('brew upgrade --cask ensemblr'),
			},
		});
	});

	test('Homebrew ownership outranks being outside /Applications', () => {
		const result = checkUpdatePreconditions(
			inputs({ homebrewCask: 'ensemblr', inApplicationsFolder: false }),
		);

		expect(result.failure?.code).toBe('update-managed-by-homebrew');
	});

	test('a Linux build ignores Homebrew, which has no casks there', () => {
		expect(
			checkUpdatePreconditions(
				inputs({ homebrewCask: 'ensemblr', platform: 'linux' }),
			),
		).toEqual({ capability: 'check-only', failure: null });
	});

	test('being unpackaged outranks being outside /Applications', () => {
		const result = checkUpdatePreconditions(
			inputs({ inApplicationsFolder: false, packaged: false }),
		);

		expect(result.failure?.code).toBe('update-unsupported-build');
	});
});
