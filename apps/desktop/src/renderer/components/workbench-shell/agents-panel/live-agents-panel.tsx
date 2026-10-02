import { memo } from 'react';

import { AgentsPanel } from '@/renderer/components/workbench-shell/agents-panel/agents-panel';
import { useAgentsPanelState } from '@/renderer/state/agents';
import type { AgentsPanelNavigation } from '@/renderer/types/agents';

/**
 * The Agents tab's body, backed by the workspace's live conversations. It owns
 * the panel's model so that model is built only while the tab is showing — the
 * shell above it never re-renders for an agent's activity — and it is memoized
 * so an unrelated render of the review panel does not rebuild the tree.
 */
export const LiveAgentsPanel = memo(function LiveAgentsPanel({
	navigation,
	workspaceId,
}: {
	navigation: AgentsPanelNavigation;
	workspaceId: string;
}) {
	const panel = useAgentsPanelState({ ...navigation, workspaceId });
	return <AgentsPanel {...panel} />;
});
