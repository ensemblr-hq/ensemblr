import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createLocalCommandService,
	type LocalCommandService,
	type ShellEnvironmentLoader,
} from '../../src/main/commands/local-command.ts';

const TEST_SHELL = '/bin/sh';
const TEST_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const SHELL_ENVIRONMENT_BEGIN_SENTINEL = '__ENSEMBLR_SHELL_ENV_BEGIN__';
const SHELL_ENVIRONMENT_END_SENTINEL = '__ENSEMBLR_SHELL_ENV_END__';

function createDirectoryFixture(t: TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-command-'));

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function createShellLoader(
	env: Record<string, string>,
): ShellEnvironmentLoader {
	return async () => ({
		exitCode: 0,
		signal: null,
		stderr: '',
		stdout: createShellEnvironmentFixtureOutput({
			PATH: TEST_PATH,
			SHELL: TEST_SHELL,
			...env,
		}),
	});
}

function createShellEnvironmentFixtureOutput(
	env: Record<string, string>,
): string {
	return [
		SHELL_ENVIRONMENT_BEGIN_SENTINEL,
		...Object.entries(env).map(([key, value]) => `${key}=${value}`),
		SHELL_ENVIRONMENT_END_SENTINEL,
	].join('\u0000');
}

function createTestService(
	env: Record<string, string> = {},
	options: {
		commonPathEntries?: readonly string[];
		shellEnvironmentLoader?: ShellEnvironmentLoader;
	} = {},
): LocalCommandService {
	return createLocalCommandService({
		baseEnv: {
			PATH: '/electron/bin',
			SHELL: TEST_SHELL,
		},
		commonPathEntries: options.commonPathEntries ?? [],
		environmentTimeoutMs: 25,
		killGraceMs: 25,
		shell: TEST_SHELL,
		shellEnvironmentLoader:
			options.shellEnvironmentLoader ?? createShellLoader(env),
	});
}

test('resolves shell environment with shell PATH precedence and common path append', async () => {
	let loadCount = 0;
	const service = createTestService(
		{},
		{
			commonPathEntries: ['/common/bin', '/bin'],
			shellEnvironmentLoader: async () => {
				loadCount += 1;

				return {
					exitCode: 0,
					signal: null,
					stderr: '',
					stdout: createShellEnvironmentFixtureOutput({
						PATH: '/shell/bin:/bin',
						SHELL: TEST_SHELL,
						USER: 'alice',
					}),
				};
			},
		},
	);

	const firstSnapshot = await service.getEnvironment();
	const secondSnapshot = await service.getEnvironment();

	assert.equal(firstSnapshot.source, 'shell');
	assert.equal(firstSnapshot.shell, TEST_SHELL);
	assert.equal(firstSnapshot.env.USER, 'alice');
	assert.equal(firstSnapshot.path, '/shell/bin:/bin:/common/bin');
	assert.equal(firstSnapshot.path.includes('/electron/bin'), false);
	assert.equal(loadCount, 1);
	assert.deepEqual(secondSnapshot.env, firstSnapshot.env);
});

test('falls back to process environment with diagnostics when shell resolution fails', async () => {
	const service = createTestService(
		{},
		{
			commonPathEntries: ['/common/bin', '/bin'],
			shellEnvironmentLoader: async () => ({
				exitCode: 2,
				signal: null,
				stderr: 'shell failed',
				stdout: '',
			}),
		},
	);

	const snapshot = await service.getEnvironment();

	assert.equal(snapshot.source, 'fallback');
	assert.equal(snapshot.path, '/electron/bin:/common/bin:/bin');
	assert.deepEqual(
		snapshot.diagnostics.map((diagnostic) => diagnostic.code),
		['shell-env-exit', 'shell-env-fallback'],
	);
});

test('runs a command and captures stdout, stderr, exit code, and duration', async () => {
	const service = createTestService();
	const result = await service.run({
		args: ['-c', 'printf "hello"; printf "warning" >&2'],
		command: TEST_SHELL,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.exitCode, 0);
	assert.equal(result.signal, null);
	assert.equal(result.stdout, 'hello');
	assert.equal(result.stderr, 'warning');
	assert.equal(result.stdoutTruncated, false);
	assert.equal(result.stderrTruncated, false);
	assert.equal(typeof result.durationMs, 'number');
	assert.ok(result.durationMs >= 0);
	assert.equal(result.logs.stdout, 'hello');
	assert.equal(result.logs.stderr, 'warning');
});

test('passes cwd and environment overrides to commands', async (t) => {
	const cwd = createDirectoryFixture(t);
	const service = createTestService();
	const result = await service.run({
		args: ['-c', 'printf "%s|%s" "$PWD" "$ENSEMBLR_TEST_VALUE"'],
		command: TEST_SHELL,
		cwd,
		env: {
			ENSEMBLR_TEST_VALUE: 'from-override',
		},
	});

	assert.equal(result.status, 'success');
	assert.equal(result.cwd, cwd);
	assert.equal(result.stdout.endsWith('|from-override'), true);
});

test('returns typed failure for nonzero exit', async () => {
	const service = createTestService();
	const result = await service.run({
		args: ['-c', 'printf "bad" >&2; exit 7'],
		command: TEST_SHELL,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.failure?.code, 'nonzero-exit');
	assert.equal(result.failure?.exitCode, 7);
	assert.equal(result.exitCode, 7);
	assert.equal(result.stderr, 'bad');
});

test('returns typed failure for missing commands', async () => {
	const service = createTestService();
	const result = await service.run({
		command: 'ensemblr-definitely-missing-command',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.failure?.code, 'command-not-found');
	assert.equal(result.exitCode, null);
});

test('returns typed failure for invalid cwd', async (t) => {
	const cwd = createDirectoryFixture(t);
	const service = createTestService();
	const result = await service.run({
		command: TEST_SHELL,
		cwd: path.join(cwd, 'missing'),
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.failure?.code, 'invalid-cwd');
	assert.equal(result.environment, null);
});

test('cancels commands with AbortController', async () => {
	const service = createTestService();
	const controller = new AbortController();
	const resultPromise = service.run(
		{
			args: ['-c', 'sleep 2'],
			command: TEST_SHELL,
		},
		{ signal: controller.signal },
	);

	setTimeout(() => controller.abort(), 25);

	const result = await resultPromise;

	assert.equal(result.status, 'failure');
	assert.equal(result.failure?.code, 'canceled');
});

test('terminates commands on timeout', async () => {
	const service = createTestService();
	const result = await service.run({
		args: ['-c', 'sleep 2'],
		command: TEST_SHELL,
		timeoutMs: 25,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.failure?.code, 'timeout');
});

test('returns output truncation failure and retained output prefix', async () => {
	const service = createTestService();
	const result = await service.run({
		args: ['-c', 'printf "0123456789abcdef"'],
		command: TEST_SHELL,
		maxOutputBytes: 8,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.failure?.code, 'output-truncated');
	assert.equal(result.stdout, '01234567');
	assert.equal(result.stdoutTruncated, true);
});

test('sanitizes logs without removing raw command output for main callers', async () => {
	const service = createTestService({
		API_TOKEN: 'shell-secret-token',
	});
	const result = await service.run({
		args: [
			'-c',
			'printf "TOKEN=$API_TOKEN\\nPASSWORD=$PASSWORD\\n"; printf "SECRET=$API_TOKEN\\n" >&2',
			'--token=argument-secret',
		],
		command: TEST_SHELL,
		env: {
			PASSWORD: 'local-password-1234',
		},
		redactValues: ['argument-secret'],
	});

	assert.equal(result.status, 'success');
	assert.equal(result.stdout.includes('shell-secret-token'), true);
	assert.equal(result.stdout.includes('local-password-1234'), true);
	assert.equal(result.stderr.includes('shell-secret-token'), true);
	assert.equal(result.logs.env.API_TOKEN, '[REDACTED]');
	assert.equal(result.logs.env.PASSWORD, '[REDACTED]');
	assert.equal(result.logs.command.includes('argument-secret'), false);
	assert.equal(result.logs.stdout.includes('shell-secret-token'), false);
	assert.equal(result.logs.stdout.includes('local-password-1234'), false);
	assert.equal(result.logs.stderr.includes('shell-secret-token'), false);
	assert.equal(result.logs.stdout.includes('[REDACTED]'), true);
	assert.equal(result.logs.stderr.includes('[REDACTED]'), true);
});

test('sanitizes full sensitive values that contain spaces', async () => {
	const service = createTestService({
		PASSWORD: 'alpha beta gamma',
	});
	const result = await service.run({
		command: '/usr/bin/env',
	});
	const sanitizedPasswordLine = result.logs.stdout
		.split('\n')
		.find((line) => line.startsWith('PASSWORD='));

	assert.equal(result.status, 'success');
	assert.equal(result.stdout.includes('PASSWORD=alpha beta gamma'), true);
	assert.equal(sanitizedPasswordLine, 'PASSWORD=[REDACTED]');
});

test('git version smoke runs through local command service when enabled', {
	skip:
		process.env.ENSEMBLR_RUN_COMMAND_SMOKE === '1'
			? false
			: 'Set ENSEMBLR_RUN_COMMAND_SMOKE=1 to run the git command smoke test.',
}, async () => {
	const service = createLocalCommandService();
	const result = await service.run({
		args: ['--version'],
		command: 'git',
		timeoutMs: 5000,
	});

	assert.equal(result.status, 'success');
	assert.match(result.stdout, /^git version /);
});
