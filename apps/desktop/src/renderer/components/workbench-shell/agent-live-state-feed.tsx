import { useAgentLiveStateFeed } from '@/renderer/state/agents';

/**
 * Renderless keeper of one workspace's live agent state. The workspace shell
 * mounts it whichever review tab or sheet is showing, so the Agents panel, the
 * close guard, and the sidebar all read state that is already current.
 */
export function AgentLiveStateFeed({ workspaceId }: { workspaceId: string }) {
	useAgentLiveStateFeed(workspaceId);
	return null;
}
