import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { ipcMain } from 'electron';

import { getAgentProviderDescriptor } from '../../../shared/agent-provider.ts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	AgentExecutablePathSnapshotWire,
	AgentExecutableSelectionWire,
	AgentProviderReadinessWire,
	OpenAgentProviderSettingsFileResult,
} from '../../../shared/ipc/contracts/agent-provider';
import type { AgentProviderService } from '../../agent-providers';
import type { OpenTargetService } from '../../open-target';
import {
	agentProviderRequestSchema,
	openAgentProviderSettingsFileRequestSchema,
	setAgentProviderExecutablePathRequestSchema,
} from '../request-schemas.ts';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Seed written when a runtime's settings file does not exist yet. */
const EMPTY_SETTINGS_FILE_CONTENT = '{}\n';

/**
 * Registers the provider-parameterized IPC handlers backing Settings →
 * Providers: readiness probing, executable overrides, and opening a runtime's
 * own settings file. Every channel validates its `provider` against the shared
 * registry first — an unknown id is rejected, never coerced to a default.
 * @param options - The provider service and the "Open in" target registry.
 */
export function registerAgentProviderHandlers({
	agentProviderService,
	openTargetService,
}: {
	agentProviderService: AgentProviderService;
	openTargetService: OpenTargetService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.getAgentProviderReadiness,
		async (_event, request: unknown): Promise<AgentProviderReadinessWire> => {
			const { provider } = agentProviderRequestSchema.parse(request);

			return agentProviderService.getReadiness(provider);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.getAgentProviderExecutablePath,
		async (
			_event,
			request: unknown,
		): Promise<AgentExecutablePathSnapshotWire> => {
			const { provider } = agentProviderRequestSchema.parse(request);

			return agentProviderService.getExecutablePath(provider);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.setAgentProviderExecutablePath,
		async (
			_event,
			request: unknown,
		): Promise<AgentExecutablePathSnapshotWire> => {
			const { path, provider } =
				setAgentProviderExecutablePathRequestSchema.parse(request);

			return agentProviderService.saveExecutablePath(provider, path);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.clearAgentProviderExecutablePath,
		async (
			_event,
			request: unknown,
		): Promise<AgentExecutablePathSnapshotWire> => {
			const { provider } = agentProviderRequestSchema.parse(request);

			return agentProviderService.clearExecutablePath(provider);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.selectAgentProviderExecutable,
		async (event, request: unknown): Promise<AgentExecutableSelectionWire> => {
			const { provider } = agentProviderRequestSchema.parse(request);
			const descriptor = getAgentProviderDescriptor(provider);
			const selection = await showDirectorySelectionDialog(event, {
				buttonLabel: `Select ${descriptor.label} executable`,
				message: `Select a ${descriptor.label}-compatible executable or wrapper script.`,
				properties: ['openFile'],
				title: `Select ${descriptor.label} executable`,
			});

			if (selection.canceled) {
				return { canceled: true };
			}

			return agentProviderService.selectExecutable(provider, selection.path);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.openAgentProviderSettingsFile,
		async (
			_event,
			request: unknown,
		): Promise<OpenAgentProviderSettingsFileResult> => {
			const { provider, target } =
				openAgentProviderSettingsFileRequestSchema.parse(request);
			const filePath = agentProviderService.resolveSettingsFilePath(provider);

			if (!filePath) {
				return {
					error: `${getAgentProviderDescriptor(provider).label} has no settings file.`,
					opened: false,
				};
			}

			const creationError = ensureSettingsFile(filePath);

			if (creationError) {
				return { error: creationError, opened: false };
			}

			// Pass the file as a `file`-kind sub-path of its own directory so the
			// shared resolver opens the folder for terminal targets and the file
			// itself for editors, exactly as the settings-header "Open in" does.
			const result = await openTargetService.openTarget({
				relativePath: basename(filePath),
				relativePathKind: 'file',
				targetId: target,
				workspacePath: dirname(filePath),
			});

			return result.ok
				? { opened: true }
				: { error: result.error, opened: false };
		},
	);
}

/**
 * Creates a runtime's settings file (and its directory) when it is absent, so
 * an editor target opens a real file rather than a missing path.
 * @param filePath - Absolute path to the runtime's settings file.
 * @returns An error message when the file could not be created, otherwise `null`.
 */
function ensureSettingsFile(filePath: string): string | null {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, EMPTY_SETTINGS_FILE_CONTENT, { flag: 'wx' });

		return null;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			return null;
		}

		return error instanceof Error
			? error.message
			: 'Failed to create the settings file.';
	}
}
