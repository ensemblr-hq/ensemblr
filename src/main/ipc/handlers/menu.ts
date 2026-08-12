import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { MenuContextStore } from '../../menu';
import { menuContextSchema } from '../request-schemas.ts';

/**
 * Registers the channel the renderer reports its menu context on — which
 * commands currently have a handler, which of them are checked, and the entries
 * filling the dynamic submenus. Rebuilds the native menu only when the report
 * actually changes it, because `Menu.setApplicationMenu` replaces the whole bar
 * and route changes report far more often than they alter it.
 * @param menuContextStore - Holds the last applied context
 * @param rebuildMenu - Reinstalls the application menu from the stored context
 */
export function registerMenuHandlers({
	menuContextStore,
	rebuildMenu,
}: {
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
}
