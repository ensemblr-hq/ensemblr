import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
	CommandEnvironmentSnapshot,
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
	LocalCommandStatus,
} from '../../src/main/commands/index.ts';
import { detectInstalledTargets } from '../../src/main/open-target/detect-installed-targets.ts';
import {
	OPEN_TARGET_REGISTRY,
	resolvePlatformBehavior,
} from '../../src/main/open-target/open-target-registry.ts';

/**
 * Builds a {@link LocalCommandResult} carrying just the fields detection reads,
 * so a fake command runner can stand in for the real service.
 * @param status - Terminal status of the fake run.
 * @param stdout - Standard output the fake run should report.
 * @param request - The originating request, echoed onto the result.
 * @returns A minimally-populated command result.
 */
function fakeResult(
	status: LocalCommandStatus,
	stdout: string,
	request: LocalCommandRequest,
): LocalCommandResult {
	return {
		args: [...(request.args ?? [])],
		command: request.command,
		cwd: '/',
		durationMs: 0,
		endedAt: '1970-01-01T00:00:00.000Z',
		environment: null,
		exitCode: status === 'success' ? 0 : null,
		...(status === 'success'
			? {}
			: {
					failure: {
						code: 'timeout',
						exitCode: null,
						message: 'timed out',
						signal: null,
					},
				}),
		logs: {
			command: request.command,
			cwd: '/',
			env: {},
			stderr: '',
			stdout,
		},
		signal: null,
		startedAt: '1970-01-01T00:00:00.000Z',
		status,
		stderr: '',
		stderrTruncated: false,
		stdout,
		stdoutTruncated: false,
	};
}

/**
 * Creates a fake command service whose `run` returns the supplied result for
 * every invocation.
 * @param respond - Maps a request to the fake run result.
 * @returns A stubbed {@link LocalCommandService}.
 */
function fakeCommandService(
	respond: (request: LocalCommandRequest) => LocalCommandResult,
): LocalCommandService {
	return {
		getEnvironment: async () => {
			throw new Error('unused');
		},
		run: async (request) => respond(request),
	};
}

const firstBundleTargetId = OPEN_TARGET_REGISTRY.find(
	(definition) =>
		resolvePlatformBehavior(definition, 'darwin')?.detection.kind ===
		'bundleId',
)?.id;

test('a timed-out probe is reported as degraded, not as "app absent"', async (t) => {
	if (process.platform !== 'darwin' || !firstBundleTargetId) {
		t.skip('bundle-id detection only runs on macOS');
		return;
	}

	const result = await detectInstalledTargets({
		localCommandService: fakeCommandService((request) =>
			fakeResult('failure', '', request),
		),
	});

	assert.equal(result.degraded, true);
	assert.equal(result.detected[firstBundleTargetId]?.installed, false);
});

test('a genuinely empty probe is not degraded', async (t) => {
	if (process.platform !== 'darwin' || !firstBundleTargetId) {
		t.skip('bundle-id detection only runs on macOS');
		return;
	}

	const result = await detectInstalledTargets({
		localCommandService: fakeCommandService((request) =>
			fakeResult('success', '', request),
		),
	});

	assert.equal(result.degraded, false);
	assert.equal(result.detected[firstBundleTargetId]?.installed, false);
});

test('a successful probe marks the target installed', async (t) => {
	if (process.platform !== 'darwin' || !firstBundleTargetId) {
		t.skip('bundle-id detection only runs on macOS');
		return;
	}

	const result = await detectInstalledTargets({
		localCommandService: fakeCommandService((request) =>
			fakeResult('success', '/Applications/Example.app\n', request),
		),
	});

	assert.equal(result.degraded, false);
	assert.equal(result.detected[firstBundleTargetId]?.installed, true);
	assert.equal(
		result.detected[firstBundleTargetId]?.appPath,
		'/Applications/Example.app',
	);
});

/**
 * Creates a fake command service whose environment probe returns a fixed
 * snapshot, so a Linux sweep resolves against a temporary tree rather than the
 * host's own PATH and XDG data dirs.
 * @param overrides - Snapshot fields to override on top of a shell-sourced default.
 * @returns A stubbed {@link LocalCommandService}.
 */
function fakeEnvironmentService(
	overrides: Partial<CommandEnvironmentSnapshot>,
): LocalCommandService {
	const snapshot: CommandEnvironmentSnapshot = {
		diagnostics: [],
		env: {},
		path: '',
		resolvedAt: '1970-01-01T00:00:00.000Z',
		shell: '/bin/sh',
		source: 'shell',
		...overrides,
	};
	return {
		getEnvironment: async () => snapshot,
		run: async (request) => fakeResult('success', '', request),
	};
}

const linuxDesktopEntryTargetId = 'dolphin';
const linuxDesktopEntryId = 'org.kde.dolphin';

test('detection resolves .desktop entries against the shell XDG data dirs', async (t) => {
	if (process.platform !== 'linux') {
		t.skip('linux-app detection only runs on Linux');
		return;
	}

	const root = await mkdtemp(path.join(tmpdir(), 'ensemblr-detect-'));
	try {
		const applications = path.join(root, 'share', 'applications');
		await mkdir(applications, { recursive: true });
		await writeFile(
			path.join(applications, `${linuxDesktopEntryId}.desktop`),
			'[Desktop Entry]\nType=Application\n',
			'utf8',
		);

		const result = await detectInstalledTargets({
			localCommandService: fakeEnvironmentService({
				env: { XDG_DATA_DIRS: path.join(root, 'share') },
				path: path.join(root, 'empty'),
			}),
		});

		assert.equal(result.degraded, false);
		assert.equal(result.detected[linuxDesktopEntryTargetId]?.installed, true);
	} finally {
		await rm(root, { recursive: true });
	}
});

// Detection sweeping the launcher's own PATH instead of the login shell's would
// otherwise cache a short list as authoritative, hiding every app under
// `~/.local/bin` on every later boot.
test('a login-shell probe that fell back marks the pass degraded', async (t) => {
	if (process.platform !== 'linux') {
		t.skip('linux-app detection only runs on Linux');
		return;
	}

	const result = await detectInstalledTargets({
		localCommandService: fakeEnvironmentService({
			path: '/usr/bin',
			source: 'fallback',
		}),
	});

	assert.equal(result.degraded, true);
});

test('a healthy login-shell probe is not degraded', async (t) => {
	if (process.platform !== 'linux') {
		t.skip('linux-app detection only runs on Linux');
		return;
	}

	const result = await detectInstalledTargets({
		localCommandService: fakeEnvironmentService({ path: '/usr/bin' }),
	});

	assert.equal(result.degraded, false);
});
