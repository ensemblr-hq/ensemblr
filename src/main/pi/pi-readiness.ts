import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type {
	CommandEnvironmentSnapshot,
	LocalCommandFailureCode,
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import type { EnsembleRootDirectoryService } from '../root/root-directory';
import type {
	PiExecutableService,
	PiExecutableSnapshot,
} from './pi-executable';

export type PiReadinessStatus = 'failure' | 'success';
export type PiReadinessDiagnosticSeverity = 'error' | 'info' | 'warning';
export type PiAgentDirectorySource = 'default' | 'environment';
export type PiRpcSmokeFailureCode =
	| 'command-not-found'
	| 'executable-not-ready'
	| 'invalid-jsonl'
	| 'no-jsonl'
	| 'nonzero-exit'
	| 'output-truncated'
	| 'smoke-workspace-unavailable'
	| 'spawn-error'
	| 'timeout';
export type PiProviderModelFailureCode =
	| 'command-not-found'
	| 'executable-not-ready'
	| 'no-models'
	| 'nonzero-exit'
	| 'output-truncated'
	| 'timeout';

export interface PiReadinessDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: PiReadinessDiagnosticSeverity;
}

export interface PiAgentDirectorySnapshot {
	diagnostics: PiReadinessDiagnostic[];
	path: string;
	source: PiAgentDirectorySource;
	status: PiReadinessStatus;
}

export interface PiRpcFrameSnapshot {
	type: string;
}

export interface PiRpcSmokeFailure {
	code: PiRpcSmokeFailureCode;
	exitCode: number | null;
	message: string;
	signal: NodeJS.Signals | string | null;
}

export interface PiRpcSmokeLogs {
	command: string;
	cwd: string;
	stderr: string;
	stdout: string;
}

export interface PiRpcSmokeSnapshot {
	args: string[];
	command: string;
	cwd: string;
	durationMs: number;
	endedAt: string;
	failure?: PiRpcSmokeFailure;
	firstFrame?: PiRpcFrameSnapshot;
	logs: PiRpcSmokeLogs;
	signal: NodeJS.Signals | string | null;
	startedAt: string;
	status: PiReadinessStatus;
	stderrTruncated: boolean;
	stdoutTruncated: boolean;
}

export interface PiProviderModelSnapshot {
	command: string;
	failure?: {
		code: PiProviderModelFailureCode;
		message: string;
	};
	modelCount: number;
	providerCount: number;
	result: LocalCommandResult | null;
	status: PiReadinessStatus;
}

export interface PiReadinessSnapshot {
	agentDirectory: PiAgentDirectorySnapshot;
	executable: PiExecutableSnapshot;
	generatedAt: string;
	providerModels: PiProviderModelSnapshot;
	rpc: PiRpcSmokeSnapshot;
}

export interface PiRpcSmokeRunnerRequest {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	killGraceMs: number;
	maxOutputBytes: number;
	now: () => Date;
	timeoutMs: number;
}

export type PiRpcSmokeRunner = (
	request: PiRpcSmokeRunnerRequest,
) => Promise<PiRpcSmokeSnapshot>;

export interface CreatePiReadinessServiceOptions {
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	now?: () => Date;
	piExecutableService: PiExecutableService;
	providerModelTimeoutMs?: number;
	rootDirectoryService: EnsembleRootDirectoryService;
	rpcKillGraceMs?: number;
	rpcMaxOutputBytes?: number;
	rpcRunner?: PiRpcSmokeRunner;
	rpcTimeoutMs?: number;
}

export interface ResolvePiReadinessOptions {
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	now?: () => Date;
	piExecutableService: PiExecutableService;
	providerModelTimeoutMs?: number;
	rootDirectoryService: EnsembleRootDirectoryService;
	rpcKillGraceMs?: number;
	rpcMaxOutputBytes?: number;
	rpcRunner?: PiRpcSmokeRunner;
	rpcTimeoutMs?: number;
}

export interface PiReadinessService {
	getSnapshot: () => Promise<PiReadinessSnapshot>;
}

const DEFAULT_RPC_TIMEOUT_MS = 5000;
const DEFAULT_RPC_KILL_GRACE_MS = 500;
const DEFAULT_PROVIDER_MODEL_TIMEOUT_MS = 10000;
const DEFAULT_RPC_MAX_OUTPUT_BYTES = 64 * 1024;
const PROVIDER_MODEL_MAX_OUTPUT_BYTES = 128 * 1024;
const PI_RPC_ARGS = ['--mode', 'rpc'] as const;
const PI_LIST_MODELS_ARGS = ['--list-models'] as const;
const PI_AGENT_DIRECTORY_ENV_KEY = 'PI_CODING_AGENT_DIR';
const SETUP_SMOKE_WORKSPACE_DIRECTORY = '.setup-smoke';

export function createPiReadinessService({
	homeDirectory,
	localCommandService,
	now,
	piExecutableService,
	providerModelTimeoutMs,
	rootDirectoryService,
	rpcKillGraceMs,
	rpcMaxOutputBytes,
	rpcRunner,
	rpcTimeoutMs,
}: CreatePiReadinessServiceOptions): PiReadinessService {
	let inFlightSnapshot: Promise<PiReadinessSnapshot> | null = null;

	return {
		getSnapshot: () => {
			inFlightSnapshot ??= resolvePiReadiness({
				homeDirectory,
				localCommandService,
				now,
				piExecutableService,
				providerModelTimeoutMs,
				rootDirectoryService,
				rpcKillGraceMs,
				rpcMaxOutputBytes,
				rpcRunner,
				rpcTimeoutMs,
			}).finally(() => {
				inFlightSnapshot = null;
			});

			return inFlightSnapshot;
		},
	};
}

export async function resolvePiReadiness({
	homeDirectory = homedir(),
	localCommandService,
	now = () => new Date(),
	piExecutableService,
	providerModelTimeoutMs = DEFAULT_PROVIDER_MODEL_TIMEOUT_MS,
	rootDirectoryService,
	rpcKillGraceMs = DEFAULT_RPC_KILL_GRACE_MS,
	rpcMaxOutputBytes = DEFAULT_RPC_MAX_OUTPUT_BYTES,
	rpcRunner = runPiRpcSmokeProcess,
	rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
}: ResolvePiReadinessOptions): Promise<PiReadinessSnapshot> {
	const [environment, executable] = await Promise.all([
		localCommandService.getEnvironment(),
		piExecutableService.getSnapshot(),
	]);
	const agentDirectory = resolvePiAgentDirectory({
		environment,
		homeDirectory,
	});
	const smokeWorkspace = ensureSetupSmokeWorkspace(rootDirectoryService);
	const [rpc, providerModels] = await Promise.all([
		resolvePiRpcSmoke({
			environment,
			executable,
			killGraceMs: rpcKillGraceMs,
			maxOutputBytes: rpcMaxOutputBytes,
			now,
			rpcRunner,
			smokeWorkspace,
			timeoutMs: rpcTimeoutMs,
		}),
		resolvePiProviderModels({
			executable,
			localCommandService,
			timeoutMs: providerModelTimeoutMs,
		}),
	]);

	return {
		agentDirectory,
		executable,
		generatedAt: now().toISOString(),
		providerModels,
		rpc,
	};
}

export function resolvePiAgentDirectory({
	environment,
	homeDirectory = homedir(),
}: {
	environment: CommandEnvironmentSnapshot;
	homeDirectory?: string;
}): PiAgentDirectorySnapshot {
	const configuredPath = environment.env[PI_AGENT_DIRECTORY_ENV_KEY]?.trim();
	const source: PiAgentDirectorySource = configuredPath
		? 'environment'
		: 'default';
	const agentDirectoryPath = normalizeConfiguredPath(
		configuredPath || '~/.pi/agent',
		homeDirectory,
	);
	const diagnostics: PiReadinessDiagnostic[] = [];

	try {
		const stats = statSync(agentDirectoryPath);

		if (!stats.isDirectory()) {
			diagnostics.push({
				code: 'pi-agent-directory-not-directory',
				message: 'Pi agent directory path exists but is not a directory.',
				path: agentDirectoryPath,
				severity: 'error',
			});
		}
	} catch {
		diagnostics.push({
			code: 'pi-agent-directory-missing',
			message: 'Pi agent directory does not exist.',
			path: agentDirectoryPath,
			severity: 'error',
		});
	}

	if (diagnostics.length === 0) {
		try {
			accessSync(
				agentDirectoryPath,
				constants.R_OK | constants.W_OK | constants.X_OK,
			);
		} catch (error) {
			diagnostics.push({
				code: 'pi-agent-directory-inaccessible',
				message:
					error instanceof Error
						? error.message
						: 'Pi agent directory is not readable and writable.',
				path: agentDirectoryPath,
				severity: 'error',
			});
		}
	}

	return {
		diagnostics,
		path: agentDirectoryPath,
		source,
		status: diagnostics.some((diagnostic) => diagnostic.severity === 'error')
			? 'failure'
			: 'success',
	};
}

export async function resolvePiRpcSmoke({
	environment,
	executable,
	killGraceMs = DEFAULT_RPC_KILL_GRACE_MS,
	maxOutputBytes = DEFAULT_RPC_MAX_OUTPUT_BYTES,
	now = () => new Date(),
	rpcRunner = runPiRpcSmokeProcess,
	smokeWorkspace,
	timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
}: {
	environment: CommandEnvironmentSnapshot;
	executable: PiExecutableSnapshot;
	killGraceMs?: number;
	maxOutputBytes?: number;
	now?: () => Date;
	rpcRunner?: PiRpcSmokeRunner;
	smokeWorkspace: { error?: string; path: string };
	timeoutMs?: number;
}): Promise<PiRpcSmokeSnapshot> {
	if (!isExecutableReady(executable)) {
		return createFailedRpcSnapshot({
			code: 'executable-not-ready',
			command: executable.command,
			cwd: smokeWorkspace.path,
			message:
				executable.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message ?? 'Pi executable is not ready enough to start RPC mode.',
			now,
		});
	}

	if (smokeWorkspace.error) {
		return createFailedRpcSnapshot({
			code: 'smoke-workspace-unavailable',
			command: executable.command,
			cwd: smokeWorkspace.path,
			message: smokeWorkspace.error,
			now,
		});
	}

	return rpcRunner({
		args: PI_RPC_ARGS,
		command: executable.command,
		cwd: smokeWorkspace.path,
		env: environment.env,
		killGraceMs,
		maxOutputBytes,
		now,
		timeoutMs,
	});
}

export async function resolvePiProviderModels({
	executable,
	localCommandService,
	timeoutMs = DEFAULT_PROVIDER_MODEL_TIMEOUT_MS,
}: {
	executable: PiExecutableSnapshot;
	localCommandService: LocalCommandService;
	timeoutMs?: number;
}): Promise<PiProviderModelSnapshot> {
	if (!isExecutableReady(executable)) {
		return {
			command: executable.command,
			failure: {
				code: 'executable-not-ready',
				message:
					executable.diagnostics.find(
						(diagnostic) => diagnostic.severity === 'error',
					)?.message ??
					'Pi executable is not ready enough to list provider models.',
			},
			modelCount: 0,
			providerCount: 0,
			result: null,
			status: 'failure',
		};
	}

	const result = await localCommandService.run({
		args: PI_LIST_MODELS_ARGS,
		command: executable.command,
		maxOutputBytes: PROVIDER_MODEL_MAX_OUTPUT_BYTES,
		timeoutMs,
	});

	if (result.status !== 'success') {
		return {
			command: executable.command,
			failure: {
				code: mapProviderModelFailureCode(result.failure?.code),
				message: getProviderModelFailureMessage(result),
			},
			modelCount: 0,
			providerCount: 0,
			result,
			status: 'failure',
		};
	}

	const modelSummary = parsePiListModelsOutput(result.stdout);

	if (modelSummary.modelCount === 0) {
		return {
			command: executable.command,
			failure: {
				code: 'no-models',
				message:
					'Pi listed zero usable provider models. Configure at least one provider or model, then retry.',
			},
			modelCount: 0,
			providerCount: 0,
			result,
			status: 'failure',
		};
	}

	return {
		command: executable.command,
		modelCount: modelSummary.modelCount,
		providerCount: modelSummary.providerCount,
		result,
		status: 'success',
	};
}

export function parsePiListModelsOutput(output: string): {
	modelCount: number;
	providerCount: number;
} {
	const providers = new Set<string>();
	let modelCount = 0;

	for (const line of output.split(/\r?\n/)) {
		const trimmedLine = line.trim();

		if (!trimmedLine || /^provider\s+model\b/i.test(trimmedLine)) {
			continue;
		}

		const columns = trimmedLine.split(/\s{2,}/).filter(Boolean);

		if (columns.length < 2) {
			continue;
		}

		providers.add(columns[0]);
		modelCount += 1;
	}

	return {
		modelCount,
		providerCount: providers.size,
	};
}

export function runPiRpcSmokeProcess({
	args,
	command,
	cwd,
	env,
	killGraceMs,
	maxOutputBytes,
	now,
	timeoutMs,
}: PiRpcSmokeRunnerRequest): Promise<PiRpcSmokeSnapshot> {
	const startedAt = now().toISOString();
	const startedMs = performance.now();

	return new Promise((resolve) => {
		const shouldDetachChild = process.platform !== 'win32';
		const child = spawn(command, Array.from(args), {
			cwd,
			detached: shouldDetachChild,
			env,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let endedAt = startedAt;
		let exitCode: number | null = null;
		let failure: PiRpcSmokeFailure | undefined;
		let firstFrame: PiRpcFrameSnapshot | undefined;
		let settled = false;
		let signalCode: NodeJS.Signals | string | null = null;
		let stderr = '';
		let stderrTruncated = false;
		let stdout = '';
		let stdoutBuffer = '';
		let stdoutTruncated = false;
		let killTimer: NodeJS.Timeout | null = null;
		const timeoutTimer = setTimeout(() => {
			failure ??= createRpcFailure({
				code: 'timeout',
				exitCode,
				message: 'Pi RPC startup timed out before producing valid JSONL.',
				signal: signalCode,
			});
			terminateChild();
		}, timeoutMs);

		function terminateChild(): void {
			if (killTimer || !isChildRunning()) {
				return;
			}

			signalChild('SIGTERM');
			killTimer = setTimeout(() => {
				if (isChildRunning()) {
					signalChild('SIGKILL');
				}
			}, killGraceMs);
		}

		function isChildRunning(): boolean {
			return !settled && child.exitCode === null;
		}

		function signalChild(signal: NodeJS.Signals): void {
			if (shouldDetachChild && child.pid) {
				try {
					process.kill(-child.pid, signal);
				} catch {
					// Fall back to terminating the direct child below.
				}
			}

			try {
				child.kill(signal);
			} catch {
				// The process may already have exited after the process-group signal.
			}
		}

		function settle(): void {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeoutTimer);
			if (killTimer) {
				clearTimeout(killTimer);
			}
			endedAt = now().toISOString();

			if (!firstFrame && !failure) {
				failure = createRpcFailure({
					code: exitCode && exitCode !== 0 ? 'nonzero-exit' : 'no-jsonl',
					exitCode,
					message:
						exitCode && exitCode !== 0
							? `Pi RPC process exited with code ${String(exitCode)} before producing valid JSONL.`
							: 'Pi RPC process ended before producing valid JSONL.',
					signal: signalCode,
				});
			}

			resolve({
				args: Array.from(args),
				command,
				cwd,
				durationMs: performance.now() - startedMs,
				endedAt,
				failure,
				firstFrame,
				logs: {
					command: [command, ...args].join(' '),
					cwd,
					stderr,
					stdout,
				},
				signal: signalCode,
				startedAt,
				status: firstFrame ? 'success' : 'failure',
				stderrTruncated,
				stdoutTruncated,
			});
		}

		function captureOutput(stream: 'stderr' | 'stdout', chunk: Buffer): void {
			const text = chunk.toString('utf8');
			const current = stream === 'stdout' ? stdout : stderr;
			const remainingBytes =
				maxOutputBytes - Buffer.byteLength(current, 'utf8');

			if (remainingBytes <= 0) {
				if (stream === 'stdout') {
					stdoutTruncated = true;
				} else {
					stderrTruncated = true;
				}

				failure ??= createRpcFailure({
					code: 'output-truncated',
					exitCode,
					message: 'Pi RPC startup produced too much output.',
					signal: signalCode,
				});
				terminateChild();
				return;
			}

			const nextText =
				Buffer.byteLength(text, 'utf8') > remainingBytes
					? Buffer.from(text).subarray(0, remainingBytes).toString('utf8')
					: text;

			if (stream === 'stdout') {
				stdout += nextText;
				stdoutTruncated ||= nextText.length !== text.length;
				stdoutBuffer += nextText;
				inspectRpcStdoutLines();
			} else {
				stderr += nextText;
				stderrTruncated ||= nextText.length !== text.length;
			}

			if (nextText.length !== text.length) {
				failure ??= createRpcFailure({
					code: 'output-truncated',
					exitCode,
					message: 'Pi RPC startup produced too much output.',
					signal: signalCode,
				});
				terminateChild();
			}
		}

		function inspectRpcStdoutLines(): void {
			while (stdoutBuffer.includes('\n')) {
				const separatorIndex = stdoutBuffer.indexOf('\n');
				const line = stdoutBuffer.slice(0, separatorIndex).trim();
				stdoutBuffer = stdoutBuffer.slice(separatorIndex + 1);

				if (!line) {
					continue;
				}

				const frame = parseRpcFrame(line);

				if (!frame) {
					failure = createRpcFailure({
						code: 'invalid-jsonl',
						exitCode,
						message: 'Pi RPC stdout produced a non-JSONL startup line.',
						signal: signalCode,
					});
					terminateChild();
					return;
				}

				firstFrame = frame;
				terminateChild();
				return;
			}
		}

		child.stdout?.on('data', (chunk: Buffer) => captureOutput('stdout', chunk));
		child.stderr?.on('data', (chunk: Buffer) => captureOutput('stderr', chunk));
		child.on('error', (error) => {
			const code =
				getNodeErrorCode(error) === 'ENOENT'
					? 'command-not-found'
					: 'spawn-error';
			failure = createRpcFailure({
				code,
				exitCode,
				message:
					code === 'command-not-found'
						? `Command not found: ${command}.`
						: `Failed to start Pi RPC process: ${error.message}`,
				signal: signalCode,
			});
		});
		child.on('close', (closedExitCode, closedSignal) => {
			exitCode = closedExitCode;
			signalCode = closedSignal;
			settle();
		});
	});
}

function ensureSetupSmokeWorkspace(
	rootDirectoryService: EnsembleRootDirectoryService,
): { error?: string; path: string } {
	const rootSnapshot =
		rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	const smokeWorkspacePath = rootSnapshot.workspacesPath
		? path.join(rootSnapshot.workspacesPath, SETUP_SMOKE_WORKSPACE_DIRECTORY)
		: '';

	if (rootSnapshot.status === 'error') {
		return {
			error:
				rootSnapshot.diagnostics[0]?.message ??
				'Ensemble root is not ready enough to create a Pi RPC smoke workspace.',
			path: smokeWorkspacePath,
		};
	}

	if (!smokeWorkspacePath) {
		return {
			error: 'Ensemble workspaces path is unavailable for Pi RPC smoke checks.',
			path: smokeWorkspacePath,
		};
	}

	try {
		mkdirSync(smokeWorkspacePath, { recursive: true });
		return { path: smokeWorkspacePath };
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: 'Failed to create Pi RPC smoke workspace.',
			path: smokeWorkspacePath,
		};
	}
}

function createFailedRpcSnapshot({
	code,
	command,
	cwd,
	message,
	now,
}: {
	code: PiRpcSmokeFailureCode;
	command: string;
	cwd: string;
	message: string;
	now: () => Date;
}): PiRpcSmokeSnapshot {
	const timestamp = now().toISOString();

	return {
		args: Array.from(PI_RPC_ARGS),
		command,
		cwd,
		durationMs: 0,
		endedAt: timestamp,
		failure: createRpcFailure({
			code,
			exitCode: null,
			message,
			signal: null,
		}),
		logs: {
			command: command ? [command, ...PI_RPC_ARGS].join(' ') : '',
			cwd,
			stderr: '',
			stdout: '',
		},
		signal: null,
		startedAt: timestamp,
		status: 'failure',
		stderrTruncated: false,
		stdoutTruncated: false,
	};
}

function createRpcFailure({
	code,
	exitCode,
	message,
	signal,
}: {
	code: PiRpcSmokeFailureCode;
	exitCode: number | null;
	message: string;
	signal: NodeJS.Signals | string | null;
}): PiRpcSmokeFailure {
	return {
		code,
		exitCode,
		message,
		signal,
	};
}

function getProviderModelFailureMessage(result: LocalCommandResult): string {
	switch (result.failure?.code) {
		case 'command-not-found':
			return 'Pi executable was not found while listing provider models.';
		case 'timeout':
			return 'Pi provider/model listing timed out.';
		case 'output-truncated':
			return 'Pi provider/model listing produced too much output.';
		default:
			return `Pi provider/model listing failed: ${
				result.failure?.message ?? 'Unknown command failure.'
			}`;
	}
}

function mapProviderModelFailureCode(
	code: LocalCommandFailureCode | undefined,
): PiProviderModelFailureCode {
	switch (code) {
		case 'command-not-found':
			return 'command-not-found';
		case 'timeout':
			return 'timeout';
		case 'output-truncated':
			return 'output-truncated';
		default:
			return 'nonzero-exit';
	}
}

function isExecutableReady(executable: PiExecutableSnapshot): boolean {
	return Boolean(executable.command) && executable.status !== 'error';
}

function parseRpcFrame(line: string): PiRpcFrameSnapshot | null {
	try {
		const parsed = JSON.parse(line) as unknown;

		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'type' in parsed &&
			typeof parsed.type === 'string'
		) {
			return { type: parsed.type };
		}
	} catch {
		return null;
	}

	return null;
}

function normalizeConfiguredPath(
	rawPath: string,
	homeDirectory: string,
): string {
	if (rawPath === '~') {
		return path.resolve(homeDirectory);
	}

	if (rawPath.startsWith('~/')) {
		return path.resolve(homeDirectory, rawPath.slice(2));
	}

	return path.resolve(rawPath);
}

function getNodeErrorCode(error: Error): string | null {
	return 'code' in error && typeof error.code === 'string' ? error.code : null;
}
