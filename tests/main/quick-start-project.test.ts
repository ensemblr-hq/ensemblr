import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { createQuickStartProjectService } from '../../src/main/repository/quick-start-project.ts';
import type { LocalRepositoryRegistrationService } from '../../src/main/repository/register-repository.ts';
import { buildRegistrationStub } from './helpers/registration-stub.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

function createWorkspace(t: TestContext): {
	parentPath: string;
	repositoriesPath: string;
} {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemble-quickstart-'));
	const repositoriesPath = path.join(root, 'repos');
	mkdirSync(repositoriesPath, { recursive: true });

	t.after(() => {
		rmSync(root, { force: true, recursive: true });
	});

	return { parentPath: root, repositoriesPath };
}

const rootDirectoryStub = (repositoriesPath: string) =>
	buildRootDirectoryStub({ repositoriesPath });

function commandServiceStub({
	calls,
	onRun,
}: {
	calls: LocalCommandRequest[];
	onRun: (request: LocalCommandRequest) => LocalCommandResult;
}): LocalCommandService {
	return {
		getEnvironment: async () => ({
			diagnostics: [],
			env: {},
			path: '',
			resolvedAt: fixedNow().toISOString(),
			shell: '/bin/zsh',
			source: 'fallback',
		}),
		run: async (request) => {
			calls.push(request);
			return onRun(request);
		},
	};
}

function gitInitSuccess(request: LocalCommandRequest): LocalCommandResult {
	return {
		args: Array.from(request.args ?? []),
		command: request.command,
		cwd: request.cwd ?? '',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: 0,
		logs: {
			command: 'git init',
			cwd: request.cwd ?? '',
			env: {},
			stderr: '',
			stdout: '',
		},
		signal: null,
		startedAt: fixedNow().toISOString(),
		status: 'success',
		stderr: '',
		stderrTruncated: false,
		stdout: '',
		stdoutTruncated: false,
	};
}

function commandFailure(
	request: LocalCommandRequest,
	failureCode: 'command-not-found' | 'nonzero-exit',
	stderr: string,
): LocalCommandResult {
	return {
		args: Array.from(request.args ?? []),
		command: request.command,
		cwd: request.cwd ?? '',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: failureCode === 'nonzero-exit' ? 128 : null,
		failure: {
			code: failureCode,
			exitCode: failureCode === 'nonzero-exit' ? 128 : null,
			message: failureCode,
			signal: null,
		},
		logs: {
			command: 'git init',
			cwd: request.cwd ?? '',
			env: {},
			stderr,
			stdout: '',
		},
		signal: null,
		startedAt: fixedNow().toISOString(),
		status: 'failure',
		stderr,
		stderrTruncated: false,
		stdout: '',
		stdoutTruncated: false,
	};
}

const registrationStub = (targetPath: string) =>
	buildRegistrationStub(targetPath);

function failingRegistrationStub(): LocalRepositoryRegistrationService {
	return {
		register: async () => ({
			diagnostics: [
				{
					code: 'path-not-a-git-repository',
					message: 'not a repo',
					severity: 'error',
				},
			],
			registered: false,
			repository: null,
			settingsSources: [],
		}),
	};
}

test('create scaffolds a folder, runs git init, and registers the repo', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const registration = registrationStub(path.join(repositoriesPath, 'my-app'));
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({
			calls,
			onRun: gitInitSuccess,
		}),
		registrationService: registration.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });

	assert.equal(result.status, 'success');
	assert.equal(result.repository?.name, 'my-app');
	assert.equal(result.targetPath, path.join(repositoriesPath, 'my-app'));
	assert.equal(existsSync(path.join(repositoriesPath, 'my-app')), true);
	assert.deepEqual(result.diagnostics, []);
	assert.equal(
		existsSync(path.join(repositoriesPath, 'my-app', '.gitkeep')),
		true,
	);
	assert.equal(calls.length, 4);
	assert.equal(calls[0]?.command, 'git');
	assert.deepEqual(Array.from(calls[0]?.args ?? []), ['init']);
	assert.equal(calls[1]?.command, 'git');
	assert.deepEqual(Array.from(calls[1]?.args ?? []), ['add', '.gitkeep']);
	assert.equal(calls[2]?.command, 'git');
	assert.deepEqual(Array.from(calls[2]?.args ?? []).slice(-3), [
		'commit',
		'-m',
		'Initial commit',
	]);
	assert.equal(calls[3]?.command, 'gh');
	assert.deepEqual(Array.from(calls[3]?.args ?? []), [
		'repo',
		'create',
		'my-app',
		'--private',
		'--source',
		path.join(repositoriesPath, 'my-app'),
		'--remote',
		'origin',
		'--push',
	]);
	assert.equal(
		registration.calls[0]?.path,
		path.join(repositoriesPath, 'my-app'),
	);
});

test('create keeps the project and warns when publishing to GitHub fails', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const registration = registrationStub(path.join(repositoriesPath, 'my-app'));
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({
			calls,
			onRun: (request) =>
				request.command === 'gh'
					? commandFailure(
							request,
							'nonzero-exit',
							'GraphQL: Name already exists on this account',
						)
					: gitInitSuccess(request),
		}),
		registrationService: registration.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });

	assert.equal(result.status, 'success');
	assert.equal(result.repository?.name, 'my-app');
	assert.equal(result.diagnostics.length, 1);
	assert.equal(result.diagnostics[0]?.code, 'publish-failed');
	assert.equal(result.diagnostics[0]?.severity, 'warning');
	// Best-effort publish: a usable local repo must survive a GitHub failure.
	assert.equal(existsSync(path.join(repositoriesPath, 'my-app')), true);
});

test('create warns but still creates the project when gh is not installed', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const registration = registrationStub(path.join(repositoriesPath, 'my-app'));
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({
			calls,
			onRun: (request) =>
				request.command === 'gh'
					? commandFailure(request, 'command-not-found', 'gh: not found')
					: gitInitSuccess(request),
		}),
		registrationService: registration.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });

	assert.equal(result.status, 'success');
	assert.equal(result.diagnostics[0]?.code, 'publish-failed');
	assert.equal(result.diagnostics[0]?.severity, 'warning');
	assert.match(result.diagnostics[0]?.message ?? '', /GitHub CLI/);
	assert.equal(existsSync(path.join(repositoriesPath, 'my-app')), true);
});

test('create rejects invalid project names', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({ calls, onRun: gitInitSuccess }),
		registrationService: registrationStub(repositoriesPath).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const empty = await service.create({ name: '   ' });
	assert.equal(empty.status, 'failure');
	assert.equal(empty.diagnostics[0]?.code, 'name-required');

	const slashed = await service.create({ name: 'foo/bar' });
	assert.equal(slashed.status, 'failure');
	assert.equal(slashed.diagnostics[0]?.code, 'name-invalid');

	const dotted = await service.create({ name: '.hidden' });
	assert.equal(dotted.status, 'failure');
	assert.equal(dotted.diagnostics[0]?.code, 'name-invalid');

	assert.equal(calls.length, 0);
});

test('create auto-suffixes the target folder when the original name is already on disk', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const existing = path.join(repositoriesPath, 'my-app');
	mkdirSync(existing);

	const calls: LocalCommandRequest[] = [];
	const suffixed = path.join(repositoriesPath, 'my-app-2');
	const registration = registrationStub(suffixed);
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({ calls, onRun: gitInitSuccess }),
		registrationService: registration.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });
	assert.equal(result.status, 'success');
	assert.equal(result.targetPath, suffixed);
	assert.equal(existsSync(suffixed), true);
	// Folder, GitHub repo, and registered name must all agree on the suffix.
	assert.equal(registration.calls[0]?.name, 'my-app-2');
	const ghCall = calls.find((call) => call.command === 'gh');
	assert.deepEqual(Array.from(ghCall?.args ?? []).slice(0, 3), [
		'repo',
		'create',
		'my-app-2',
	]);
});

test('create rolls back the directory when git init fails', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({
			calls,
			onRun: (request) =>
				commandFailure(request, 'nonzero-exit', 'fatal: boom'),
		}),
		registrationService: registrationStub(path.join(repositoriesPath, 'my-app'))
			.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'git-init-failed');
	assert.equal(existsSync(path.join(repositoriesPath, 'my-app')), false);
});

test('create reports git-not-installed when git is missing', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({
			calls,
			onRun: (request) =>
				commandFailure(request, 'command-not-found', 'no git'),
		}),
		registrationService: registrationStub(path.join(repositoriesPath, 'my-app'))
			.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'git-not-installed');
	assert.equal(existsSync(path.join(repositoriesPath, 'my-app')), false);
});

test('create rolls back the directory when registration fails', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const calls: LocalCommandRequest[] = [];
	const service = createQuickStartProjectService({
		localCommandService: commandServiceStub({ calls, onRun: gitInitSuccess }),
		registrationService: failingRegistrationStub(),
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.create({ name: 'my-app' });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'register-failed');
	assert.equal(existsSync(path.join(repositoriesPath, 'my-app')), false);
});
