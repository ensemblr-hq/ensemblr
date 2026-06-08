import { homedir } from 'node:os';

import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import type { EnsembleRootDirectoryService } from '../root/root-directory-service';
import { resolvePiAgentDirectory } from './pi-agent-directory-resolver.ts';
import type {
	PiExecutableService,
	PiExecutableSnapshot,
} from './pi-executable';
import { resolvePiProviderModels } from './pi-provider-models.ts';
import {
	ensureSetupSmokeWorkspace,
	resolvePiRpcSmoke,
	runPiRpcSmokeProcess,
} from './pi-rpc-smoke.ts';

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

/** One advisory diagnostic emitted while assessing Pi readiness. */
export interface PiReadinessDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: PiReadinessDiagnosticSeverity;
}

/** Snapshot of the Pi agent directory's location and accessibility. */
export interface PiAgentDirectorySnapshot {
	diagnostics: PiReadinessDiagnostic[];
	path: string;
	source: PiAgentDirectorySource;
	status: PiReadinessStatus;
}

/** Parsed JSONL startup frame emitted by `pi --mode rpc`. */
export interface PiRpcFrameSnapshot {
	type: string;
}

/** Failure metadata for the Pi RPC smoke check. */
export interface PiRpcSmokeFailure {
	code: PiRpcSmokeFailureCode;
	exitCode: number | null;
	message: string;
	signal: NodeJS.Signals | string | null;
}

/** Captured command and logs for the Pi RPC smoke check. */
export interface PiRpcSmokeLogs {
	command: string;
	cwd: string;
	stderr: string;
	stdout: string;
}

/** Result of the `pi --mode rpc` startup smoke check. */
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

/** A single provider/model row parsed from `pi --list-models`. */
export interface PiModelOption {
	id: string;
	model: string;
	provider: string;
}

/** Result of the `pi --list-models` provider/model readiness check. */
export interface PiProviderModelSnapshot {
	command: string;
	failure?: {
		code: PiProviderModelFailureCode;
		message: string;
	};
	modelCount: number;
	models: readonly PiModelOption[];
	providerCount: number;
	result: LocalCommandResult | null;
	status: PiReadinessStatus;
}

/** Aggregate Pi readiness snapshot returned by {@link PiReadinessService}. */
export interface PiReadinessSnapshot {
	agentDirectory: PiAgentDirectorySnapshot;
	executable: PiExecutableSnapshot;
	generatedAt: string;
	providerModels: PiProviderModelSnapshot;
	rpc: PiRpcSmokeSnapshot;
}

/** Request payload for a {@link PiRpcSmokeRunner}. */
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

/** Pluggable hook that runs the Pi RPC smoke check. */
export type PiRpcSmokeRunner = (
	request: PiRpcSmokeRunnerRequest,
) => Promise<PiRpcSmokeSnapshot>;

/** Options for {@link createPiReadinessService}. */
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

/** Options for {@link resolvePiReadiness}. */
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

/** Public surface of the Pi readiness service. */
export interface PiReadinessService {
	getSnapshot: () => Promise<PiReadinessSnapshot>;
}

const DEFAULT_RPC_TIMEOUT_MS = 5000;
const DEFAULT_RPC_KILL_GRACE_MS = 500;
const DEFAULT_PROVIDER_MODEL_TIMEOUT_MS = 10000;
const DEFAULT_RPC_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Builds the Pi readiness service that aggregates agent-directory, RPC smoke,
 * and provider/model checks, deduplicating concurrent snapshot requests.
 * @param options - Service dependencies and tuning.
 * @returns A {@link PiReadinessService}.
 */
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

/**
 * Resolves every readiness check in parallel and assembles a single snapshot.
 * @param options - Service dependencies and tuning.
 * @returns A {@link PiReadinessSnapshot}.
 */
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

export { resolvePiAgentDirectory } from './pi-agent-directory-resolver.ts';
export {
	parsePiListModelsOutput,
	resolvePiProviderModels,
} from './pi-provider-models.ts';
export {
	resolvePiRpcSmoke,
	runPiRpcSmokeProcess,
} from './pi-rpc-smoke.ts';
