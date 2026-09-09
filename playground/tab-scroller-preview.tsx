import { BotIcon, MessageSquareIcon, SquareTerminalIcon } from 'lucide-react';
import { useState } from 'react';

import { ParentConversationButton } from '@/renderer/components/workbench-shell/conversation-panel/parent-conversation-button';
import { SessionTabs } from '@/renderer/components/workbench-shell/conversation-panel/session-tabs';
import type { SessionTabModel } from '@/renderer/types/workbench';

const TABS: readonly SessionTabModel[] = [
	{
		agentSessionId: 'orchestrator-session',
		chatTabId: 'orchestrator',
		id: 'orchestrator',
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: 'Tighten subagent tabs',
		status: 'idle',
		summary: '',
		updatedLabel: '',
	},
	...[
		['child-rendering', 'Inspect tab rendering'],
		['child-lineage', 'Trace parent lineage'],
		['child-a11y', 'Check tab accessibility'],
		['child-tests', 'Find coverage gaps'],
	].map(([id, label]) => ({
		agentSessionId: `${id}-session`,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent: true,
		kind: 'chat' as const,
		label,
		parentChatTabId: 'orchestrator',
		status: 'idle' as const,
		summary: '',
		updatedLabel: '',
	})),
	{
		agentSessionId: 'terminal-session',
		chatTabId: 'terminal',
		harnessId: 'claude-code',
		harnessLabel: 'Claude Code',
		harnessSessionId: null,
		id: 'terminal',
		isPreview: false,
		isSubAgent: false,
		kind: 'terminal',
		label: 'claude',
		status: 'idle',
		summary: '',
		terminalId: 'terminal-session',
		updatedLabel: '',
	},
	{
		agentSessionId: 'review-session',
		chatTabId: 'review',
		id: 'review',
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: 'Review PR 188',
		status: 'idle',
		summary: '',
		updatedLabel: '',
	},
];

/** Renders the shipped session-tab treatment against fixture conversations. */
export function TabScrollerScene() {
	const [activeId, setActiveId] = useState('child-rendering');
	const activeTab = TABS.find((tab) => tab.id === activeId) ?? TABS[0];
	const parentTab = activeTab.parentChatTabId
		? TABS.find((tab) => tab.id === activeTab.parentChatTabId)
		: undefined;

	return (
		<div className='flex flex-col gap-6'>
			<p className='max-w-3xl text-muted-foreground text-xs'>
				Inactive subagent tabs collapse to their bot icon. Select one to expand
				its title; inside its pane, use the floating parent button to jump back
				to the orchestrator.
			</p>
			<div className='overflow-hidden rounded-lg border border-border bg-background shadow-panel'>
				<SessionTabs
					activeSession={activeTab}
					closedSessions={[]}
					onLaunchHarness={async () => null}
					onOpenArchitectureDiagram={async () => null}
					onSessionTabChange={setActiveId}
					onSessionTabClose={() => undefined}
					onSessionTabOpen={async () => null}
					onSessionTabPin={() => undefined}
					onSessionTabRestore={() => undefined}
					onSessionTabsReorder={() => undefined}
					sessions={[...TABS]}
					unreadKeys={new Set()}
				/>
				<FixturePane
					activeTab={activeTab}
					onSelect={setActiveId}
					parentTab={parentTab}
				/>
			</div>
		</div>
	);
}

/** Keeps the fixture pane useful without duplicating production tab chrome. */
function FixturePane({
	activeTab,
	onSelect,
	parentTab,
}: {
	activeTab: SessionTabModel;
	onSelect: (id: string) => void;
	parentTab?: SessionTabModel;
}) {
	return (
		<div className='relative min-h-96 bg-canvas/40'>
			{parentTab ? (
				<ParentConversationButton
					onNavigate={() => onSelect(parentTab.id)}
					parent={parentTab}
				/>
			) : null}
			<div className='mx-auto flex max-w-2xl flex-col gap-5 px-8 pt-20 pb-12'>
				<div className='flex items-center gap-3'>
					<span className='grid size-9 place-items-center rounded-full bg-pane-strong text-muted-foreground'>
						<TabIcon session={activeTab} />
					</span>
					<div className='min-w-0'>
						<h2 className='truncate font-medium text-sm'>{activeTab.label}</h2>
						<p className='text-muted-foreground text-xs'>
							{activeTab.isSubAgent
								? 'Subagent conversation'
								: 'Orchestrator conversation'}
						</p>
					</div>
				</div>
				<div className='rounded-xl bg-pane/80 px-4 py-3 text-sm leading-6 shadow-panel'>
					{activeTab.isSubAgent
						? 'I am tracing this focused task and will return a concise report to the parent orchestrator.'
						: 'I split the investigation into focused subagents. Their compact tabs stay available without crowding this strip.'}
				</div>
			</div>
		</div>
	);
}

/** Renders the identity glyph for a fixture conversation. */
function TabIcon({ session }: { session: SessionTabModel }) {
	if (session.isSubAgent) {
		return <BotIcon aria-hidden='true' className='size-3.5 shrink-0' />;
	}
	if (session.kind === 'terminal') {
		return (
			<SquareTerminalIcon aria-hidden='true' className='size-3.5 shrink-0' />
		);
	}
	return <MessageSquareIcon aria-hidden='true' className='size-3.5 shrink-0' />;
}
