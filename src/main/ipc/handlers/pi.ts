import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ListPiSlashCommandsRequest,
	ListPiSlashCommandsResult,
} from '../../../shared/ipc/contracts/agent-session';
import { resolvePiSlashCommands } from '../../pi-agent/pi-slash-commands.ts';
import type { PiExecutableService } from '../../pi-runtime';

/**
 * Registers the Pi CLI IPC handlers. Executable discovery and overrides live on
 * the provider-parameterized `agent-provider` channels; slash commands stay
 * here because they are a Pi CLI feature with no sibling on other runtimes.
 * @param options - Required services.
 */
export function registerPiHandlers({
	piExecutableService,
}: {
	piExecutableService: PiExecutableService;
}): void {
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
