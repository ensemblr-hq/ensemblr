import { homedir } from 'node:os';

import { ipcMain } from 'electron';
import { z } from 'zod';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	EnvironmentFilesResult,
	EnvironmentMutationResult,
	EnvironmentVariablesSnapshot,
	ReadEnvironmentVariableValueResult,
	SelectEnvFileResult,
} from '../../../shared/ipc/contracts/environment';
import {
	EnvironmentVariablesError,
	type EnvironmentVariablesService,
} from '../../environment/environment-variables';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Service dependencies used by the environment-variables IPC handler. */
export interface EnvironmentHandlersOptions {
	environmentVariablesService: EnvironmentVariablesService;
}

const scopeSchema = z.enum(['app', 'repository', 'workspace']);

const setVariableSchema = z.object({
	key: z.string(),
	previousKey: z.string().optional(),
	scope: scopeSchema,
	scopeId: z.string().optional(),
	value: z.string(),
});

const unsetVariableSchema = z.object({
	key: z.string(),
	scope: scopeSchema,
	scopeId: z.string().optional(),
});

const readVariableSchema = z.object({
	key: z.string(),
	scope: scopeSchema,
	scopeId: z.string().optional(),
});

const envFilesScopeSchema = z.object({
	scope: scopeSchema,
	scopeId: z.string().optional(),
});

const envFileSchema = z.object({
	path: z.string(),
	scope: scopeSchema,
	scopeId: z.string().optional(),
});

/**
 * Renders a thrown value into a user-facing message, preferring the typed
 * {@link EnvironmentVariablesError} message.
 * @param error - Thrown value.
 * @returns A friendly message string.
 */
function toFriendlyError(error: unknown): string {
	if (error instanceof EnvironmentVariablesError) {
		return error.message;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return 'The environment variable could not be saved.';
}

/**
 * Registers the IPC handlers that expose the curated environment variables
 * snapshot plus the read/write, env-file, and file-picker operations.
 * @param options - Required services.
 */
export function registerEnvironmentHandlers({
	environmentVariablesService,
}: EnvironmentHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.environmentVariables,
		(): Promise<EnvironmentVariablesSnapshot> =>
			environmentVariablesService.getSnapshot(),
	);

	ipcMain.handle(
		IPC_CHANNELS.setEnvironmentVariable,
		async (_event, raw: unknown): Promise<EnvironmentMutationResult> => {
			const request = setVariableSchema.parse(raw);

			try {
				const snapshot = await environmentVariablesService.setValue({
					key: request.key,
					scope: request.scope,
					scopeId: request.scopeId,
					value: request.value,
				});

				if (request.previousKey && request.previousKey !== request.key) {
					await environmentVariablesService.unsetValue({
						key: request.previousKey,
						scope: request.scope,
						scopeId: request.scopeId,
					});
				}

				return { snapshot };
			} catch (error) {
				return { error: toFriendlyError(error) };
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.unsetEnvironmentVariable,
		async (_event, raw: unknown): Promise<EnvironmentMutationResult> => {
			const request = unsetVariableSchema.parse(raw);

			try {
				await environmentVariablesService.unsetValue(request);
				return {};
			} catch (error) {
				return { error: toFriendlyError(error) };
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.readEnvironmentVariableValue,
		async (
			_event,
			raw: unknown,
		): Promise<ReadEnvironmentVariableValueResult> => {
			const request = readVariableSchema.parse(raw);
			const value = await environmentVariablesService.readValue(request);
			return { value };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listEnvFiles,
		async (_event, raw: unknown): Promise<EnvironmentFilesResult> => {
			const request = envFilesScopeSchema.parse(raw);
			const paths = await environmentVariablesService.listEnvFiles(request);
			return { paths };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.addEnvFile,
		async (_event, raw: unknown): Promise<EnvironmentFilesResult> => {
			const request = envFileSchema.parse(raw);

			try {
				const paths = await environmentVariablesService.addEnvFile(request);
				return { paths };
			} catch (error) {
				const paths = await environmentVariablesService.listEnvFiles(request);
				return { error: toFriendlyError(error), paths };
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.removeEnvFile,
		async (_event, raw: unknown): Promise<EnvironmentFilesResult> => {
			const request = envFileSchema.parse(raw);
			const paths = await environmentVariablesService.removeEnvFile(request);
			return { paths };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.selectEnvFile,
		async (event): Promise<SelectEnvFileResult> => {
			const result = await showDirectorySelectionDialog(event, {
				buttonLabel: 'Add env file',
				defaultPath: homedir(),
				message: 'Select an env file to load environment variables from.',
				properties: ['openFile', 'showHiddenFiles'],
				title: 'Select env file',
			});

			return result.canceled
				? { canceled: true }
				: { canceled: false, path: result.path };
		},
	);
}
