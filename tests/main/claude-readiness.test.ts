import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import type {
	AgentExecutableResolution,
	AgentProviderExecutableService,
	AgentProviderReadinessProbe,
} from '../../src/main/agent-providers/agent-provider-types.ts';
import { resolveClaudeExecutable } from '../../src/main/agent-providers/claude-executable.ts';
import { createClaudeReadinessProbe } from '../../src/main/agent-providers/claude-readiness-probe.ts';
import type {
	CommandEnvironmentSnapshot,
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command.ts';
import type { SettingsResolutionSnapshot } from '../../src/shared/ipc/contracts/settings-resolution.ts';

const NOW = new Date('2026-08-07T00:00:00.000Z');

/** Session deadline the timeout tests drive, so nothing waits on a real clock. */
const IMMEDIATE_TIMEOUT_MS = 1;

/** Grace window {@link promptStreamEnded} waits before calling a stream pending. */
const PROMPT_SETTLE_MS = 20;

const createdDirectories: string[] = [];

afterEach(() => {
	while (createdDirectories.length > 0) {
		rmSync(createdDirectories.pop() as string, {
			force: true,
			recursive: true,
		});
	}
});

/** Creates a throwaway directory that is removed after the test. */
function createDirectory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-claude-ready-'));
	createdDirectories.push(directory);
	return directory;
}

/** Writes an executable stub at `filePath` and returns it. */
function createExecutable(filePath: string): string {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, '#!/bin/sh\necho claude 2.1.220\n');
	chmodSync(filePath, 0o755);
	return filePath;
}

/** Builds an app-scope settings snapshot carrying zero or one setting. */
function settingsSnapshot(value?: string): SettingsResolutionSnapshot {
	return {
		app: {
			diagnostics: [],
			settings: value
				? [
						{
							candidates: [],
							key: 'claude.executablePath',
							locked: false,
							source: 'sqlite',
							value,
						},
					]
				: [],
		},
	};
}

/** Builds a command environment whose PATH holds only `directories`. */
function environment(
	directories: readonly string[],
): CommandEnvironmentSnapshot {
	return {
		diagnostics: [],
		env: {},
		path: directories.join(path.delimiter),
		resolvedAt: NOW.toISOString(),
		shell: '/bin/zsh',
		source: 'shell',
	};
}

/** Builds a `LocalCommandService` stub with a fixed PATH and `run` outcome. */
function createCommandService({
	pathDirectories = [],
	run,
}: {
	pathDirectories?: readonly string[];
	run?: (request: LocalCommandRequest) => LocalCommandResult;
} = {}): LocalCommandService & { requests: LocalCommandRequest[] } {
	const requests: LocalCommandRequest[] = [];

	return {
		getEnvironment: async () => environment(pathDirectories),
		requests,
		run: async (request) => {
			requests.push(request);
			return (
				run?.(request) ??
				commandResult({ command: request.command, stdout: '' })
			);
		},
	};
}

/** Builds a `LocalCommandResult` with sensible defaults. */
function commandResult({
	command,
	failureMessage,
	status = 'success',
	stdout = '',
}: {
	command: string;
	failureMessage?: string;
	status?: LocalCommandResult['status'];
	stdout?: string;
}): LocalCommandResult {
	return {
		args: ['--version'],
		command,
		cwd: '/',
		durationMs: 1,
		endedAt: NOW.toISOString(),
		environment: null,
		exitCode: status === 'success' ? 0 : 1,
		...(failureMessage
			? {
					failure: {
						code: 'nonzero-exit' as const,
						exitCode: 1,
						message: failureMessage,
						signal: null,
					},
				}
			: {}),
		logs: { command, cwd: '/', env: {}, stderr: '', stdout },
		signal: null,
		startedAt: NOW.toISOString(),
		status,
		stderr: '',
		stderrTruncated: false,
		stdout,
		stdoutTruncated: false,
	};
}

/** Builds an executable service stub returning a fixed resolution. */
function createExecutableService(
	resolution: AgentExecutableResolution,
): AgentProviderExecutableService {
	return {
		clearOverride: () => ({ canceled: false }),
		getSnapshot: async () => resolution,
		saveOverride: () => ({ canceled: false }),
	};
}

/** Captured `query()` options plus the stub the probe drove. */
interface QueryStub {
	closed: number;
	opened: number;
	options: Record<string, unknown> | null;
	prompt: AsyncIterable<unknown> | null;
}

/**
 * Builds a `query()` stand-in that answers `accountInfo()`/`mcpServerStatus()`
 * with the supplied fixtures and records how it was opened. `stall` returns a
 * promise that never settles, standing in for a runtime wedged mid-negotiation.
 */
function createQueryStub({
	account,
	mcpServers = [],
	stall = false,
	stallUsage = false,
	throwOnAccount,
	usage,
}: {
	account?: Record<string, unknown>;
	mcpServers?: readonly { name: string; status: string }[];
	stall?: boolean;
	stallUsage?: boolean;
	throwOnAccount?: string;
	usage?: Record<string, unknown>;
}): { queryFn: never; stub: QueryStub } {
	const stub: QueryStub = {
		closed: 0,
		opened: 0,
		options: null,
		prompt: null,
	};

	const queryFn = (input: {
		options: Record<string, unknown>;
		prompt: AsyncIterable<unknown>;
	}) => {
		stub.opened += 1;
		stub.options = input.options;
		stub.prompt = input.prompt;
		return {
			accountInfo: async () => {
				if (stall) {
					return new Promise(() => undefined);
				}
				if (throwOnAccount) {
					throw new Error(throwOnAccount);
				}
				return account ?? {};
			},
			close: () => {
				stub.closed += 1;
			},
			mcpServerStatus: async () => mcpServers,
			usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
				if (stallUsage) {
					return new Promise(() => undefined);
				}
				if (!usage) {
					throw new Error('unknown control request: get_usage');
				}
				return usage;
			},
		};
	};

	return { queryFn: queryFn as never, stub };
}

/**
 * Reports whether the probe's idle prompt stream has ended, which is the only
 * observable signal that its `close()` seam ran.
 * @param prompt - Prompt stream the probe handed to `query()`.
 * @returns True when the stream's iterator settled inside the grace window.
 */
async function promptStreamEnded(
	prompt: AsyncIterable<unknown>,
): Promise<boolean> {
	const pending = Symbol('pending');
	const settled = await Promise.race([
		prompt[Symbol.asyncIterator]().next(),
		new Promise<symbol>((resolve) => {
			setTimeout(() => resolve(pending), PROMPT_SETTLE_MS);
		}),
	]);

	return settled !== pending;
}

/** Builds a probe over a healthy PATH-resolved executable and the given seams. */
function createProbe({
	localCommandService = createCommandService(),
	queryFn,
	sessionTimeoutMs,
	usageTimeoutMs,
}: {
	localCommandService?: LocalCommandService;
	queryFn: never;
	sessionTimeoutMs?: number;
	usageTimeoutMs?: number;
}): AgentProviderReadinessProbe {
	return createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService,
		now: () => NOW,
		queryFn,
		sessionTimeoutMs,
		usageTimeoutMs,
	});
}

test('resolveClaudeExecutable prefers the configured override', async () => {
	const directory = createDirectory();
	const override = createExecutable(path.join(directory, 'custom', 'claude'));

	const resolution = await resolveClaudeExecutable({
		homeDirectory: directory,
		localCommandService: createCommandService(),
		settingsSnapshot: settingsSnapshot(override),
	});

	expect(resolution).toMatchObject({
		path: override,
		source: 'sqlite',
		status: 'ok',
	});
});

test('resolveClaudeExecutable reports an unrunnable override as an error', async () => {
	const directory = createDirectory();

	const resolution = await resolveClaudeExecutable({
		homeDirectory: directory,
		localCommandService: createCommandService(),
		settingsSnapshot: settingsSnapshot(path.join(directory, 'nope', 'claude')),
	});

	expect(resolution.path).toBe('');
	expect(resolution.status).toBe('error');
});

test('resolveClaudeExecutable falls back to PATH when no override is set', async () => {
	const directory = createDirectory();
	const onPath = createExecutable(path.join(directory, 'bin', 'claude'));

	const resolution = await resolveClaudeExecutable({
		homeDirectory: directory,
		localCommandService: createCommandService({
			pathDirectories: [path.dirname(onPath)],
		}),
		settingsSnapshot: settingsSnapshot(),
	});

	expect(resolution).toMatchObject({ path: onPath, source: 'path' });
});

test('resolveClaudeExecutable reports an error when nothing is installed', async () => {
	const directory = createDirectory();

	const resolution = await resolveClaudeExecutable({
		homeDirectory: directory,
		localCommandService: createCommandService({
			pathDirectories: [path.join(directory, 'empty')],
		}),
		settingsSnapshot: settingsSnapshot(),
	});

	expect(resolution).toMatchObject({
		path: '',
		setting: null,
		source: 'missing',
		status: 'error',
	});
});

test('probe reports a signed-in account and a healthy roll-up', async () => {
	const { queryFn, stub } = createQueryStub({
		account: {
			apiProvider: 'firstParty',
			email: 'dev@example.com',
			organization: 'Example Org',
			subscriptionType: 'Max 20x',
			tokenSource: 'keychain',
		},
		mcpServers: [{ name: 'ensemblr', status: 'connected' }],
	});
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService: createCommandService({
			run: (request) =>
				commandResult({
					command: request.command,
					stdout: '2.1.220 (Claude Code)',
				}),
		}),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();

	expect(readiness.provider).toBe('claude');
	expect(readiness.status).toBe('success');
	expect(readiness.executableSource).toBe('path');
	expect(readiness.version).toBe('2.1.220 (Claude Code)');
	expect(readiness.account).toEqual({
		apiProvider: 'firstParty',
		email: 'dev@example.com',
		organization: 'Example Org',
		subscriptionType: 'Max 20x',
		tokenSource: 'keychain',
	});
	expect(readiness.checks.map((check) => check.id)).toEqual([
		'executable',
		'version',
		'auth',
		'mcp',
	]);
	expect(stub.closed).toBe(1);
});

test('probe carries the plan windows the runtime reports', async () => {
	const { queryFn } = createQueryStub({
		account: { email: 'dev@example.com' },
		usage: {
			rate_limits: {
				five_hour: { resets_at: '2026-08-07T05:00:00.000Z', utilization: 62 },
				seven_day: { resets_at: '2026-08-11T09:00:00.000Z', utilization: 31 },
			},
			rate_limits_available: true,
			subscription_type: 'max',
		},
	});

	const readiness = await createProbe({ queryFn }).probe();

	expect(readiness.usage).toEqual({
		available: true,
		limits: [
			{
				displayName: null,
				id: 'five_hour',
				resetsAt: '2026-08-07T05:00:00.000Z',
				utilization: 62,
			},
			{
				displayName: null,
				id: 'seven_day',
				resetsAt: '2026-08-11T09:00:00.000Z',
				utilization: 31,
			},
		],
		subscriptionType: 'max',
	});
});

test('a hanging usage endpoint costs the usage panel, not the account row', async () => {
	const { queryFn } = createQueryStub({
		account: { email: 'dev@example.com' },
		mcpServers: [{ name: 'linear', status: 'connected' }],
		stallUsage: true,
	});

	const readiness = await createProbe({ queryFn, usageTimeoutMs: 10 }).probe();

	expect(readiness.usage).toBeNull();
	expect(readiness.account).toMatchObject({ email: 'dev@example.com' });
	expect(readiness.status).toBe('success');
	expect(readiness.checks.map((check) => check.status)).not.toContain(
		'failure',
	);
});

test('a runtime that cannot report usage still probes as ready', async () => {
	const { queryFn } = createQueryStub({
		account: { email: 'dev@example.com' },
	});

	const readiness = await createProbe({ queryFn }).probe();

	expect(readiness.usage).toBeNull();
	expect(readiness.status).toBe('success');
	expect(readiness.checks.map((check) => check.status)).not.toContain(
		'failure',
	);
});

test('probe never inherits the harness permission bypass', async () => {
	const { queryFn, stub } = createQueryStub({ account: { email: 'a@b.c' } });
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService: createCommandService(),
		now: () => NOW,
		queryFn,
	});

	await probe.probe();

	expect(stub.options?.permissionMode).toBe('plan');
	expect(JSON.stringify(stub.options)).not.toContain('bypassPermissions');
	expect(JSON.stringify(stub.options)).not.toContain('dangerously');
});

test('probe fails and offers an install step when no executable is found', async () => {
	const { queryFn, stub } = createQueryStub({ account: { email: 'a@b.c' } });
	const commandService = createCommandService();
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '',
			setting: null,
			source: 'missing',
			status: 'error',
		}),
		localCommandService: commandService,
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();
	const executable = readiness.checks.find(
		(check) => check.id === 'executable',
	);

	expect(stub.options).toBeNull();
	expect(commandService.requests).toHaveLength(0);
	expect(readiness.status).toBe('failure');
	expect(readiness.executableSource).toBe('missing');
	expect(readiness.executablePath).toBeNull();
	expect(readiness.version).toBeNull();
	expect(executable?.status).toBe('failure');
	expect(executable?.detail).toContain('Ensemblr does not ship Claude Code');
	expect(executable?.remediations).toContainEqual({
		command: 'curl -fsSL https://claude.ai/install.sh | bash',
		id: 'install-claude-code',
		kind: 'run-command',
		label: 'Copy the Claude Code install command',
	});
	expect(executable?.remediations).toContainEqual({
		id: 'open-claude-setup-docs',
		kind: 'open-external',
		label: 'Open Claude Code setup docs',
		target: 'https://code.claude.com/docs/en/setup',
	});
});

test('probe fails the version and auth checks when no executable is found', async () => {
	const { queryFn } = createQueryStub({ account: { email: 'a@b.c' } });
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '',
			setting: null,
			source: 'missing',
			status: 'error',
		}),
		localCommandService: createCommandService(),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();
	const version = readiness.checks.find((check) => check.id === 'version');
	const auth = readiness.checks.find((check) => check.id === 'auth');

	expect(readiness.account).toBeNull();
	expect(version?.status).toBe('failure');
	expect(version?.remediations.map((action) => action.id)).toContain(
		'install-claude-code',
	);
	expect(auth?.status).toBe('failure');
	expect(auth?.detail).toContain('Ensemblr does not ship Claude Code');
	expect(auth?.remediations.map((action) => action.id)).toEqual([
		'install-claude-code',
		'open-claude-setup-docs',
		'run-claude-login',
		'retry-claude-readiness',
	]);
	expect(readiness.checks.find((check) => check.id === 'mcp')?.status).toBe(
		'warning',
	);
});

test('probe keeps the override remediation when a configured binary is unrunnable', async () => {
	const { queryFn } = createQueryStub({ account: { email: 'a@b.c' } });
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '',
			setting: {
				candidates: [],
				key: 'claude.executablePath',
				locked: false,
				source: 'sqlite',
				value: '/nope/claude',
			},
			source: 'sqlite',
			status: 'error',
		}),
		localCommandService: createCommandService(),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();
	const executable = readiness.checks.find(
		(check) => check.id === 'executable',
	);

	expect(readiness.executableSource).toBe('missing');
	expect(executable?.status).toBe('failure');
	expect(executable?.detail).toContain('could not be run');
	expect(executable?.remediations.map((action) => action.id)).toEqual([
		'select-claude-executable',
		'retry-claude-readiness',
	]);
});

test('probe attaches a claude /login remediation when auth is missing', async () => {
	const { queryFn } = createQueryStub({
		throwOnAccount: 'Invalid API key. Please run /login',
	});
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService: createCommandService(),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();
	const auth = readiness.checks.find((check) => check.id === 'auth');

	expect(readiness.status).toBe('failure');
	expect(readiness.account).toBeNull();
	expect(auth?.status).toBe('failure');
	expect(auth?.remediations).toContainEqual({
		command: 'claude /login',
		id: 'run-claude-login',
		kind: 'run-command',
		label: 'Run claude /login',
	});
});

test('probe treats an empty account as signed out', async () => {
	const { queryFn } = createQueryStub({ account: {} });
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService: createCommandService(),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();

	expect(readiness.status).toBe('failure');
	expect(readiness.checks.find((check) => check.id === 'auth')?.status).toBe(
		'failure',
	);
});

test('probe warns rather than fails on an unhealthy MCP server', async () => {
	const { queryFn } = createQueryStub({
		account: { email: 'a@b.c' },
		mcpServers: [
			{ name: 'ensemblr', status: 'failed' },
			{ name: 'linear', status: 'connected' },
		],
	});
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService: createCommandService(),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();
	const mcp = readiness.checks.find((check) => check.id === 'mcp');

	expect(readiness.status).toBe('success');
	expect(mcp?.status).toBe('warning');
	expect(mcp?.detail).toContain('ensemblr: failed');
});

test('probe fails when the session never answers within the deadline', async () => {
	const { queryFn } = createQueryStub({ stall: true });
	const probe = createProbe({
		queryFn,
		sessionTimeoutMs: IMMEDIATE_TIMEOUT_MS,
	});

	const readiness = await probe.probe();
	const auth = readiness.checks.find((check) => check.id === 'auth');

	expect(readiness.status).toBe('failure');
	expect(readiness.account).toBeNull();
	expect(auth?.status).toBe('failure');
	expect(auth?.detail).toContain('did not answer');
	expect(auth?.remediations.map((action) => action.id)).toContain(
		'retry-claude-readiness',
	);
});

test('probe closes the session and prompt stream when the deadline elapses', async () => {
	const { queryFn, stub } = createQueryStub({ stall: true });
	const probe = createProbe({
		queryFn,
		sessionTimeoutMs: IMMEDIATE_TIMEOUT_MS,
	});

	await probe.probe();

	expect(stub.closed).toBe(1);
	expect(stub.prompt).not.toBeNull();
	await expect(
		promptStreamEnded(stub.prompt as AsyncIterable<unknown>),
	).resolves.toBe(true);
});

test('concurrent probes share one session, and a later probe starts a new one', async () => {
	const { queryFn, stub } = createQueryStub({ account: { email: 'a@b.c' } });
	const commandService = createCommandService();
	const probe = createProbe({ localCommandService: commandService, queryFn });

	const [first, second] = await Promise.all([probe.probe(), probe.probe()]);

	expect(stub.opened).toBe(1);
	expect(commandService.requests).toHaveLength(1);
	expect(first).toBe(second);

	await probe.probe();

	expect(stub.opened).toBe(2);
});

test('probe fails the version check when --version does not run', async () => {
	const { queryFn } = createQueryStub({ account: { email: 'a@b.c' } });
	const probe = createClaudeReadinessProbe({
		executableService: createExecutableService({
			path: '/opt/homebrew/bin/claude',
			setting: null,
			source: 'path',
			status: 'ok',
		}),
		localCommandService: createCommandService({
			run: (request) =>
				commandResult({
					command: request.command,
					failureMessage: 'exited with code 1',
					status: 'failure',
				}),
		}),
		now: () => NOW,
		queryFn,
	});

	const readiness = await probe.probe();

	expect(readiness.status).toBe('failure');
	expect(readiness.version).toBeNull();
	expect(
		readiness.checks.find((check) => check.id === 'version')?.logs,
	).toBeTruthy();
});
