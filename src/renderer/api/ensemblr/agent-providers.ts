import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { AgentProviderId } from '@/shared/agent-provider';
import { IPC_CHANNELS } from '@/shared/ipc/channels';
import type {
	AgentExecutablePathSnapshotWire,
	AgentExecutableSelectionWire,
	ListAgentProviderSlashCommandsResult,
	OpenAgentProviderSettingsFileResult,
} from '@/shared/ipc/contracts/agent-provider';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';
import {
	clearCachedSlashCommands,
	readCachedSlashCommands,
	writeCachedSlashCommands,
} from './slash-commands-cache';

/**
 * Shapes a cached catalogue as a live runtime result, so a seeded menu is
 * indistinguishable from a freshly discovered one downstream.
 * @param provider - Agent runtime whose catalogue to read.
 * @param cwd - Workspace directory the catalogue was resolved against.
 * @returns The cached catalogue as a result, or undefined when none is usable.
 */
function seedSlashCommandsFromCache(
	provider: AgentProviderId,
	cwd: string,
): ListAgentProviderSlashCommandsResult | undefined {
	const cached = readCachedSlashCommands(provider, cwd);
	if (!cached) {
		return undefined;
	}
	return { commands: cached.commands, error: null, source: 'runtime' };
}

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
 * Query options for one agent runtime's slash commands, resolved inside a
 * workspace so project-scoped skills, prompts, and commands are included.
 * Discovery starts a child process, so the catalogue is held fresh for five
 * minutes — long enough that opening the slash menu never pays for a probe.
 *
 * Seeds from the localStorage cache so a workspace opened before paints its menu
 * instantly on launch, then revalidates only once the seed is genuinely older
 * than `staleTime`: reporting the cache's real fetch time through
 * `initialDataUpdatedAt` is what stops every launch from spawning a `claude`
 * child immediately.
 * @param provider - Agent runtime whose commands the composer offers.
 * @param cwd - Workspace directory the commands resolve against.
 * @returns Query options for the slash command catalogue.
 */
export function agentProviderSlashCommandsQuery(
	provider: AgentProviderId,
	cwd: string,
) {
	return queryOptions({
		enabled: cwd.length > 0,
		/**
		 * Seeds the menu from the localStorage cache for an instant first paint.
		 * Must stay a function: these options are rebuilt on every composer render,
		 * so the value form would read and parse the cache on every keystroke.
		 */
		initialData: () => seedSlashCommandsFromCache(provider, cwd),
		/** Reports when the seed was actually discovered, so `staleTime` applies to it. */
		initialDataUpdatedAt: () =>
			readCachedSlashCommands(provider, cwd)?.fetchedAt,
		/**
		 * Fetches the live catalogue over IPC. A runtime answer is persisted, and a
		 * runtime answer of zero commands clears the entry — the user deleted their
		 * skills, and falling back would resurrect them forever. Only a result the
		 * runtime could not actually produce falls back to the cache, and it keeps
		 * that result's `error` so filling the menu from the cache never reads as a
		 * discovery that succeeded.
		 */
		queryFn: async (): Promise<ListAgentProviderSlashCommandsResult> => {
			const result = await profileElectronIpcCall(
				{
					channel: IPC_CHANNELS.listAgentProviderSlashCommands,
					usesDatabase: false,
				},
				() =>
					getEnsemblrApi().listAgentProviderSlashCommands({ cwd, provider }),
			);
			if (result.source !== 'runtime' || result.error !== null) {
				const seeded = seedSlashCommandsFromCache(provider, cwd);
				return seeded ? { ...seeded, error: result.error } : result;
			}
			if (result.commands.length === 0) {
				clearCachedSlashCommands(provider, cwd);
				return result;
			}
			writeCachedSlashCommands(provider, cwd, result.commands, Date.now());
			return result;
		},
		queryKey: ensemblrQueryKeys.agentProviderSlashCommands(provider, cwd),
		staleTime: 5 * 60_000,
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
