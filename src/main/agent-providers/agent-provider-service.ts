import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentProviderId } from '../../shared/agent-provider';
import { getAgentProviderDescriptor } from '../../shared/agent-provider.ts';
import type {
	AgentExecutablePathSnapshotWire,
	ListAgentProviderMcpServersResult,
} from '../../shared/ipc/contracts/agent-provider';
import type {
	AgentExecutableResolution,
	AgentProviderExecutableService,
	AgentProviderReadinessProbe,
	AgentProviderService,
} from './agent-provider-types.ts';

/** Options for {@link createAgentProviderService}. */
export interface CreateAgentProviderServiceOptions {
	executables: Record<AgentProviderId, AgentProviderExecutableService>;
	homeDirectory?: string;
	/**
	 * Per-runtime MCP roster readers. A runtime with no MCP surface is simply
	 * absent, and its roster reads as empty rather than as an error.
	 */
	mcpRosters?: Partial<
		Record<
			AgentProviderId,
			(cwd: string) => Promise<ListAgentProviderMcpServersResult>
		>
	>;
	probes: Record<AgentProviderId, AgentProviderReadinessProbe>;
}

/**
 * Builds the service behind the six provider-parameterized IPC channels. Every
 * runtime is registered in the same two maps, so adding a third provider means
 * adding an executable service and a probe — never a branch in this module.
 * @param options - Per-provider executable services and readiness probes.
 * @returns An {@link AgentProviderService}.
 */
export function createAgentProviderService({
	executables,
	homeDirectory = homedir(),
	mcpRosters = {},
	probes,
}: CreateAgentProviderServiceOptions): AgentProviderService {
	const readSnapshot = async (
		provider: AgentProviderId,
		error: string | null,
	): Promise<AgentExecutablePathSnapshotWire> =>
		toPathSnapshot(provider, await executables[provider].getSnapshot(), error);

	return {
		clearExecutablePath: (provider) =>
			readSnapshot(
				provider,
				executables[provider].clearOverride().error ?? null,
			),
		getExecutablePath: (provider) => readSnapshot(provider, null),
		getReadiness: (provider) => probes[provider].probe(),
		listMcpServers: async (provider, cwd) =>
			(await mcpRosters[provider]?.(cwd)) ?? { error: null, servers: [] },
		resolveSettingsFilePath: (provider) => {
			const { settingsFile } = getAgentProviderDescriptor(provider);

			return settingsFile
				? path.resolve(homeDirectory, settingsFile.replace(/^~\/?/, ''))
				: null;
		},
		saveExecutablePath: (provider, executablePath) =>
			readSnapshot(
				provider,
				executables[provider].saveOverride(executablePath).error ?? null,
			),
		selectExecutable: (provider, executablePath) =>
			executables[provider].saveOverride(executablePath),
	};
}

/**
 * Projects a resolved executable onto the wire snapshot. `overridePath` is
 * filled only from the user's own SQLite setting so the override field never
 * shows a PATH- or config-derived value as if the user had typed it.
 * @param provider - Runtime the snapshot describes.
 * @param resolution - Resolved executable.
 * @param error - Message from the write that produced this read, when any.
 * @returns The IPC-safe path snapshot.
 */
function toPathSnapshot(
	provider: AgentProviderId,
	resolution: AgentExecutableResolution,
	error: string | null,
): AgentExecutablePathSnapshotWire {
	const override =
		resolution.setting?.source === 'sqlite'
			? String(resolution.setting.value ?? '').trim()
			: '';

	return {
		error,
		overridePath: override || null,
		provider,
		resolvedPath: resolution.path || null,
		source: resolution.source,
		status: resolution.status,
	};
}
