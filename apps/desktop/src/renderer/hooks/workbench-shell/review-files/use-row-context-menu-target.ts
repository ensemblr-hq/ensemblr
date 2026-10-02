import { type MouseEvent, useCallback, useState } from 'react';

/**
 * Tracks which row a right-click landed on so one shared context menu can serve
 * a whole list instead of mounting a Radix menu per row, and swallows a
 * right-click that landed off the rows rather than opening a menu with nothing
 * to act on. Rows identify themselves with `data-row-path`.
 * @param buildTarget - Turns the clicked row into the menu's own target. Takes
 *   the row's element as well as its path, for a list whose rows carry markup
 *   the listing behind them cannot answer for — a tree's synthesized folder row
 *   has no entry of its own to look up.
 * @returns The row the menu should act on, and the capture handler to bind
 */
export function useRowContextMenuTarget<Target>(
	buildTarget: (rowPath: string, rowElement: HTMLElement) => Target,
): {
	handleContextCapture: (event: MouseEvent<HTMLDivElement>) => void;
	menuTarget: Target | null;
} {
	const [menuTarget, setMenuTarget] = useState<Target | null>(null);

	const handleContextCapture = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const rowElement = (event.target as HTMLElement).closest<HTMLElement>(
				'[data-row-path]',
			);
			if (!rowElement?.dataset.rowPath) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			setMenuTarget(buildTarget(rowElement.dataset.rowPath, rowElement));
		},
		[buildTarget],
	);

	return { handleContextCapture, menuTarget };
}
