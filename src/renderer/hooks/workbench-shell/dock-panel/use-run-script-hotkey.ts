import { useCallback, useRef } from 'react';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import type { WorkspaceRunTargetSummary } from '@/renderer/types/workbench';

/**
 * Registers the ⌘/Ctrl+R (`run.start`) hotkey to toggle one run target
 * (ADR 0041): stop it while running, start it otherwise. Targets `runTargets`
 * the workspace last started or stopped through this hotkey, falling back to
 * the first configured target when none has been used yet — which reduces to
 * today's exact behavior for the common single-target repository. No-ops when
 * no run target is configured.
 *
 * The underlying {@link useHotkey} keeps its default `allowInTypeable: true` on
 * purpose — ⌘R must be captured, and its native browser reload suppressed, even
 * while a text field or the terminal's hidden textarea holds focus. This mirrors
 * the accelerator-less Reload menu item (see `application-menu.ts`); dropping the
 * capture would let ⌘R fall through to an Electron reload mid-edit.
 * @param runTargets - The workspace's configured run targets and their live status.
 * @param actions - Target-scoped start/stop callbacks for a run target.
 */
export function useRunScriptHotkey(
	runTargets: readonly WorkspaceRunTargetSummary[],
	actions: {
		onRunScript: (runTargetId: string) => void;
		onStopRunScript: (runTargetId: string) => void;
	},
): void {
	const { onRunScript, onStopRunScript } = actions;
	const lastUsedTargetIdRef = useRef<string | null>(null);

	const handleRunHotkey = useCallback(() => {
		const target =
			runTargets.find((entry) => entry.id === lastUsedTargetIdRef.current) ??
			runTargets[0];

		if (!target) {
			return;
		}

		lastUsedTargetIdRef.current = target.id;

		if (target.status === 'running') {
			onStopRunScript(target.id);
			return;
		}
		onRunScript(target.id);
	}, [onRunScript, onStopRunScript, runTargets]);

	useHotkey('run.start', handleRunHotkey);
}
