import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentsPanel } from '@/renderer/components/workbench-shell/agents-panel/agents-panel';
import { ReviewPanelTabsHeader } from '@/renderer/components/workbench-shell/review-panel';
import { ReviewRailFrame } from '@/renderer/components/workbench-shell/review-rail';
import type {
	AgentConversation,
	AgentsPanelState,
} from '@/renderer/types/agents';

type FixturePanelTab = 'agents' | 'changes' | 'checks' | 'files';

/** Integrated fixture-fed right sidebar with the real tab header and Agents panel. */
export function AgentsSidebarPreview({
	conversations,
	onRestore,
	onRetry,
	onSelect,
	selectedChatTabId,
	state = 'ready',
}: {
	conversations: readonly AgentConversation[];
	onRestore: (chatTabId: string) => void;
	onRetry?: () => void;
	onSelect: (chatTabId: string) => void;
	selectedChatTabId: string | null;
	state?: AgentsPanelState;
}) {
	const { t } = useTranslation();
	const [activeTab, setActiveTab] = useState<FixturePanelTab>('agents');
	const tabs: readonly {
		count?: number;
		id: FixturePanelTab;
		label: string;
	}[] = [
		{
			count: conversations.filter((conversation) => !conversation.isClosed)
				.length,
			id: 'agents',
			label: t('workbench:agents.label', 'Agents'),
		},
		{
			id: 'files',
			label: t('review:review-panel.tabs.files', 'All files'),
		},
		{
			count: 7,
			id: 'changes',
			label: t('review:review-panel.tabs.changes', 'Changes'),
		},
		{
			id: 'checks',
			label: t('review:review-panel.tabs.checks', 'Checks'),
		},
	];

	return (
		<ReviewRailFrame>
			<ReviewPanelTabsHeader
				activeTab={activeTab}
				onTabChange={setActiveTab}
				tabs={tabs}
			/>
			{activeTab === 'agents' ? (
				<AgentsPanel
					conversations={conversations}
					onRestore={onRestore}
					onRetry={onRetry}
					onSelect={onSelect}
					selectedChatTabId={selectedChatTabId}
					state={state}
				/>
			) : (
				<div className='min-h-0 flex-1 bg-background' />
			)}
		</ReviewRailFrame>
	);
}
