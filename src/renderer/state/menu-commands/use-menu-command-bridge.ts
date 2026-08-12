import { useAtomValue, useStore } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';

import type { MenuCommandId, MenuContext } from '@/shared/menu-commands';
import {
	type MenuCheckedClaim,
	menuCheckedCommandsAtom,
	menuCommandHandlersAtom,
	menuDynamicEntriesAtom,
} from './atoms';

const REPORT_DEBOUNCE_MS = 150;

/**
 * Commands the menu keeps enabled with nothing registered, because the renderer
 * answers them from a platform default instead of a view's handler.
 *
 * A disabled item never fires its click and never surrenders its accelerator, so
 * leaving ⌘W out of the report on a screen that mounts no closer of its own
 * would not fall back to closing the window — it would kill the keystroke.
 * {@link dispatchFallback} is the other half of this pair; keep them together.
 */
const ALWAYS_AVAILABLE: readonly MenuCommandId[] = ['tab.close'];

/**
 * Single owner of the native menu's renderer side: it dispatches the commands
 * the menu broadcasts, and reports back which commands currently have a handler
 * so the menu can disable the rest.
 *
 * Dispatch is centralized here rather than left to each view because exactly one
 * handler must run per command — the top of that command's stack — and views
 * that register nothing simply leave their item disabled. Call it once, at the
 * router root; the registration hooks reach this state through Jotai and so work
 * from anywhere in the tree.
 */
export function useMenuCommandBridge(): void {
	const store = useStore();
	const handlers = useAtomValue(menuCommandHandlersAtom);
	const checked = useAtomValue(menuCheckedCommandsAtom);
	const dynamic = useAtomValue(menuDynamicEntriesAtom);

	useEffect(
		() =>
			window.ensemblr?.onMenuCommand(({ arg, command }) => {
				const active = store.get(menuCommandHandlersAtom)[command]?.at(-1);

				if (active) {
					active(arg);
					return;
				}

				dispatchFallback(command);
			}),
		[store],
	);

	const context = useMemo<MenuContext>(
		() => ({
			chatTabs: dynamic.chatTabs,
			checked: checkedCommandIds(checked),
			commands: availableCommandIds(handlers),
			openTargets: dynamic.openTargets,
			recentProjects: dynamic.recentProjects,
			runScripts: dynamic.runScripts,
		}),
		[checked, dynamic, handlers],
	);

	const report = useCallback((next: MenuContext) => {
		void window.ensemblr?.reportMenuContext(next);
	}, []);

	useEffect(() => {
		// A route change registers and unregisters several commands within a few
		// ticks; without the trailing debounce each one would cost a full
		// Menu.setApplicationMenu replacement.
		const timer = setTimeout(() => report(context), REPORT_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [context, report]);
}

/**
 * Runs the platform default for a command no view handled.
 * @param command - The command that reached the bottom of its stack
 */
function dispatchFallback(command: MenuCommandId): void {
	if (command === 'tab.close') {
		void window.ensemblr?.closeWindow();
	}
}

/**
 * Lists the commands the menu should enable: the ones with a registered handler
 * plus the ones answered by a platform default.
 * @param handlers - Handler stacks by command id
 * @returns The command ids to report as available
 */
function availableCommandIds(
	handlers: Readonly<Partial<Record<MenuCommandId, unknown>>>,
): readonly MenuCommandId[] {
	const registered = Object.keys(handlers) as MenuCommandId[];
	const missing = ALWAYS_AVAILABLE.filter((command) => !(command in handlers));
	return [...registered, ...missing];
}

/**
 * Narrows the checked claims to the ids whose newest owner reads as on, which is
 * the shape the menu context carries.
 * @param checked - Checked claims by command id
 * @returns The command ids whose item should render checked
 */
function checkedCommandIds(
	checked: Readonly<
		Partial<Record<MenuCommandId, readonly MenuCheckedClaim[]>>
	>,
): readonly MenuCommandId[] {
	return Object.entries(checked).flatMap(([command, claims]) =>
		claims?.at(-1)?.checked ? [command as MenuCommandId] : [],
	);
}
