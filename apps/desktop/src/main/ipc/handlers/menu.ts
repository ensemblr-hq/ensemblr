import { BrowserWindow, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { MenuBarDescriptor } from '../../../shared/menu-bar';
import type { MenuBarStore, MenuContextStore } from '../../menu';
import {
	menuBarInvokeRequestSchema,
	menuContextSchema,
} from '../request-schemas.ts';

/**
 * Registers the channels the native menu shares with the renderer: the context
 * report that decides which items are live, and the two the app-drawn menu bar
 * adds — reading the current bar, and performing a row from it.
 *
 * The context report rebuilds the native menu only when it actually changes it,
 * because `Menu.setApplicationMenu` replaces the whole bar and route changes
 * report far more often than they alter it.
 * @param menuBarStore - Holds the serialized bar the renderer draws
 * @param menuContextStore - Holds the last applied context
 * @param rebuildMenu - Reinstalls the application menu from the stored context
 */
export function registerMenuHandlers({
	menuBarStore,
	menuContextStore,
	rebuildMenu,
}: {
	menuBarStore: MenuBarStore;
	menuContextStore: MenuContextStore;
	rebuildMenu: () => void;
}): void {
	ipcMain.handle(IPC_CHANNELS.menuContext, (_event, raw: unknown) => {
		const parsed = menuContextSchema.safeParse(raw);

		if (!parsed.success) {
			// One unrecognised id rejects the whole report, and the store then keeps
			// the last good context indefinitely — so a frozen menu has to say why.
			console.warn(
				'Rejected malformed menu context; menu keeps its last state:',
				parsed.error.issues,
			);
			return;
		}

		if (menuContextStore.apply(parsed.data)) {
			rebuildMenu();
		}
	});

	ipcMain.handle(
		IPC_CHANNELS.getMenuBar,
		(): MenuBarDescriptor => menuBarStore.current,
	);

	ipcMain.handle(IPC_CHANNELS.invokeMenuBarItem, (event, raw: unknown) => {
		const parsed = menuBarInvokeRequestSchema.safeParse(raw);

		if (!parsed.success) {
			console.warn(
				'Rejected malformed menu bar invocation:',
				parsed.error.issues,
			);
			return;
		}

		menuBarStore.invoke(
			parsed.data,
			BrowserWindow.fromWebContents(event.sender),
		);
	});
}
