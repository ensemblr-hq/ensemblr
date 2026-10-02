import { WorkspaceConversationContent } from '@/renderer/components/workbench-shell/conversation-panel';

import { useWorkspaceMainContent } from '../shell-contexts';

/** Chat-route content — renders the workspace conversation surface. */
export function WorkspaceChatPage() {
	const mainContent = useWorkspaceMainContent();

	return <WorkspaceConversationContent {...mainContent} />;
}
