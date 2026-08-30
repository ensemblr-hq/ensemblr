import type { BrowserWindow } from 'electron';

import {
	EMPTY_MENU_BAR,
	type MenuBarDescriptor,
	type MenuBarInvokeRequest,
} from '../../shared/menu-bar';
import { describeMenuBar, type MenuBarInvocation } from './menu-bar-descriptor';
import { sendMenuCommand } from './menu-command';
import type { DescribedMenuItem } from './menu-item';
import { performMenuRole } from './menu-roles';

/**
 * Holds the serialized menu bar the renderer draws where the desktop draws no
 * title bar, and resolves the rows it reports back.
 *
 * Row ids are positional, so an invocation is only honoured against the
 * revision that produced it: a click that raced a rebuild would otherwise
 * address whichever row had inherited its path. Dropping the stale one is the
 * safe end of that race — the renderer has already been sent the new bar.
 */
export class MenuBarStore {
	private descriptor: MenuBarDescriptor = EMPTY_MENU_BAR;
	private invocations: ReadonlyMap<string, MenuBarInvocation> = new Map();

	/** The bar as it stands, which is empty until the first menu build. */
	get current(): MenuBarDescriptor {
		return this.descriptor;
	}

	/**
	 * Serializes a freshly built template and takes it as the current bar.
	 * @param template - The annotated template the menu was just built from
	 * @returns The descriptor to broadcast
	 */
	apply(template: readonly DescribedMenuItem[]): MenuBarDescriptor {
		const { descriptor, invocations } = describeMenuBar(
			template,
			this.descriptor.revision + 1,
		);
		this.descriptor = descriptor;
		this.invocations = invocations;
		return descriptor;
	}

	/**
	 * Carries out the row the renderer reported, ignoring one addressed against
	 * a superseded bar.
	 * @param request - The row the user picked, with the revision it came from
	 * @param window - The window that reported it
	 */
	invoke(request: MenuBarInvokeRequest, window: BrowserWindow | null): void {
		if (request.revision !== this.descriptor.revision) {
			return;
		}

		const invocation = this.invocations.get(request.id);
		if (!invocation) {
			return;
		}

		if (invocation.kind === 'command') {
			sendMenuCommand(invocation.dispatch.command, invocation.dispatch.arg);
			return;
		}

		if (window && !window.isDestroyed()) {
			performMenuRole(invocation.role, window);
		}
	}
}
