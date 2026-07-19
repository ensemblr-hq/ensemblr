import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import {
	getEnsemblrApiOrNull,
	workspaceOpenTargetsQuery,
} from '@/renderer/api/ensemblr';
import {
	readLastUsedOpenTarget,
	writeLastUsedOpenTarget,
} from '@/renderer/state/workspace/open-target-history';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/** Detected targets plus last-used memory shared by every open-in menu. */
export interface OpenTargetMenuState {
	openTargets: WorkspaceOpenTarget[] | null;
	primaryTarget: WorkspaceOpenTarget | null;
	/** Persists `targetId` as the last-used pick for this menu's history key. */
	rememberTarget: (targetId: string) => void;
}

/**
 * Shared foundation for every "Open in…" split button: reads the detected-app
 * list from the React Query cache, filters it to installed/utility entries,
 * restores the last-used pick for `historyKey`, and derives the primary target.
 * Consumers layer their own `invokeTarget` (workspace vs. settings file) on top.
 * @param historyKey - Namespaced key the last-used pick is stored under.
 * @returns The filtered target list, primary target, and a remember callback.
 */
export function useOpenTargetMenu(historyKey: string): OpenTargetMenuState {
	const hasBridge = getEnsemblrApiOrNull() !== null;
	const { data } = useQuery({
		...workspaceOpenTargetsQuery,
		enabled: hasBridge,
	});

	// An inline-during-render comparison re-syncs the last-used copy when the
	// history key changes without paying for an extra useEffect-driven render.
	const [lastUsedTargetId, setLastUsedTargetId] = useState<string | null>(() =>
		readLastUsedOpenTarget(historyKey),
	);
	const [prevKey, setPrevKey] = useState(historyKey);
	if (prevKey !== historyKey) {
		setPrevKey(historyKey);
		setLastUsedTargetId(readLastUsedOpenTarget(historyKey));
	}

	const openTargets = useMemo<WorkspaceOpenTarget[] | null>(() => {
		const fromQuery = data?.targets ?? null;
		if (!fromQuery) {
			return null;
		}
		return fromQuery.filter(
			(target) => target.installed || target.kind === 'utility',
		);
	}, [data?.targets]);

	const primaryTarget = useMemo<WorkspaceOpenTarget | null>(
		() => selectPrimaryTarget(openTargets, lastUsedTargetId),
		[lastUsedTargetId, openTargets],
	);

	const rememberTarget = useCallback(
		(targetId: string) => {
			writeLastUsedOpenTarget(historyKey, targetId);
			setLastUsedTargetId(targetId);
		},
		[historyKey],
	);

	return { openTargets, primaryTarget, rememberTarget };
}

/**
 * Chooses the target the split button defaults to: the remembered pick (never
 * copy-path, which is a clipboard action), then the registry-flagged primary,
 * then the first real app, then the first entry.
 * @param openTargets - Filtered target list, or `null` while loading.
 * @param lastUsedTargetId - Remembered target id, or `null` when none.
 * @returns The primary target, or `null` while loading.
 */
function selectPrimaryTarget(
	openTargets: WorkspaceOpenTarget[] | null,
	lastUsedTargetId: string | null,
): WorkspaceOpenTarget | null {
	if (!openTargets) {
		return null;
	}
	const lastUsed =
		lastUsedTargetId === null
			? null
			: (openTargets.find(
					(target) =>
						target.id === lastUsedTargetId && target.behavior !== 'copy-path',
				) ?? null);
	return (
		lastUsed ??
		openTargets.find((target) => target.isPrimary) ??
		openTargets.find((target) => target.kind !== 'utility') ??
		openTargets[0] ??
		null
	);
}
