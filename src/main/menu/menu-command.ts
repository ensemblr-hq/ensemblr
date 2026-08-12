import { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
	MenuCommandBroadcast,
	MenuCommandId,
	MenuContext,
} from '../../shared/menu-commands';
import { isSameMenuContext } from '../../shared/menu-commands';

/**
 * Dispatches a menu command to the window the user was looking at when they
 * opened the menu. Falls back to the first window because the menu bar is
 * reachable with every window minimised, where there is no focused window and
 * the command would otherwise be dropped silently.
 * @param command - The command the chosen menu item carries
 * @param arg - Identifier of the chosen entry, for dynamic submenu items
 */
export function sendMenuCommand(command: MenuCommandId, arg?: string): void {
	const target =
		BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(0);
	target?.webContents.send(IPC_CHANNELS.menuCommand, {
		arg,
		command,
	} satisfies MenuCommandBroadcast);
}

/**
 * Holds the menu context the renderer last reported and decides when that
 * warrants rebuilding the menu.
 *
 * Before the first report the context is null, which every consumer reads as
 * "enable everything" — so the menu is fully live from launch, and a renderer
 * that never reports leaves it that way rather than presenting a dead menu.
 */
export class MenuContextStore {
	private context: MenuContext | null = null;

	/** The last reported context, or null when the renderer has not reported yet. */
	get current(): MenuContext | null {
		return this.context;
	}

	/**
	 * Records a newly reported context.
	 * @param next - The context the renderer just reported
	 * @returns True when the menu must be rebuilt to reflect it
	 */
	apply(next: MenuContext): boolean {
		if (isSameMenuContext(this.context, next)) {
			return false;
		}
		this.context = next;
		return true;
	}
}
