import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
	getEnsembleApiOrNull,
	workspaceOpenTargetsQuery,
} from '@/renderer/api/ensemble';
import {
	readLastUsedOpenTarget,
	writeLastUsedOpenTarget,
} from '@/renderer/state/workspace/open-target-history';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/**
 * Snapshot the open-in menu reads to render. `openTargets` is `null` while
 * detection results are still loading so the component can paint nothing
 * (no flash) and `primaryTarget` shares the same null-while-loading shape.
 */
export interface OpenTargetsState {
	invokeTarget: (target: WorkspaceOpenTarget) => Promise<void>;
	openTargets: WorkspaceOpenTarget[] | null;
	primaryTarget: WorkspaceOpenTarget | null;
}

/**
 * Reads the installed-app list from the React Query cache, restores the
 * per-workspace last-used target, and exposes a single `invokeTarget`
 * action that calls the IPC handler and refreshes the last-used pointer
 * on success.
 */
export function useOpenTargets({
	workspaceId,
}: {
	workspaceId: string;
}): OpenTargetsState {
	const hasBridge = getEnsembleApiOrNull() !== null;
	const { data } = useQuery({
		...workspaceOpenTargetsQuery,
		enabled: hasBridge,
	});

	// Per-workspace memory of the last launch-app target the user picked, so
	// the split button defaults to it on the next visit.
	const [lastUsedTargetId, setLastUsedTargetId] = useState<string | null>(() =>
		readLastUsedOpenTarget(workspaceId),
	);
	useEffect(() => {
		setLastUsedTargetId(readLastUsedOpenTarget(workspaceId));
	}, [workspaceId]);

	const openTargets = useMemo<WorkspaceOpenTarget[] | null>(() => {
		const fromQuery = data?.targets ?? null;
		if (!fromQuery) {
			return null;
		}
		return fromQuery.filter(
			(target) => target.installed || target.kind === 'utility',
		);
	}, [data?.targets]);

	const primaryTarget = useMemo<WorkspaceOpenTarget | null>(() => {
		if (!openTargets) {
			return null;
		}
		// copy-path is a clipboard action, not an "open" — never let it take
		// over the split button. Anything that actually opens the workspace
		// (launch-app, reveal-in-finder) is eligible for quick-launch memory.
		const lastUsed =
			lastUsedTargetId === null
				? null
				: (openTargets.find(
						(target) =>
							target.id === lastUsedTargetId &&
							target.behavior !== 'copy-path',
					) ?? null);
		return (
			lastUsed ??
			openTargets.find((target) => target.isPrimary) ??
			openTargets.find((target) => target.kind !== 'utility') ??
			openTargets[0] ??
			null
		);
	}, [lastUsedTargetId, openTargets]);

	const invokeTarget = useCallback(
		async (target: WorkspaceOpenTarget) => {
			const ensemble = getEnsembleApiOrNull();
			if (!ensemble) {
				toast.error('Open in… is unavailable without the Electron bridge.');
				return;
			}
			const result = await ensemble.openWorkspaceInTarget({
				targetId: target.id,
				workspaceId,
			});
			if (!result.ok) {
				toast.error(`Failed to open in ${target.label}: ${result.error}`);
				return;
			}
			if (target.behavior !== 'copy-path') {
				writeLastUsedOpenTarget(workspaceId, target.id);
				setLastUsedTargetId(target.id);
			}
			if (target.behavior === 'copy-path') {
				toast.success('Workspace path copied to clipboard.');
			}
		},
		[workspaceId],
	);

	return { invokeTarget, openTargets, primaryTarget };
}
