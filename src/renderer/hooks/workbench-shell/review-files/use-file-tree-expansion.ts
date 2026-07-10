import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks which directory rows are expanded in a file tree, abstracting over the
 * "default open" (changes panel) vs "default closed" (all-files panel)
 * convention so both trees share one mental model.
 *
 * State stores only the paths *toggled away from* `defaultExpanded` rather than
 * the literal expanded/collapsed set. That keeps the default stable when the
 * underlying file list swaps (e.g. placeholder fixture → live git data) without
 * reseeding, and bounds the set to user interactions. Paths no longer present
 * in `knownDirectoryPaths` are pruned so it cannot grow unbounded across swaps.
 *
 * @param defaultExpanded - Whether folders are open before any interaction.
 * @param knownDirectoryPaths - Every directory path currently in the tree.
 *   Pass a memoized array so the prune effect only runs when the tree changes.
 * @returns Expansion readers and writers for the tree rows.
 */
export function useFileTreeExpansion(
	defaultExpanded: boolean,
	knownDirectoryPaths: readonly string[],
): {
	expandDirectories: (paths: readonly string[]) => void;
	isExpanded: (path: string) => boolean;
	toggleDirectory: (path: string) => void;
} {
	const [toggledPaths, setToggledPaths] = useState<Set<string>>(
		() => new Set(),
	);

	useEffect(() => {
		const known = new Set(knownDirectoryPaths);

		setToggledPaths((current) => {
			const next = new Set([...current].filter((path) => known.has(path)));

			// Prune only removes; an unchanged size means nothing was stale, so
			// keep the existing reference and avoid a needless re-render.
			return next.size === current.size ? current : next;
		});
	}, [knownDirectoryPaths]);

	const toggleDirectory = useCallback((path: string) => {
		setToggledPaths((current) => {
			const next = new Set(current);

			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}

			return next;
		});
	}, []);

	const expandDirectories = useCallback(
		(paths: readonly string[]) => {
			setToggledPaths((current) => {
				const next = new Set(current);
				let changed = false;

				for (const path of paths) {
					if (defaultExpanded) {
						changed = next.delete(path) || changed;
					} else if (!next.has(path)) {
						next.add(path);
						changed = true;
					}
				}

				return changed ? next : current;
			});
		},
		[defaultExpanded],
	);

	const isExpanded = useCallback(
		(path: string) =>
			defaultExpanded ? !toggledPaths.has(path) : toggledPaths.has(path),
		[defaultExpanded, toggledPaths],
	);

	return { expandDirectories, isExpanded, toggleDirectory };
}
