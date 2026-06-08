import {
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	type OpenDialogOptions,
} from 'electron';

/** Canonical canceled/selected discriminated union shared by every directory-picker IPC handler. */
export type DirectorySelectionResult =
	| { canceled: true; path?: undefined }
	| { canceled: false; path: string };

/**
 * Opens a native open-dialog rooted on the invoking renderer's window when
 * available, returning a canonical canceled/path result. Used by every IPC
 * handler that asks the user to pick a directory.
 */
export async function showDirectorySelectionDialog(
	event: IpcMainInvokeEvent,
	options: OpenDialogOptions,
): Promise<DirectorySelectionResult> {
	const window = BrowserWindow.fromWebContents(event.sender);
	const result = window
		? await dialog.showOpenDialog(window, options)
		: await dialog.showOpenDialog(options);

	if (result.canceled || !result.filePaths[0]) {
		return { canceled: true };
	}

	return { canceled: false, path: result.filePaths[0] };
}
