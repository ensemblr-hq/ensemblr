import { useCallback, useEffect, useState } from 'react';
import { isHarnessTitleBusy } from '@/renderer/lib/terminal/harness-title';

/** Live busy state of the agent terminals in one workspace. */
interface WorkspaceAgentBusyState {
	/** Terminal ids whose agent harness is actively working. */
	busyTerminalIds: ReadonlySet<string>;
	/** True when any agent terminal in the workspace is working. */
	isBusy: boolean;
}

/**
 * Reports whether any agent-harness terminal attached to `workspaceId` is
 * currently working, inferred from the braille spinner glyph the harness animates
 * in its OSC window title or, for spinner-less harnesses (Vibe), from the
 * main-process `agentBusy` flag derived from the session log. This is the
 * terminal-side analogue of `useWorkspacePiBusy`: it subscribes to terminal
 * lifecycle broadcasts (which carry `workspaceId` and the session `kind`) so an
 * inactive, non-focused sidebar row still lights up while its agent is busy.
 *
 * Both signals are treated as authoritative levels, not decaying pulses: main
 * broadcasts a title change on every edge, and a harness leads its title with a
 * braille spinner while a turn is in flight and drops it (a plain or ✳-prefixed
 * title) the moment it goes idle. A harness re-emits its title only sporadically
 * mid-turn, so a decay timer would clear the flag while it is still working.
 * @param workspaceId - Workspace whose agent terminals to watch.
 * @returns The busy terminal ids plus a workspace-level busy flag.
 */
export function useWorkspaceAgentBusy(
	workspaceId: string,
): WorkspaceAgentBusyState {
	const [busyTerminalIds, setBusyTerminalIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	/** Adds a terminal to the busy set, holding the flag until an idle event clears it. */
	const markBusy = useCallback((terminalId: string) => {
		setBusyTerminalIds((previous) =>
			previous.has(terminalId) ? previous : new Set(previous).add(terminalId),
		);
	}, []);

	/** Removes a terminal from the busy set. */
	const clearBusy = useCallback((terminalId: string) => {
		setBusyTerminalIds((previous) => {
			if (!previous.has(terminalId)) {
				return previous;
			}
			const next = new Set(previous);
			next.delete(terminalId);
			return next;
		});
	}, []);

	useEffect(() => {
		setBusyTerminalIds(new Set());
		const unsubscribe = window.ensemblr?.onTerminalLifecycle((event) => {
			if (event.workspaceId !== workspaceId || event.session.kind !== 'agent') {
				return;
			}
			if (event.session.status !== 'running') {
				clearBusy(event.terminalId);
				return;
			}
			const busy =
				event.session.agentBusy || isHarnessTitleBusy(event.session.title);
			if (busy) {
				markBusy(event.terminalId);
			} else {
				clearBusy(event.terminalId);
			}
		});
		return () => {
			unsubscribe?.();
		};
	}, [clearBusy, markBusy, workspaceId]);

	return { busyTerminalIds, isBusy: busyTerminalIds.size > 0 };
}
