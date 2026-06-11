import { homedir } from 'node:os';

import { resolvePiAgentDirectory } from './pi-agent-directory-resolver.ts';
import { resolvePiProviderModels } from './pi-provider-models.ts';
import {
	ensureSetupSmokeWorkspace,
	resolvePiRpcSmoke,
	runPiRpcSmokeProcess,
} from './pi-rpc-smoke.ts';
import type {
	CreatePiReadinessServiceOptions,
	PiReadinessService,
	PiReadinessSnapshot,
	ResolvePiReadinessOptions,
} from './pi-runtime-types.ts';

export type {
	CreatePiReadinessServiceOptions,
	PiAgentDirectorySnapshot,
	PiAgentDirectorySource,
	PiModelOption,
	PiProviderModelFailureCode,
	PiProviderModelSnapshot,
	PiReadinessDiagnostic,
	PiReadinessDiagnosticSeverity,
	PiReadinessService,
	PiReadinessSnapshot,
	PiReadinessStatus,
	PiRpcFrameSnapshot,
	PiRpcSmokeFailure,
	PiRpcSmokeFailureCode,
	PiRpcSmokeLogs,
	PiRpcSmokeRunner,
	PiRpcSmokeRunnerRequest,
	PiRpcSmokeSnapshot,
	ResolvePiReadinessOptions,
} from './pi-runtime-types.ts';

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
export { resolvePiRpcSmoke, runPiRpcSmokeProcess } from './pi-rpc-smoke.ts';
