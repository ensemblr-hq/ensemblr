import { describe, expect, test } from 'vitest';

import { stripLaunchContextEnv } from '../../src/main/environment/launch-env';

describe('stripLaunchContextEnv', () => {
	test('removes the macOS bundle-identifier launch marker', () => {
		const result = stripLaunchContextEnv({
			__CFBundleIdentifier: 'com.ensemble.app',
			PATH: '/usr/bin',
		});

		expect(result).not.toHaveProperty('__CFBundleIdentifier');
		expect(result.PATH).toBe('/usr/bin');
	});

	test('removes the launchd application-instance identity markers', () => {
		const result = stripLaunchContextEnv({
			LaunchInstanceID: 'A1B2C3D4-0000-4000-8000-000000000000',
			XPC_FLAGS: '1',
			XPC_SERVICE_NAME: 'application.com.ensemble.app.21354441.21356688',
			PATH: '/usr/bin',
		});

		expect(result).not.toHaveProperty('XPC_SERVICE_NAME');
		expect(result).not.toHaveProperty('XPC_FLAGS');
		expect(result).not.toHaveProperty('LaunchInstanceID');
		expect(result.PATH).toBe('/usr/bin');
	});

	test('removes the Electron runtime markers', () => {
		const result = stripLaunchContextEnv({
			ELECTRON_RUN_AS_NODE: '1',
			ELECTRON_NO_ATTACH_CONSOLE: '1',
			ELECTRON_NO_ASAR: '1',
			HOME: '/Users/dev',
		});

		expect(result).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
		expect(result).not.toHaveProperty('ELECTRON_NO_ATTACH_CONSOLE');
		expect(result).not.toHaveProperty('ELECTRON_NO_ASAR');
		expect(result.HOME).toBe('/Users/dev');
	});

	test('preserves user variables and is a no-op when no markers are present', () => {
		const source = { PATH: '/usr/bin', SHELL: '/bin/zsh', FOO: 'bar' };

		expect(stripLaunchContextEnv(source)).toEqual(source);
	});

	test('does not mutate the input environment', () => {
		const source = {
			__CFBundleIdentifier: 'com.ensemble.app',
			PATH: '/usr/bin',
		};

		stripLaunchContextEnv(source);

		expect(source.__CFBundleIdentifier).toBe('com.ensemble.app');
	});
});
