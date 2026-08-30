/**
 * Electron roles the app-drawn menu bar has to carry out itself.
 *
 * A role item has no `click` — Electron implements it natively — so a menu the
 * app draws rather than hands to Electron has to reproduce each one. This union
 * is deliberately only the roles the template reaches off darwin, because that
 * is the only place the drawn bar renders: macOS keeps its native menu, and the
 * roles exclusive to it (`services`, `hide`, `pasteAndMatchStyle`, the speech
 * pair, `front`) would be executors with no caller.
 *
 * `reload` is the one entry Electron never sees as a role: the template gives
 * Reload a `click` closure so the item does not claim ⌘R, which the renderer
 * spends on Run. It reaches the drawn bar through `drawnRole` instead, because
 * a closure is opaque to the serializer and the row would otherwise be the only
 * permanently dead one in the bar.
 */
const DRAWN_MENU_ITEM_ROLES = [
	'about',
	'copy',
	'cut',
	'delete',
	'forceReload',
	'minimize',
	'paste',
	'quit',
	'redo',
	'reload',
	'resetZoom',
	'selectAll',
	'toggleDevTools',
	'undo',
	'zoom',
	'zoomIn',
	'zoomOut',
] as const;

/** One Electron role the drawn menu bar knows how to carry out. */
export type DrawnMenuItemRole = (typeof DRAWN_MENU_ITEM_ROLES)[number];

/**
 * Whether a role from the native template is one the drawn bar can perform.
 * @param role - The role string an Electron template item carried
 * @returns True when the drawn bar has an executor for it
 */
export function isDrawnMenuItemRole(
	role: string | undefined,
): role is DrawnMenuItemRole {
	return (
		role !== undefined &&
		(DRAWN_MENU_ITEM_ROLES as readonly string[]).includes(role)
	);
}

/** A rule drawn between two groups of items. */
export interface MenuBarSeparator {
	readonly kind: 'separator';
	/** Carried for the same reason a row has one: it is the renderer's list key. */
	readonly id: string;
}

/** How an item reports state the renderer owns: a toggle, or one of a group. */
export type MenuBarItemMark = 'checkbox' | 'radio';

/** A chooseable row: it dispatches a command or performs a role when picked. */
export interface MenuBarAction {
	readonly kind: 'action';
	/**
	 * Address of this row within the revision that produced it. Opaque to the
	 * renderer, which hands it straight back to invoke the row.
	 */
	readonly id: string;
	readonly label: string;
	/** Display-ready chord, present only for the rows the native menu labels. */
	readonly accelerator?: string;
	readonly enabled: boolean;
	readonly mark?: MenuBarItemMark;
	readonly checked?: boolean;
}

/** A row that opens a nested list rather than doing anything itself. */
export interface MenuBarSubmenu {
	readonly kind: 'submenu';
	readonly id: string;
	readonly label: string;
	readonly enabled: boolean;
	readonly items: readonly MenuBarNode[];
}

/** Any row the drawn menu bar can render. */
export type MenuBarNode = MenuBarSeparator | MenuBarAction | MenuBarSubmenu;

/**
 * The whole bar, as the renderer receives it.
 *
 * Serialized from the same Electron template `Menu.setApplicationMenu` is given,
 * so the drawn bar cannot drift from the native one: labels, enabled state,
 * checkmarks, accelerators and ordering are all resolved once, in main.
 *
 * `revision` rises on every rebuild and is quoted back when a row is invoked.
 * Row ids are positional, so a click that raced a rebuild would otherwise
 * address a different row than the one the user saw.
 */
export interface MenuBarDescriptor {
	readonly revision: number;
	readonly menus: readonly MenuBarSubmenu[];
}

/** Payload the renderer sends to perform the row the user picked. */
export interface MenuBarInvokeRequest {
	readonly revision: number;
	readonly id: string;
}

/** An empty bar, which is what the renderer shows before main has sent one. */
export const EMPTY_MENU_BAR: MenuBarDescriptor = { menus: [], revision: 0 };
