import { useCallback, useEffect, useState } from 'react';

import {
	getMenuBar,
	invokeMenuBarItem,
	onMenuBarChanged,
} from '@/renderer/api/ensemblr';
import {
	EMPTY_MENU_BAR,
	type MenuBarAction,
	type MenuBarDescriptor,
} from '@/shared/menu-bar';

/**
 * Tracks the menu bar main builds, and reports back the row the user picks.
 *
 * The bar is read once on mount and thereafter written only by main's
 * broadcast: it is the same tree the native menu was built from, so enabled
 * state and checkmarks arrive already resolved rather than being re-derived
 * here from the command registry.
 * @returns The current bar and a selector that performs one of its rows.
 */
export function useMenuBar(): {
	menuBar: MenuBarDescriptor;
	select: (item: MenuBarAction) => void;
} {
	const [menuBar, setMenuBar] = useState<MenuBarDescriptor>(EMPTY_MENU_BAR);

	useEffect(() => {
		let active = true;
		const unsubscribe = onMenuBarChanged(setMenuBar);

		void getMenuBar().then((initial) => {
			// A broadcast can land before the read resolves, and it is the newer of
			// the two; the revision is what says so.
			if (active) {
				setMenuBar((current) =>
					initial.revision > current.revision ? initial : current,
				);
			}
		});

		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	const select = useCallback(
		(item: MenuBarAction) => {
			void invokeMenuBarItem({ id: item.id, revision: menuBar.revision });
		},
		[menuBar.revision],
	);

	return { menuBar, select };
}
