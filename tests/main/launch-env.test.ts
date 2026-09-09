import { describe, expect, test } from 'vitest';

import { stripLaunchContextEnv } from '../../src/main/environment/launch-env';

describe('stripLaunchContextEnv', () => {
	test('removes the macOS bundle-identifier launch marker', () => {
		const result = stripLaunchContextEnv({
			__CFBundleIdentifier: 'dev.ensemblr.app',
			PATH: '/usr/bin',
		});

		expect(result).not.toHaveProperty('__CFBundleIdentifier');
		expect(result.PATH).toBe('/usr/bin');
	});

	test('removes the launchd application-instance identity markers', () => {
		const result = stripLaunchContextEnv({
			LaunchInstanceID: 'A1B2C3D4-0000-4000-8000-000000000000',
			XPC_FLAGS: '1',
			XPC_SERVICE_NAME: 'application.dev.ensemblr.app.21354441.21356688',
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

	test('drops repository-local Git context without stripping identity or authentication', () => {
		const preserved = {
			PATH: '/usr/bin',
			GIT_AUTHOR_NAME: 'Developer',
			GIT_COMMITTER_EMAIL: 'dev@example.test',
			GIT_EDITOR: 'vim',
			GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work',
			GIT_ASKPASS: '/usr/bin/askpass',
			GIT_TERMINAL_PROMPT: '0',
			GIT_CONFIG_GLOBAL: '/home/dev/.gitconfig',
		};
		const source = Object.freeze({
			...preserved,
			GIT_DIR: '/sibling/.git',
			GIT_COMMON_DIR: '/sibling/.git',
			GIT_WORK_TREE: '/sibling',
			GIT_INDEX_FILE: '/sibling/.git/index',
			GIT_OBJECT_DIRECTORY: '/sibling/.git/objects',
			GIT_ALTERNATE_OBJECT_DIRECTORIES: '/sibling/.git/objects',
			GIT_CONFIG: '/sibling/.git/config',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.worktree',
			GIT_CONFIG_VALUE_0: '/sibling',
			GIT_CONFIG_KEY_99: 'stale key',
			GIT_CONFIG_VALUE_99: 'stale value',
			GIT_CONFIG_PARAMETERS: "'core.worktree'='/sibling'",
			GIT_IMPLICIT_WORK_TREE: '0',
			GIT_CEILING_DIRECTORIES: '/workspaces',
			GIT_DISCOVERY_ACROSS_FILESYSTEM: '1',
			GIT_GRAFT_FILE: '/sibling/.git/info/grafts',
			GIT_PREFIX: 'sibling/',
			GIT_SHALLOW_FILE: '/sibling/.git/shallow',
			GIT_NAMESPACE: 'sibling',
			GIT_REPLACE_REF_BASE: 'refs/sibling',
			GIT_NO_REPLACE_OBJECTS: '1',
		});

		expect(stripLaunchContextEnv(source)).toEqual(preserved);
		expect(source.GIT_INDEX_FILE).toBe('/sibling/.git/index');
	});

	test('preserves user variables and is a no-op when no markers are present', () => {
		const source = { PATH: '/usr/bin', SHELL: '/bin/zsh', FOO: 'bar' };

		expect(stripLaunchContextEnv(source)).toEqual(source);
	});

	test('does not mutate the input environment', () => {
		const source = {
			__CFBundleIdentifier: 'dev.ensemblr.app',
			PATH: '/usr/bin',
		};

		stripLaunchContextEnv(source);

		expect(source.__CFBundleIdentifier).toBe('dev.ensemblr.app');
	});
});
