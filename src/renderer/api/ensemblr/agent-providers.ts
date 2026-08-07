import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { AgentProviderId } from '@/shared/agent-provider';
import { IPC_CHANNELS } from '@/shared/ipc/channels';
import type {
	AgentExecutablePathSnapshotWire,
	AgentExecutableSelectionWire,
	OpenAgentProviderSettingsFileResult,
} from '@/shared/ipc/contracts/agent-provider';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for one agent runtime's readiness snapshot. Probing starts a
 * child process, so the result is treated as fresh for a minute and refreshed
 * explicitly by the Providers page's Refresh button.
 * @param provider - Agent runtime to probe.
 * @returns Query options for the readiness snapshot.
 */
export function agentProviderReadinessQuery(provider: AgentProviderId) {
	return queryOptions({
		queryFn: () =>
			profileElectronIpcCall(
				{
					channel: IPC_CHANNELS.getAgentProviderReadiness,
					usesDatabase: true,
				},
				() => getEnsemblrApi().getAgentProviderReadiness({ provider }),
			),
		queryKey: ensemblrQueryKeys.agentProviderReadiness(provider),
		staleTime: 60_000,
	});
}

/**
 * Query options for one agent runtime's MCP roster, resolved inside a workspace
 * so project- and local-scope servers are included. Reading it starts a child
 * process and waits for the servers to finish connecting, so the roster is held
 * fresh for a minute and refreshed explicitly from the panel's Refresh control.
 * @param provider - Agent runtime to ask.
 * @param cwd - Workspace directory the roster resolves against.
 * @returns Query options for the roster.
 */
export function agentProviderMcpServersQuery(
	provider: AgentProviderId,
	cwd: string,
) {
	return queryOptions({
		queryFn: () =>
			profileElectronIpcCall(
				{
					channel: IPC_CHANNELS.listAgentProviderMcpServers,
					usesDatabase: false,
				},
				() => getEnsemblrApi().listAgentProviderMcpServers({ cwd, provider }),
			),
		queryKey: ensemblrQueryKeys.agentProviderMcpServers(provider, cwd),
		staleTime: 60_000,
	});
}

/**
 * Query options for one agent runtime's executable override snapshot.
 * @param provider - Agent runtime whose executable to read.
 * @returns Query options for the executable path snapshot.
 */
export function agentProviderExecutablePathQuery(provider: AgentProviderId) {
	return queryOptions({
		queryFn: () =>
			profileElectronIpcCall(
				{
					channel: IPC_CHANNELS.getAgentProviderExecutablePath,
					usesDatabase: true,
				},
				() => getEnsemblrApi().getAgentProviderExecutablePath({ provider }),
			),
		queryKey: ensemblrQueryKeys.agentProviderExecutablePath(provider),
	});
}

/**
 * Persists an explicit executable override for one agent runtime.
 * @param provider - Agent runtime to configure.
 * @param path - Absolute path, `~`-relative path, or bare command name.
 * @returns The re-resolved executable snapshot, carrying any write error.
 */
export function setAgentProviderExecutablePath(
	provider: AgentProviderId,
	path: string,
): Promise<AgentExecutablePathSnapshotWire> {
	return getEnsemblrApi().setAgentProviderExecutablePath({ path, provider });
}

/**
 * Removes an agent runtime's executable override so discovery falls back to
 * whatever the runtime's command resolves to on PATH.
 * @param provider - Agent runtime to reset.
 * @returns The re-resolved executable snapshot, carrying any write error.
 */
export function clearAgentProviderExecutablePath(
	provider: AgentProviderId,
): Promise<AgentExecutablePathSnapshotWire> {
	return getEnsemblrApi().clearAgentProviderExecutablePath({ provider });
}

/**
 * Opens the native file picker for an agent runtime's executable and saves the
 * selection.
 * @param provider - Agent runtime to configure.
 * @returns The selection outcome; `canceled` when the user dismissed the picker.
 */
export function selectAgentProviderExecutable(
	provider: AgentProviderId,
): Promise<AgentExecutableSelectionWire> {
	return getEnsemblrApi().selectAgentProviderExecutable({ provider });
}

/**
 * Opens an agent runtime's own settings file in a detected "Open in" target,
 * creating the file when it does not exist yet.
 * @param provider - Agent runtime whose settings file to open.
 * @param target - Id of a target from `listWorkspaceOpenTargets`.
 * @returns Whether the file was opened, with an error message when it was not.
 */
export function openAgentProviderSettingsFile(
	provider: AgentProviderId,
	target: string,
): Promise<OpenAgentProviderSettingsFileResult> {
	return getEnsemblrApi().openAgentProviderSettingsFile({ provider, target });
}
