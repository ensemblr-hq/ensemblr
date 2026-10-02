import { formatShortcut } from '../../shared/keymap/matcher';
import {
	type DrawnMenuItemRole,
	isDrawnMenuItemRole,
	type MenuBarDescriptor,
	type MenuBarItemMark,
	type MenuBarNode,
	type MenuBarSubmenu,
} from '../../shared/menu-bar';
import { menuCommandDef } from '../../shared/menu-commands';
import type { DescribedMenuItem, MenuItemDispatch } from './menu-item';
import { acceleratorForRole } from './menu-roles';

/** What main performs when the drawn bar reports a row was chosen. */
export type MenuBarInvocation =
	| { readonly kind: 'command'; readonly dispatch: MenuItemDispatch }
	| { readonly kind: 'role'; readonly role: DrawnMenuItemRole };

/** A serialized bar and the lookup that turns one of its row ids back into work. */
export interface DescribedMenuBar {
	readonly descriptor: MenuBarDescriptor;
	readonly invocations: ReadonlyMap<string, MenuBarInvocation>;
}

/**
 * Serializes the template Electron was given into the tree the renderer draws,
 * plus the lookup that resolves a chosen row back to what it does.
 *
 * Reading the built template rather than re-declaring the structure is the
 * whole point: the drawn bar and the native one are the same menu, resolved
 * once, so labels, ordering, enabled state and checkmarks cannot diverge.
 * @param template - The annotated template the builders produced
 * @param revision - Rebuild counter stamped onto the descriptor and its row ids
 * @returns The descriptor to send, and the invocation lookup to keep
 */
export function describeMenuBar(
	template: readonly DescribedMenuItem[],
	revision: number,
): DescribedMenuBar {
	const invocations = new Map<string, MenuBarInvocation>();
	const menus = describeNodes(template, '', invocations).filter(
		(node): node is MenuBarSubmenu => node.kind === 'submenu',
	);

	return { descriptor: { menus, revision }, invocations };
}

/**
 * Walks one level of the template, dropping the rows the drawn bar cannot show.
 * @param nodes - Template items at this level
 * @param prefix - Dotted path of the parent row, empty at the top level
 * @param invocations - Lookup being filled as chooseable rows are found
 * @returns The renderable rows at this level
 */
function describeNodes(
	nodes: readonly DescribedMenuItem[],
	prefix: string,
	invocations: Map<string, MenuBarInvocation>,
): MenuBarNode[] {
	return nodes.flatMap((node, index) => {
		const described = describeNode(node, `${prefix}${index}`, invocations);
		return described ? [described] : [];
	});
}

/**
 * Serializes one template item.
 *
 * An unlabelled row is dropped, which is the macOS-owned `services` submenu and
 * nothing the template produces off darwin. A labelled row with nothing behind
 * it renders disabled instead — that is how the placeholder inside an empty
 * dynamic submenu ("No Run Scripts") survives the trip.
 * @param node - The template item to serialize
 * @param id - Dotted path addressing this row within the revision
 * @param invocations - Lookup being filled as chooseable rows are found
 * @returns The renderable row, or null when it cannot be drawn
 */
function describeNode(
	node: DescribedMenuItem,
	id: string,
	invocations: Map<string, MenuBarInvocation>,
): MenuBarNode | null {
	if (node.type === 'separator') {
		return { id, kind: 'separator' };
	}

	if (node.submenu) {
		return {
			enabled: node.enabled ?? true,
			id,
			items: describeNodes(node.submenu, `${id}.`, invocations),
			kind: 'submenu',
			label: node.label ?? '',
		};
	}

	if (!node.label) {
		return null;
	}

	const invocation = invocationOf(node);
	if (invocation) {
		invocations.set(id, invocation);
	}
	const mark = markOf(node.type);

	return {
		accelerator: invocation ? acceleratorOf(invocation) : undefined,
		checked: mark ? (node.checked ?? false) : undefined,
		enabled: (node.enabled ?? true) && invocation !== null,
		id,
		kind: 'action',
		label: node.label,
		mark,
	};
}

/**
 * Resolves what a chooseable row does — dispatch a command, or perform a role.
 *
 * `drawnRole` is read ahead of `role` so a row Electron was handed a `click`
 * for, to keep it from claiming the role's accelerator, still reaches the drawn
 * bar as the role it is rather than as a dead row.
 * @param node - The template item to classify
 * @returns The invocation, or null for a row the drawn bar cannot perform
 */
function invocationOf(node: DescribedMenuItem): MenuBarInvocation | null {
	if (node.dispatch) {
		return { dispatch: node.dispatch, kind: 'command' };
	}
	const role = node.drawnRole ?? node.role;
	if (isDrawnMenuItemRole(role)) {
		return { kind: 'role', role };
	}
	return null;
}

/**
 * Resolves the chord to show beside a row, matching what the native menu shows:
 * a command labels its chord only when it owns it, and a role borrows the
 * default Electron binds for it.
 * @param invocation - What the row does
 * @returns The display-ready chord, or undefined when the row shows none
 */
function acceleratorOf(invocation: MenuBarInvocation): string | undefined {
	if (invocation.kind === 'role') {
		return acceleratorForRole(invocation.role);
	}

	const { ownsAccelerator, shortcutId } = menuCommandDef(
		invocation.dispatch.command,
	);
	return ownsAccelerator && shortcutId ? formatShortcut(shortcutId) : undefined;
}

/**
 * Maps an Electron item type onto the mark the drawn row renders.
 * @param type - The template item's type
 * @returns The mark, or undefined for a plain row
 */
function markOf(type: DescribedMenuItem['type']): MenuBarItemMark | undefined {
	if (type === 'checkbox' || type === 'radio') {
		return type;
	}
	return undefined;
}
