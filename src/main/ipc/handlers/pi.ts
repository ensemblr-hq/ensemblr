import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ListPiSlashCommandsRequest,
	ListPiSlashCommandsResult,
	PiExecutablePathSnapshot,
	PiExecutableSelectionResult,
	SetPiExecutablePathRequest,
} from '../../../shared/ipc/contracts/pi-session';
import { resolvePiSlashCommands } from '../../pi-agent/pi-slash-commands.ts';
import type {
	PiExecutableService,
	PiExecutableSnapshot,
} from '../../pi-runtime';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/**
 * Projects the internal Pi executable snapshot onto the IPC-safe path snapshot
 * used to hydrate the Advanced settings screen. The override path is surfaced
 * only when it comes from the user's SQLite setting so the input reflects what
 * the user configured, not a config- or PATH-derived value.
 * @param snapshot - Resolved Pi executable snapshot.
 * @returns The IPC-safe path snapshot.
 */
function toPathSnapshot(
	snapshot: PiExecutableSnapshot,
): PiExecutablePathSnapshot {
	const override =
		snapshot.setting && snapshot.setting.source === 'sqlite'
			? String(snapshot.setting.value ?? '')
			: null;

	return {
		overridePath: override?.trim() ? override : null,
		resolvedPath: snapshot.path || null,
		source: snapshot.source,
		status: snapshot.status,
	};
}

/**
 * Registers IPC handlers for selecting and saving a Pi executable override
 * and for surfacing pi's slash command catalog to the renderer.
 * @param options - Required services.
 */
export function registerPiHandlers({
	piExecutableService,
}: {
	piExecutableService: PiExecutableService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.selectPiExecutable,
		async (event): Promise<PiExecutableSelectionResult> => {
			const selection = await showDirectorySelectionDialog(event, {
				buttonLabel: 'Select Pi executable',
				message:
					'Select a Pi-compatible executable or wrapper script, such as pi or oh-my-pi.',
				properties: ['openFile'],
				title: 'Select Pi executable',
			});

			if (selection.canceled) {
				return { canceled: true };
			}

			return piExecutableService.saveOverride(selection.path);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.getPiExecutablePath,
		async (): Promise<PiExecutablePathSnapshot> =>
			toPathSnapshot(await piExecutableService.getSnapshot()),
	);

	ipcMain.handle(
		IPC_CHANNELS.setPiExecutablePath,
		(
			_event,
			request: SetPiExecutablePathRequest,
		): PiExecutableSelectionResult =>
			piExecutableService.saveOverride(request.path),
	);

	ipcMain.handle(
		IPC_CHANNELS.clearPiExecutablePath,
		(): PiExecutableSelectionResult => piExecutableService.clearOverride(),
	);

	ipcMain.handle(
		IPC_CHANNELS.listPiSlashCommands,
		async (
			_event,
			request?: ListPiSlashCommandsRequest,
		): Promise<ListPiSlashCommandsResult> => {
			const snapshot = await piExecutableService.getSnapshot();
			return resolvePiSlashCommands(snapshot, request?.cwd);
		},
	);
}
