import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHarnessDetectionService } from '../../src/main/agents/harness-detection-service.ts';
import type { CommandEnvironmentSnapshot } from '../../src/main/commands/command-types.ts';
import type { LocalCommandService } from '../../src/main/commands/local-command';

/** Builds a stub LocalCommandService whose env exposes only `pathValue`. */
function stubCommandService(pathValue: string): LocalCommandService {
	const environment: CommandEnvironmentSnapshot = {
		diagnostics: [],
		env: { PATH: pathValue },
		path: pathValue,
		resolvedAt: '2026-07-20T00:00:00.000Z',
		shell: '/bin/sh',
		source: 'shell',
	};
	return {
		getEnvironment: async () => environment,
		run: async () => {
			throw new Error('run is not used by detection');
		},
	};
}

/** Writes an executable named `name` into a fresh temp dir and returns that dir. */
function binDirWith(name: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'harness-bin-'));
	const file = path.join(dir, name);
	writeFileSync(file, '#!/bin/sh\nexit 0\n');
	chmodSync(file, 0o755);
	return dir;
}

describe('createHarnessDetectionService', () => {
	it('marks a harness available when its binary is on PATH', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('claude')),
		});
		const { harnesses } = await service.listHarnesses();
		const claude = harnesses.find((harness) => harness.id === 'claude');
		expect(claude?.available).toBe(true);
	});

	it('marks harnesses unavailable when their binaries are absent', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('claude')),
		});
		const { harnesses } = await service.listHarnesses();
		const codex = harnesses.find((harness) => harness.id === 'codex');
		expect(codex?.available).toBe(false);
	});

	it('resolves the trusted launch command for an installed harness', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('claude')),
		});
		const command = await service.resolveLaunchCommand('claude');
		expect(command).toBe('claude --dangerously-skip-permissions');
	});

	it('returns null for an uninstalled harness', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('claude')),
		});
		expect(await service.resolveLaunchCommand('codex')).toBeNull();
	});

	it('returns null for an unknown harness id', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('claude')),
		});
		expect(await service.resolveLaunchCommand('not-a-harness')).toBeNull();
	});

	it('resolves the resume command for an installed harness', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('codex')),
		});
		expect(await service.resolveResumeCommand('codex')).toBe(
			'codex --dangerously-bypass-approvals-and-sandbox resume --last',
		);
	});

	it('falls back to the launch command when a harness has no resume builder', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('opencode')),
			registry: [
				{
					binaries: ['opencode'],
					buildCommand: (bin) => `${bin} --auto`,
					id: 'opencode',
					label: 'opencode',
				},
			],
		});
		expect(await service.resolveResumeCommand('opencode')).toBe(
			'opencode --auto',
		);
	});

	it('returns null resume command for an uninstalled harness', async () => {
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(binDirWith('claude')),
		});
		expect(await service.resolveResumeCommand('codex')).toBeNull();
	});

	it('caches detection within the TTL and re-probes after it', async () => {
		let currentMs = 1000;
		const dir = mkdtempSync(path.join(tmpdir(), 'harness-bin-'));
		const service = createHarnessDetectionService({
			commonDirs: [],
			localCommandService: stubCommandService(dir),
			now: () => currentMs,
		});

		const before = await service.listHarnesses();
		expect(
			before.harnesses.find((harness) => harness.id === 'claude')?.available,
		).toBe(false);

		const file = path.join(dir, 'claude');
		writeFileSync(file, '#!/bin/sh\nexit 0\n');
		chmodSync(file, 0o755);

		const within = await service.listHarnesses();
		expect(
			within.harnesses.find((harness) => harness.id === 'claude')?.available,
		).toBe(false);

		currentMs += 60_000;
		const after = await service.listHarnesses();
		expect(
			after.harnesses.find((harness) => harness.id === 'claude')?.available,
		).toBe(true);
	});
});
