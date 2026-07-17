import assert from 'node:assert/strict';
import test from 'node:test';

import type { CommandEnvironmentSnapshot } from '../../src/main/commands/command-types.ts';
import { createToolchainPathResolver } from '../../src/main/environment/toolchain-path.ts';

function createSnapshot(
	overrides: Partial<CommandEnvironmentSnapshot>,
): CommandEnvironmentSnapshot {
	return {
		diagnostics: [],
		env: {},
		path: '',
		resolvedAt: '2026-07-17T00:00:00.000Z',
		shell: '/bin/sh',
		source: 'shell',
		...overrides,
	};
}

test('returns the shell PATH for a directory when resolution succeeds', async () => {
	const requestedCwds: Array<string | undefined> = [];
	const resolve = createToolchainPathResolver({
		getEnvironment: async (cwd) => {
			requestedCwds.push(cwd);
			return createSnapshot({ path: `${cwd}/bin:/bin`, source: 'shell' });
		},
	});

	const resolved = await resolve('/workspace/a');

	assert.equal(resolved, '/workspace/a/bin:/bin');
	assert.deepEqual(requestedCwds, ['/workspace/a']);
});

test('returns null when the shell environment falls back', async () => {
	const resolve = createToolchainPathResolver({
		getEnvironment: async () =>
			createSnapshot({ path: '/electron/bin', source: 'fallback' }),
	});

	const resolved = await resolve('/workspace/a');

	assert.equal(resolved, null);
});
