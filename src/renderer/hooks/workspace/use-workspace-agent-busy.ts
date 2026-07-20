import { useCallback, useEffect, useRef, useState } from 'react';
import { isHarnessTitleBusy } from '@/renderer/lib/terminal/harness-title';

/**
 * How long an agent terminal stays flagged busy after its last spinner-title
 * update. Comfortably longer than a spinner frame so a working agent stays lit,
 * short enough that going idle clears the indicator promptly.
 */
const AGENT_BUSY_IDLE_MS = 2000;

/** Live busy state of the agent terminals in one workspace. */
interface WorkspaceAgentBusyState {
	/** Terminal ids whose agent harness is actively working. */
	busyTerminalIds: ReadonlySet<string>;
	/** True when any agent terminal in the workspace is working. */
	isBusy: boolean;
}

/**
 * Reports whether any agent-harness terminal attached to `workspaceId` is
 * currently working, inferred from the spinner glyph the harness animates in its
 * OSC window title. This is the terminal-side analogue of `useWorkspacePiBusy`:
 * it subscribes to terminal lifecycle broadcasts (which carry `workspaceId` and
 * the session `kind`) so an inactive, non-focused sidebar row still lights up
 * while its agent is busy. Each spinner frame re-emits the title, so a per-
 * terminal idle timer keeps the flag lit between frames and clears it on stop.
 * @param workspaceId - Workspace whose agent terminals to watch.
 * @returns The busy terminal ids plus a workspace-level busy flag.
 */
export function useWorkspaceAgentBusy(
	workspaceId: string,
): WorkspaceAgentBusyState {
	const [busyTerminalIds, setBusyTerminalIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const idleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);

	/** Removes a terminal from the busy set and clears its pending idle timer. */
	const clearBusy = useCallback((terminalId: string) => {
		const timers = idleTimersRef.current;
		const existing = timers.get(terminalId);
		if (existing) {
			clearTimeout(existing);
			timers.delete(terminalId);
		}
		setBusyTerminalIds((previous) => {
			if (!previous.has(terminalId)) {
				return previous;
			}
			const next = new Set(previous);
			next.delete(terminalId);
			return next;
		});
	}, []);

	/** Marks a terminal busy until its harness stops animating for the idle window. */
	const markBusy = useCallback(
		(terminalId: string) => {
			setBusyTerminalIds((previous) =>
				previous.has(terminalId) ? previous : new Set(previous).add(terminalId),
			);
			const timers = idleTimersRef.current;
			const existing = timers.get(terminalId);
			if (existing) {
				clearTimeout(existing);
			}
			timers.set(
				terminalId,
				setTimeout(() => clearBusy(terminalId), AGENT_BUSY_IDLE_MS),
			);
		},
		[clearBusy],
	);

	useEffect(() => {
		const timers = idleTimersRef.current;
		setBusyTerminalIds(new Set());
		const unsubscribe = window.ensemblr?.onTerminalLifecycle((event) => {
			if (event.workspaceId !== workspaceId || event.session.kind !== 'agent') {
				return;
			}
			if (
				event.session.status !== 'running' ||
				!isHarnessTitleBusy(event.session.title)
			) {
				clearBusy(event.terminalId);
				return;
			}
			markBusy(event.terminalId);
		});
		return () => {
			unsubscribe?.();
			for (const timer of timers.values()) {
				clearTimeout(timer);
			}
			timers.clear();
		};
	}, [clearBusy, markBusy, workspaceId]);

	return { busyTerminalIds, isBusy: busyTerminalIds.size > 0 };
}
