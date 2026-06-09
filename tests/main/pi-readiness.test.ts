import assert from 'node:assert/strict';
import {
	accessSync,
	chmodSync,
	constants,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import type {
	CommandEnvironmentSnapshot,
	LocalCommandFailureCode,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import {
	parsePiListModelsOutput,
	resolvePiAgentDirectory,
	resolvePiProviderModels,
	resolvePiRpcSmoke,
	runPiRpcSmokeProcess,
} from '../../src/main/pi-runtime/pi-readiness.ts';

const NOW = new Date('2026-06-05T00:00:00.000Z');
const RPC_KILL_GRACE_MS = 25;

interface FakeCommandOutcome {
	exitCode?: number | null;
	failureCode?: LocalCommandFailureCode;
	failureMessage?: string;
	status?: LocalCommandResult['status'];
	stderr?: string;
	stdout?: string;
	stdoutTruncated?: boolean;
}

function createDirectoryFixture(t: TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-pi-ready-'));

	t.after(() => {
		try {
			chmodSync(directory, 0o755);
		} catch {
			// Directory may have been removed by a test.
		}
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function createExecutable(filePath: string, source: string): string {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, source);
	chmodSync(filePath, 0o755);

	return filePath;
}

function createEnvironment(
	env: Record<string, string> = {},
): CommandEnvironmentSnapshot {
	return {
		diagnostics: [],
		env: {
			PATH: '/bin:/usr/bin',
			...env,
		},
		path: '/bin:/usr/bin',
		resolvedAt: NOW.toISOString(),
		shell: '/bin/sh',
		source: 'shell',
	};
}

function createPiExecutableSnapshot(
	overrides: Partial<PiExecutableSnapshot> = {},
): PiExecutableSnapshot {
	const command = overrides.command ?? '/tmp/pi';

	return {
		command,
		diagnostics: [],
		displayPath: command,
		path: command,
		probe: {
			args: ['--version'],
			detail: 'pi version 0.78.0',
			kind: 'version',
			status: 'success',
		},
		setting: null,
		source: 'path',
		status: 'ok',
		updatedAt: NOW.toISOString(),
		...overrides,
	};
}

function createLocalCommandService(
	outcome: FakeCommandOutcome,
	requests: Array<{ args: string[]; command: string }> = [],
): LocalCommandService {
	return {
		getEnvironment: async () => createEnvironment(),
		run: async (request) => {
			const args = Array.from(request.args ?? []);
			requests.push({ args, command: request.command });

			return createLocalCommandResult(request.command, args, outcome);
		},
	};
}

function createLocalCommandResult(
	command: string,
	args: string[],
	outcome: FakeCommandOutcome,
): LocalCommandResult {
	const status = outcome.status ?? 'success';
	const exitCode =
		outcome.exitCode ??
		(status === 'success'
			? 0
			: outcome.failureCode === 'command-not-found'
				? null
				: 1);
	const failure =
		status === 'success'
			? undefined
			: {
					code: outcome.failureCode ?? 'nonzero-exit',
					exitCode,
					message:
						outcome.failureMessage ??
						`Command exited with code ${String(exitCode)}.`,
					signal: null,
				};
	const stdout = outcome.stdout ?? '';
	const stderr = outcome.stderr ?? '';

	return {
		args,
		command,
		cwd: '/tmp',
		durationMs: 1,
		endedAt: NOW.toISOString(),
		environment: null,
		exitCode,
		failure,
		logs: {
			command: [command, ...args].join(' '),
			cwd: '/tmp',
			env: {},
			stderr,
			stdout,
		},
		signal: null,
		startedAt: NOW.toISOString(),
		status,
		stderr,
		stderrTruncated: false,
		stdout,
		stdoutTruncated: outcome.stdoutTruncated ?? false,
	};
}

test('resolves default Pi agent directory under the user home', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const agentDirectoryPath = path.join(homeDirectory, '.pi', 'agent');
	mkdirSync(agentDirectoryPath, { recursive: true });

	const snapshot = resolvePiAgentDirectory({
		environment: createEnvironment(),
		homeDirectory,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.source, 'default');
	assert.equal(snapshot.path, agentDirectoryPath);
});

test('uses PI_CODING_AGENT_DIR when it is present', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const configuredAgentDirectoryPath = path.join(homeDirectory, 'custom-agent');
	mkdirSync(configuredAgentDirectoryPath, { recursive: true });

	const snapshot = resolvePiAgentDirectory({
		environment: createEnvironment({
			PI_CODING_AGENT_DIR: configuredAgentDirectoryPath,
		}),
		homeDirectory,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.source, 'environment');
	assert.equal(snapshot.path, configuredAgentDirectoryPath);
});

test('reports a missing Pi agent directory', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const snapshot = resolvePiAgentDirectory({
		environment: createEnvironment(),
		homeDirectory,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.diagnostics[0]?.code, 'pi-agent-directory-missing');
});

test('reports a Pi agent directory path occupied by a file', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const agentDirectoryPath = path.join(homeDirectory, '.pi', 'agent');
	mkdirSync(path.dirname(agentDirectoryPath), { recursive: true });
	writeFileSync(agentDirectoryPath, 'not a directory');

	const snapshot = resolvePiAgentDirectory({
		environment: createEnvironment(),
		homeDirectory,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(
		snapshot.diagnostics[0]?.code,
		'pi-agent-directory-not-directory',
	);
});

test('reports inaccessible Pi agent directory permissions', (t) => {
	if (typeof process.getuid === 'function' && process.getuid() === 0) {
		t.skip('Root can access directories despite restrictive mode bits.');
	}

	const homeDirectory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-pi-ready-permissions-'),
	);
	const agentDirectoryPath = path.join(homeDirectory, '.pi', 'agent');
	t.after(() => {
		chmodSync(agentDirectoryPath, 0o755);
		rmSync(homeDirectory, { force: true, recursive: true });
	});
	mkdirSync(agentDirectoryPath, { recursive: true });
	chmodSync(agentDirectoryPath, 0o000);

	try {
		accessSync(
			agentDirectoryPath,
			constants.R_OK | constants.W_OK | constants.X_OK,
		);
		t.skip('chmod did not restrict access in this environment.');
		return;
	} catch {
		// Expected on normal user-owned filesystems.
	}

	const snapshot = resolvePiAgentDirectory({
		environment: createEnvironment(),
		homeDirectory,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(
		snapshot.diagnostics[0]?.code,
		'pi-agent-directory-inaccessible',
	);
});

test('passes a Pi RPC smoke process after a valid JSONL startup frame', async (t) => {
	const directory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(directory, 'valid-rpc'),
		'#!/bin/sh\nprintf \'{"type":"extension_ui_request"}\\n\'\nsleep 5\n',
	);
	const snapshot = await runPiRpcSmokeProcess({
		args: ['--mode', 'rpc'],
		command: executablePath,
		cwd: directory,
		env: createEnvironment().env,
		killGraceMs: RPC_KILL_GRACE_MS,
		maxOutputBytes: 4096,
		now: () => NOW,
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.firstFrame?.type, 'extension_ui_request');
	assert.equal(snapshot.logs.command, `${executablePath} --mode rpc`);
});

test('fails Pi RPC smoke process on invalid JSONL startup output', async (t) => {
	const directory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(directory, 'invalid-rpc'),
		'#!/bin/sh\nprintf "not-json\\n"\n',
	);
	const snapshot = await runPiRpcSmokeProcess({
		args: ['--mode', 'rpc'],
		command: executablePath,
		cwd: directory,
		env: createEnvironment().env,
		killGraceMs: RPC_KILL_GRACE_MS,
		maxOutputBytes: 4096,
		now: () => NOW,
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'invalid-jsonl');
});

test('fails Pi RPC smoke process when the process crashes before JSONL', async (t) => {
	const directory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(directory, 'crash-rpc'),
		'#!/bin/sh\nprintf "rpc crashed" >&2\nexit 42\n',
	);
	const snapshot = await runPiRpcSmokeProcess({
		args: ['--mode', 'rpc'],
		command: executablePath,
		cwd: directory,
		env: createEnvironment().env,
		killGraceMs: RPC_KILL_GRACE_MS,
		maxOutputBytes: 4096,
		now: () => NOW,
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'nonzero-exit');
	assert.equal(snapshot.failure?.exitCode, 42);
	assert.equal(snapshot.logs.stderr, 'rpc crashed');
});

test('fails Pi RPC smoke process on timeout', async (t) => {
	const directory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(directory, 'timeout-rpc'),
		'#!/bin/sh\nsleep 5\n',
	);
	const snapshot = await runPiRpcSmokeProcess({
		args: ['--mode', 'rpc'],
		command: executablePath,
		cwd: directory,
		env: createEnvironment().env,
		killGraceMs: RPC_KILL_GRACE_MS,
		maxOutputBytes: 4096,
		now: () => NOW,
		timeoutMs: 25,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'timeout');
});

test('kills Pi RPC smoke process that ignores graceful termination', async (t) => {
	const directory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(directory, 'ignores-term-rpc'),
		'#!/bin/sh\ntrap "" TERM\nprintf \'{"type":"extension_ui_request"}\\n\'\nsleep 5\n',
	);
	const snapshot = await runPiRpcSmokeProcess({
		args: ['--mode', 'rpc'],
		command: executablePath,
		cwd: directory,
		env: createEnvironment().env,
		killGraceMs: RPC_KILL_GRACE_MS,
		maxOutputBytes: 4096,
		now: () => NOW,
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.signal, 'SIGKILL');
	assert.equal(snapshot.firstFrame?.type, 'extension_ui_request');
});

test('surfaces Pi RPC stderr while accepting a valid JSONL frame', async (t) => {
	const directory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(directory, 'stderr-rpc'),
		'#!/bin/sh\nprintf "provider warning" >&2\nprintf \'{"type":"extension_ui_request"}\\n\'\n',
	);
	const snapshot = await runPiRpcSmokeProcess({
		args: ['--mode', 'rpc'],
		command: executablePath,
		cwd: directory,
		env: createEnvironment().env,
		killGraceMs: RPC_KILL_GRACE_MS,
		maxOutputBytes: 4096,
		now: () => NOW,
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.logs.stderr, 'provider warning');
});

test('does not run Pi RPC smoke when executable discovery failed', async () => {
	const snapshot = await resolvePiRpcSmoke({
		environment: createEnvironment(),
		executable: createPiExecutableSnapshot({
			command: '',
			diagnostics: [
				{
					code: 'pi-executable-not-found',
					message: 'Pi executable was not found.',
					severity: 'error',
				},
			],
			displayPath: '',
			path: '',
			probe: null,
			source: null,
			status: 'error',
		}),
		now: () => NOW,
		smokeWorkspace: { path: '/tmp/ensemble-smoke' },
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'executable-not-ready');
});

test('parses pi --list-models provider/model output', () => {
	assert.deepEqual(
		parsePiListModelsOutput(
			`provider      model       context\nopenai-codex  gpt-5.5     272K\nanthropic     claude      200K\n`,
		),
		{
			modelCount: 2,
			models: [
				{
					id: 'openai-codex/gpt-5.5',
					model: 'gpt-5.5',
					provider: 'openai-codex',
				},
				{ id: 'anthropic/claude', model: 'claude', provider: 'anthropic' },
			],
			providerCount: 2,
		},
	);
});

test('parses single-space-separated table rows', () => {
	assert.deepEqual(
		parsePiListModelsOutput(
			`provider model context max-out thinking images
google gemini-2.0-flash 1.0M 8.2K no yes
google gemini-2.5-pro 1.0M 65.5K yes yes
anthropic claude-sonnet-4 200K 8.0K yes yes
`,
		),
		{
			modelCount: 3,
			models: [
				{
					id: 'google/gemini-2.0-flash',
					model: 'gemini-2.0-flash',
					provider: 'google',
				},
				{
					id: 'google/gemini-2.5-pro',
					model: 'gemini-2.5-pro',
					provider: 'google',
				},
				{
					id: 'anthropic/claude-sonnet-4',
					model: 'claude-sonnet-4',
					provider: 'anthropic',
				},
			],
			providerCount: 2,
		},
	);
});

test('falls back to stderr when pi --list-models prints the table there', async () => {
	const requests: Array<{ args: string[]; command: string }> = [];
	const snapshot = await resolvePiProviderModels({
		executable: createPiExecutableSnapshot({ command: '/opt/bin/pi' }),
		localCommandService: createLocalCommandService(
			{
				stderr:
					'provider model context\ngoogle gemini-2.5-pro 1.0M\nanthropic claude-sonnet-4 200K\n',
				stdout: '',
			},
			requests,
		),
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.modelCount, 2);
	assert.equal(snapshot.providerCount, 2);
});

test('passes provider readiness when pi --list-models returns at least one model', async () => {
	const requests: Array<{ args: string[]; command: string }> = [];
	const snapshot = await resolvePiProviderModels({
		executable: createPiExecutableSnapshot({ command: '/opt/bin/pi' }),
		localCommandService: createLocalCommandService(
			{
				stdout: `provider      model       context\nopenai-codex  gpt-5.5     272K\n`,
			},
			requests,
		),
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'success');
	assert.equal(snapshot.modelCount, 1);
	assert.equal(snapshot.providerCount, 1);
	assert.deepEqual(requests, [
		{ args: ['--list-models'], command: '/opt/bin/pi' },
	]);
});

test('fails provider readiness when pi --list-models returns no models', async () => {
	const snapshot = await resolvePiProviderModels({
		executable: createPiExecutableSnapshot(),
		localCommandService: createLocalCommandService({
			stdout: 'provider      model       context\n',
		}),
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'no-models');
});

test('fails provider readiness on nonzero pi --list-models exit', async () => {
	const snapshot = await resolvePiProviderModels({
		executable: createPiExecutableSnapshot(),
		localCommandService: createLocalCommandService({
			failureCode: 'nonzero-exit',
			failureMessage: 'Command exited with code 1.',
			status: 'failure',
			stderr: 'provider auth failed',
		}),
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'nonzero-exit');
	assert.match(
		snapshot.failure?.message ?? '',
		/provider\/model listing failed/i,
	);
});

test('fails provider readiness on pi --list-models timeout', async () => {
	const snapshot = await resolvePiProviderModels({
		executable: createPiExecutableSnapshot(),
		localCommandService: createLocalCommandService({
			failureCode: 'timeout',
			failureMessage: 'The command timed out.',
			status: 'failure',
		}),
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'timeout');
});

test('fails provider readiness on truncated pi --list-models output', async () => {
	const snapshot = await resolvePiProviderModels({
		executable: createPiExecutableSnapshot(),
		localCommandService: createLocalCommandService({
			failureCode: 'output-truncated',
			failureMessage: 'Output was truncated.',
			status: 'failure',
			stdoutTruncated: true,
		}),
		timeoutMs: 1000,
	});

	assert.equal(snapshot.status, 'failure');
	assert.equal(snapshot.failure?.code, 'output-truncated');
});
