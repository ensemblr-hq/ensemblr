import { type IpcMainInvokeEvent, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	LinkedDirectorySelectionResult,
	ListLinkedDirectoryRecentsResult,
	RecordLinkedDirectoryResult,
} from '../../../shared/ipc/contracts/linked-directories';
import type { LinkedDirectoryService } from '../../linked-directories/index.ts';
import { linkedDirectoryRequestSchema } from '../request-schemas.ts';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/**
 * Registers the IPC handlers behind the composer's "Link directory…" picker:
 * the native folder chooser and the app-global recents list it offers.
 * @param options - The linked-directory service.
 */
export function registerLinkedDirectoryHandlers({
	linkedDirectoryService,
}: {
	linkedDirectoryService: LinkedDirectoryService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.selectLinkedDirectory,
		(event: IpcMainInvokeEvent): Promise<LinkedDirectorySelectionResult> =>
			showDirectorySelectionDialog(event, {
				buttonLabel: 'Link',
				message: 'Select a directory to give this chat’s agent access to.',
				properties: ['openDirectory', 'createDirectory'],
				title: 'Link directory',
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.listLinkedDirectoryRecents,
		(): Promise<ListLinkedDirectoryRecentsResult> =>
			linkedDirectoryService.list(),
	);

	ipcMain.handle(
		IPC_CHANNELS.recordLinkedDirectoryRecent,
		(_event, raw: unknown): Promise<RecordLinkedDirectoryResult> =>
			linkedDirectoryService.record(linkedDirectoryRequestSchema.parse(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.forgetLinkedDirectoryRecent,
		(_event, raw: unknown): Promise<ListLinkedDirectoryRecentsResult> =>
			linkedDirectoryService.forget(linkedDirectoryRequestSchema.parse(raw)),
	);
}
