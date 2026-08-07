import { useWorkspaceAgentBusy } from './use-workspace-agent-busy';
import { useWorkspaceAgentSessionBusy } from './use-workspace-agent-session-busy';

/**
 * Reports whether a workspace shows live agent activity from any source: an
 * agent runtime session that is starting or streaming, or an agent-harness
 * terminal whose TUI is animating its spinner. This is the single busy signal
 * the workspace sidebar rows and dashboard cards render, so both kinds of agent
 * light the same indicator.
 * @param workspaceId - Workspace to report activity for.
 * @returns True when any agent attached to the workspace is working.
 */
export function useWorkspaceBusy(workspaceId: string): boolean {
	const sessionBusy = useWorkspaceAgentSessionBusy(workspaceId);
	const { isBusy: terminalBusy } = useWorkspaceAgentBusy(workspaceId);
	return sessionBusy || terminalBusy;
}
