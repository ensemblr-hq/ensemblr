import { useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef } from 'react';

import type { MenuCommandId, MenuDynamicEntry } from '@/shared/menu-commands';
import { sameEntries } from '@/shared/menu-commands';
import {
	type MenuCheckedClaim,
	type MenuCommandHandler,
	menuCheckedCommandsAtom,
	menuCommandHandlersAtom,
	menuDynamicEntriesAtom,
} from './atoms';

/** State shape of {@link menuCheckedCommandsAtom}, threaded through its update helpers. */
type MenuCheckedClaims = Readonly<
	Partial<Record<MenuCommandId, readonly MenuCheckedClaim[]>>
>;

/**
 * Registers a handler for a native-menu command while the calling component is
 * mounted, which is also what enables the menu item.
 *
 * What is registered is a stable indirection reading the latest `handler` from a
 * ref, so an inline closure is safe: registration re-runs only when the command
 * or its enabled state changes, never on every render.
 * @param command - The menu command to handle
 * @param handler - Runs when the item is chosen; receives the entry id for dynamic submenus
 * @param enabled - Set false to leave the item disabled without unmounting
 */
export function useMenuCommand(
	command: MenuCommandId,
	handler: MenuCommandHandler,
	enabled = true,
): void {
	const setHandlers = useSetAtom(menuCommandHandlersAtom);
	const handlerRef = useRef(handler);

	useEffect(() => {
		handlerRef.current = handler;
	});

	const registered = useMemo<MenuCommandHandler>(
		() => (arg) => handlerRef.current(arg),
		[],
	);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		setHandlers((previous) => ({
			...previous,
			[command]: [...(previous[command] ?? []), registered],
		}));

		return () => {
			setHandlers((previous) => {
				const { [command]: stack, ...rest } = previous;
				const remaining = (stack ?? []).filter(
					(candidate) => candidate !== registered,
				);
				return remaining.length > 0
					? { ...rest, [command]: remaining }
					: (rest as typeof previous);
			});
		};
	}, [command, enabled, registered, setHandlers]);
}

/**
 * Marks a menu command's item as checked while the calling component is
 * mounted, for the toggles and radio groups whose state the menu mirrors.
 *
 * Claims are stacked per command the way handlers are, keyed by a token stable
 * for the component's lifetime, so a second owner mounting over the first hands
 * the mark back on unmount instead of clearing it.
 * @param command - The menu command whose item carries the checkmark
 * @param checked - Whether the item currently reads as on
 */
export function useMenuCommandChecked(
	command: MenuCommandId,
	checked: boolean,
): void {
	const setChecked = useSetAtom(menuCheckedCommandsAtom);
	const owner = useMemo(() => ({}), []);

	useEffect(() => {
		setChecked((previous) => claimChecked(previous, command, owner, checked));
	}, [checked, command, owner, setChecked]);

	useEffect(
		() => () => {
			setChecked((previous) => releaseChecked(previous, command, owner));
		},
		[command, owner, setChecked],
	);
}

/**
 * Records an owner's checked state, appending it when the owner is new and
 * updating it in place otherwise so the claim keeps its position in the stack.
 * @param claims - Current claims by command
 * @param command - The command being claimed
 * @param owner - Token identifying the claiming component
 * @param checked - Whether that owner reads the item as on
 * @returns The updated claims
 */
function claimChecked(
	claims: MenuCheckedClaims,
	command: MenuCommandId,
	owner: object,
	checked: boolean,
): MenuCheckedClaims {
	const stack = claims[command] ?? [];
	const held = stack.some((claim) => claim.owner === owner);
	return {
		...claims,
		[command]: held
			? stack.map((claim) =>
					claim.owner === owner ? { checked, owner } : claim,
				)
			: [...stack, { checked, owner }],
	};
}

/**
 * Drops an owner's claim, removing the command entirely once nobody holds it.
 * @param claims - Current claims by command
 * @param command - The command being released
 * @param owner - Token identifying the releasing component
 * @returns The updated claims
 */
function releaseChecked(
	claims: MenuCheckedClaims,
	command: MenuCommandId,
	owner: object,
): MenuCheckedClaims {
	const { [command]: stack, ...rest } = claims;
	const remaining = (stack ?? []).filter((claim) => claim.owner !== owner);
	return remaining.length > 0 ? { ...rest, [command]: remaining } : rest;
}

/**
 * Publishes the entries filling one renderer-supplied submenu while the calling
 * component is mounted. Labels must already be localized — the main process
 * renders them verbatim.
 * @param group - Which submenu the entries fill
 * @param entries - The entries, in display order
 */
export function useMenuDynamicEntries(
	group: 'chatTabs' | 'openTargets' | 'recentProjects' | 'runScripts',
	entries: readonly MenuDynamicEntry[],
): void {
	const setEntries = useSetAtom(menuDynamicEntriesAtom);

	// Runs on every render deliberately: `entries` is a fresh array each time the
	// owning component renders, so no dependency tracks its value. Returning the
	// previous state untouched when nothing moved is what stops that looping.
	useEffect(() => {
		setEntries((previous) =>
			sameEntries(previous[group], entries)
				? previous
				: { ...previous, [group]: entries },
		);
	});

	useEffect(
		() => () => {
			setEntries((previous) => ({ ...previous, [group]: [] }));
		},
		[group, setEntries],
	);
}
