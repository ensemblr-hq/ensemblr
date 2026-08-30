import { describe, expect, test } from 'vitest';

import { resolveUserDataDirectory } from '../../src/main/app/user-data-location.ts';

const LINUX_CONFIG = '/home/deck/.config/ensemblr/config.json';
const LINUX_DEV_CONFIG = '/home/deck/.config/ensemblr-dev/config.json';
const DARWIN_CONFIG = '/Users/dev/.config/ensemblr/config.json';

describe('resolveUserDataDirectory — Linux', () => {
	test('nests Electron state inside the config directory', () => {
		expect(
			resolveUserDataDirectory({
				appDataPath: '/home/deck/.config',
				configPath: LINUX_CONFIG,
				isDev: false,
				platform: 'linux',
			}),
		).toBe('/home/deck/.config/ensemblr/electron');
	});

	test('never resolves to the product-name sibling Electron would default to', () => {
		const resolved = resolveUserDataDirectory({
			appDataPath: '/home/deck/.config',
			configPath: LINUX_CONFIG,
			isDev: false,
			platform: 'linux',
		});

		// The whole point: `~/.config/Ensemblr` beside `~/.config/ensemblr` is two
		// directories one capital letter apart, and the user cannot tell which is
		// theirs.
		expect(resolved).not.toBe('/home/deck/.config/Ensemblr');
		expect(resolved?.startsWith('/home/deck/.config/ensemblr/')).toBe(true);
	});

	test('follows the dev config directory rather than needing its own marker', () => {
		expect(
			resolveUserDataDirectory({
				appDataPath: '/home/deck/.config',
				configPath: LINUX_DEV_CONFIG,
				isDev: true,
				platform: 'linux',
			}),
		).toBe('/home/deck/.config/ensemblr-dev/electron');
	});

	test('ignores appDataPath, so an XDG_CONFIG_HOME override cannot split the two', () => {
		expect(
			resolveUserDataDirectory({
				appDataPath: '/somewhere/else',
				configPath: LINUX_CONFIG,
				isDev: false,
				platform: 'linux',
			}),
		).toBe('/home/deck/.config/ensemblr/electron');
	});
});

describe('resolveUserDataDirectory — macOS', () => {
	test('pins every packaged channel to the release product directory', () => {
		expect(
			resolveUserDataDirectory({
				appDataPath: '/Users/dev/Library/Application Support',
				configPath: DARWIN_CONFIG,
				isDev: false,
				platform: 'darwin',
			}),
		).toBe('/Users/dev/Library/Application Support/Ensemblr');
	});

	test('leaves the unpackaged dev build on Electron’s own default', () => {
		// Dev sets `Ensemblr (DEV)` as the product name, which is what isolates it;
		// overriding here would collapse it back onto the installed app's state.
		expect(
			resolveUserDataDirectory({
				appDataPath: '/Users/dev/Library/Application Support',
				configPath: DARWIN_CONFIG,
				isDev: true,
				platform: 'darwin',
			}),
		).toBeNull();
	});
});

describe('resolveUserDataDirectory — other platforms', () => {
	test('win32 takes the packaged pin and the dev default, like macOS', () => {
		expect(
			resolveUserDataDirectory({
				appDataPath: 'C:\\Users\\dev\\AppData\\Roaming',
				configPath: DARWIN_CONFIG,
				isDev: false,
				platform: 'win32',
			}),
		).toContain('Ensemblr');
		expect(
			resolveUserDataDirectory({
				appDataPath: 'C:\\Users\\dev\\AppData\\Roaming',
				configPath: DARWIN_CONFIG,
				isDev: true,
				platform: 'win32',
			}),
		).toBeNull();
	});
});
