import { atom } from 'jotai';

import type { MenuCommandId, MenuDynamicEntry } from '@/shared/menu-commands';

/** Handler stack registered for one menu command; the last entry is the active one. */
export type MenuCommandHandler = (arg?: string) => void;

/**
 * Handlers registered for each menu command, most-recently-registered last.
 *
 * A stack rather than a single slot because route transitions overlap: the
 * outgoing view has not unmounted when the incoming one registers, so the newest
 * registration must win and the older one must survive underneath to be restored
 * if the newer unmounts first.
 *
 * "Newest" is effect order, which for nested components means the *ancestor*
 * wins — React flushes a parent's effects after its children's. So a command
 * that must run one view's version of itself takes a single registrant in that
 * view, not a root-level default underneath it.
 */
export const menuCommandHandlersAtom = atom<
	Readonly<Partial<Record<MenuCommandId, readonly MenuCommandHandler[]>>>
>({});

/** One component's claim on a command's checkmark, identified by a stable token. */
export interface MenuCheckedClaim {
	readonly owner: object;
	readonly checked: boolean;
}

/**
 * Checked state claimed for each menu command, most-recently-mounted last —
 * the layout toggles, the active panel and theme, Plan Mode, and Run while a
 * script is running.
 *
 * Stacked for the same reason the handlers are: two components can own one
 * command's checkmark across a route transition, and the one that unmounts must
 * hand the mark back rather than erase it.
 */
export const menuCheckedCommandsAtom = atom<
	Readonly<Partial<Record<MenuCommandId, readonly MenuCheckedClaim[]>>>
>({});

/** Entries filling each renderer-supplied submenu, already localized. */
export const menuDynamicEntriesAtom = atom<{
	readonly chatTabs: readonly MenuDynamicEntry[];
	readonly openTargets: readonly MenuDynamicEntry[];
	readonly recentProjects: readonly MenuDynamicEntry[];
	readonly runScripts: readonly MenuDynamicEntry[];
}>({
	chatTabs: [],
	openTargets: [],
	recentProjects: [],
	runScripts: [],
});
