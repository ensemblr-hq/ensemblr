import { expect, test } from 'vitest';

import { createPiReadinessProbe } from '../../src/main/agent-providers/pi-readiness-probe.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import type {
	PiAgentDirectorySnapshot,
	PiProviderModelSnapshot,
	PiReadinessService,
	PiReadinessSnapshot,
	PiRpcSmokeSnapshot,
} from '../../src/main/pi-runtime/pi-runtime-types.ts';
import type { AgentProviderReadinessWire } from '../../src/shared/ipc/contracts/agent-provider.ts';
import type { ResolvedSettingSnapshot } from '../../src/shared/ipc/contracts/settings-resolution.ts';

const GENERATED_AT = '2026-08-20T00:00:00.000Z';

const LOCKED_OVERRIDE: ResolvedSettingSnapshot = {
	candidates: [],
	key: 'pi.executablePath',
	locked: true,
	source: 'managed-config',
	value: '/opt/pi/bin/pi',
};

const EXECUTABLE: PiExecutableSnapshot = {
	command: 'pi',
	diagnostics: [],
	displayPath: '/usr/local/bin/pi',
	path: '/usr/local/bin/pi',
	probe: null,
	setting: null,
	source: 'path',
	status: 'ok',
	updatedAt: GENERATED_AT,
};

const UNDISCOVERED_EXECUTABLE: PiExecutableSnapshot = {
	...EXECUTABLE,
	command: '',
	diagnostics: [
		{
			code: 'pi-executable-missing',
			message: 'pi was not found on PATH.',
			severity: 'error',
		},
	],
	displayPath: '',
	path: '',
	source: null,
	status: 'error',
};

const AGENT_DIRECTORY: PiAgentDirectorySnapshot = {
	diagnostics: [],
	path: '/home/dev/.pi/agent',
	source: 'default',
	status: 'success',
};

const PROVIDER_MODELS: PiProviderModelSnapshot = {
	command: 'pi',
	modelCount: 12,
	models: [],
	providerCount: 3,
	result: null,
	status: 'success',
};

const RPC: PiRpcSmokeSnapshot = {
	args: ['--mode', 'rpc'],
	command: 'pi',
	cwd: '/tmp/pi-smoke',
	durationMs: 12,
	endedAt: GENERATED_AT,
	firstFrame: { type: 'extension_ui_request' },
	logs: {
		command: 'pi --mode rpc',
		cwd: '/tmp/pi-smoke',
		stderr: '',
		stdout: '',
	},
	signal: null,
	startedAt: GENERATED_AT,
	status: 'success',
	stderrTruncated: false,
	stdoutTruncated: false,
};

function createSnapshot(
	overrides: Partial<PiReadinessSnapshot> = {},
): PiReadinessSnapshot {
	return {
		agentDirectory: AGENT_DIRECTORY,
		executable: EXECUTABLE,
		generatedAt: GENERATED_AT,
		providerModels: PROVIDER_MODELS,
		rpc: RPC,
		...overrides,
	};
}

function createProbe(snapshot: PiReadinessSnapshot) {
	const piReadinessService: PiReadinessService = {
		getSnapshot: async () => snapshot,
	};

	return createPiReadinessProbe({ piReadinessService });
}

function listRemediations(
	readiness: AgentProviderReadinessWire,
): [string, string[]][] {
	return readiness.checks.map((check) => [
		check.id,
		check.remediations.map((action) => action.id),
	]);
}

test('a passing probe carries no remediation on any check', async () => {
	const readiness = await createProbe(createSnapshot()).probe();

	expect(readiness.status).toBe('success');
	expect(listRemediations(readiness)).toEqual([
		['executable', []],
		['agent-directory', []],
		['rpc-smoke', []],
		['provider-models', []],
	]);
});

test('a failing executable offers the picker and no re-run action', async () => {
	const readiness = await createProbe(
		createSnapshot({ executable: UNDISCOVERED_EXECUTABLE }),
	).probe();
	const executable = readiness.checks.find(
		(check) => check.id === 'executable',
	);

	expect(executable?.status).toBe('failure');
	expect(executable?.remediations.map((action) => action.id)).toEqual([
		'select-pi-executable',
	]);
	expect(executable?.remediations.map((action) => action.kind)).toEqual([
		'select-path',
	]);
});

test('a warning executable keeps the picker', async () => {
	const readiness = await createProbe(
		createSnapshot({ executable: { ...EXECUTABLE, status: 'warning' } }),
	).probe();
	const executable = readiness.checks.find(
		(check) => check.id === 'executable',
	);

	expect(executable?.status).toBe('warning');
	expect(executable?.remediations.map((action) => action.id)).toEqual([
		'select-pi-executable',
	]);
});

test('a locked override drops the picker even when discovery fails', async () => {
	const readiness = await createProbe(
		createSnapshot({
			executable: { ...UNDISCOVERED_EXECUTABLE, setting: LOCKED_OVERRIDE },
		}),
	).probe();
	const executable = readiness.checks.find(
		(check) => check.id === 'executable',
	);

	expect(executable?.status).toBe('failure');
	expect(executable?.remediations).toEqual([]);
});

test('the runtime checks carry no remediation when they fail', async () => {
	const readiness = await createProbe(
		createSnapshot({
			agentDirectory: {
				...AGENT_DIRECTORY,
				diagnostics: [
					{
						code: 'pi-agent-directory-missing',
						message: 'The agent directory does not exist.',
						severity: 'error',
					},
				],
				status: 'failure',
			},
			providerModels: {
				...PROVIDER_MODELS,
				failure: { code: 'no-models', message: 'pi listed no models.' },
				modelCount: 0,
				providerCount: 0,
				status: 'failure',
			},
			rpc: {
				...RPC,
				failure: {
					code: 'no-jsonl',
					exitCode: 1,
					message: 'pi --mode rpc printed no JSONL frame.',
					signal: null,
				},
				firstFrame: undefined,
				status: 'failure',
			},
		}),
	).probe();

	expect(readiness.status).toBe('failure');
	expect(listRemediations(readiness)).toEqual([
		['executable', []],
		['agent-directory', []],
		['rpc-smoke', []],
		['provider-models', []],
	]);
	expect(
		readiness.checks
			.filter((check) => check.id !== 'executable')
			.map((check) => check.status),
	).toEqual(['failure', 'failure', 'failure']);
});

test('no check offers a retry action, whatever the outcome', async () => {
	const passing = await createProbe(createSnapshot()).probe();
	const failing = await createProbe(
		createSnapshot({ executable: UNDISCOVERED_EXECUTABLE }),
	).probe();

	expect(
		[...passing.checks, ...failing.checks].flatMap((check) =>
			check.remediations.map((action) => action.kind),
		),
	).not.toContain('retry');
});
