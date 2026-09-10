import { createStore, Provider } from 'jotai';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { SessionTabs } from '@/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { ReviewRailSheetHost } from '@/renderer/components/workbench-shell/review-rail';
import { useWorkbenchLayout } from '@/renderer/components/workbench-shell/shell-contexts';
import { cn } from '@/renderer/lib/utils';
import {
	chatAfkModeAtomFamily,
	chatPlanModeAtomFamily,
} from '@/renderer/state/preferences';
import type { AgentConversation } from '@/renderer/types/agents';
import type { SessionTabModel } from '@/renderer/types/workbench';
import {
	AGENTS_FILE_PREVIEW,
	agentSessionTab,
	createAgentConversations,
} from './agents-fixtures.ts';
import { AgentsSidebarPreview } from './agents-sidebar-preview.tsx';
import {
	ControlGroup,
	SceneControls,
	SceneLanguageControl,
	SceneToggle,
} from './scene-chrome.tsx';
import { StubbedWorkbenchLayout } from './stubbed-workbench-layout.tsx';

/** Interactive fixture wiring shared by the desktop rail and narrow sheet scene. */
function AgentsNavigationWorkbench({
	initialRestoreFailure,
	isNarrow,
}: {
	initialRestoreFailure: boolean;
	isNarrow: boolean;
}) {
	const { actions } = useWorkbenchLayout();
	const setSheetOpen = actions.setRightSidebarSheetOpen;
	const [conversations, setConversations] = useState(() =>
		createAgentConversations(),
	);
	const [selectedId, setSelectedId] = useState('root-roadmap');
	const [previewTab, setPreviewTab] = useState<SessionTabModel | null>(
		AGENTS_FILE_PREVIEW,
	);
	const [order, setOrder] = useState(() => [
		...conversations.flatMap((conversation) =>
			conversation.isClosed ? [] : [conversation.chatTabId],
		),
		AGENTS_FILE_PREVIEW.id,
	]);
	const [restoreFailurePending, setRestoreFailurePending] = useState(
		initialRestoreFailure,
	);
	const sessions = useMemo(
		() =>
			order.flatMap((id) => {
				if (previewTab?.id === id) return [previewTab];
				const conversation = conversations.find(
					(candidate) => candidate.chatTabId === id && !candidate.isClosed,
				);
				if (!conversation) {
					return [];
				}
				return [agentSessionTab(conversation)];
			}),
		[conversations, order, previewTab],
	);
	const closedSessions = conversations.flatMap((conversation) =>
		conversation.isClosed ? [agentSessionTab(conversation)] : [],
	);
	const activeSession =
		sessions.find((session) => session.id === selectedId) ?? sessions[0];

	useEffect(() => {
		if (isNarrow) {
			setSheetOpen(true);
		}
	}, [isNarrow, setSheetOpen]);

	const select = (chatTabId: string) => {
		setSelectedId(chatTabId);
		if (isNarrow) {
			setSheetOpen(false);
		}
	};
	const restore = (chatTabId: string) => {
		if (restoreFailurePending && chatTabId === 'closed-audit') {
			setRestoreFailurePending(false);
			setConversations((current) =>
				current.map((conversation) =>
					conversation.chatTabId === chatTabId
						? { ...conversation, restoreState: 'error' }
						: conversation,
				),
			);
			return;
		}
		setConversations((current) =>
			current.map((conversation) =>
				conversation.chatTabId === chatTabId
					? { ...conversation, isClosed: false, restoreState: 'idle' }
					: conversation,
			),
		);
		setOrder((current) =>
			current.includes(chatTabId) ? current : [...current, chatTabId],
		);
		select(chatTabId);
	};
	const close = (chatTabId: string) => {
		if (sessions.length === 1) {
			return;
		}
		const closedIndex = sessions.findIndex(
			(session) => session.id === chatTabId,
		);
		const survivor = sessions[closedIndex + 1] ?? sessions[closedIndex - 1];
		if (previewTab?.id === chatTabId) setPreviewTab(null);
		setConversations((current) =>
			current.map((conversation) =>
				conversation.chatTabId === chatTabId
					? { ...conversation, isClosed: true, restoreState: 'idle' }
					: conversation,
			),
		);
		setOrder((current) => current.filter((id) => id !== chatTabId));
		if (selectedId === chatTabId && survivor) {
			setSelectedId(survivor.id);
		}
	};
	const openSession = async () => {
		const chatTabId = `new-root-${conversations.length}`;
		const conversation: AgentConversation = {
			chatTabId,
			contextUsage: null,
			depth: 0,
			isClosed: false,
			model: null,
			parentChatTabId: null,
			status: 'idle',
			title: 'New fixture chat',
		};
		setConversations((current) => [...current, conversation]);
		setOrder((current) => [...current, chatTabId]);
		return { chatTabId };
	};

	if (!activeSession) {
		return null;
	}

	const rail = (onDismiss?: () => void) => (
		<div className='h-full' data-testid='agents-fixture-rail'>
			{onDismiss ? (
				<Button
					className='absolute top-2 right-2 z-10'
					onClick={onDismiss}
					size='xs'
					variant='ghost'
				>
					Dismiss
				</Button>
			) : null}
			<AgentsSidebarPreview
				conversations={conversations}
				onRestore={restore}
				onSelect={select}
				selectedChatTabId={selectedId}
			/>
		</div>
	);

	return (
		<div className='overflow-hidden rounded-lg border border-border bg-background shadow-panel'>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={closedSessions}
				onLaunchHarness={async () => null}
				onOpenArchitectureDiagram={async () => null}
				onSessionTabChange={select}
				onSessionTabClose={close}
				onSessionTabOpen={openSession}
				onSessionTabPin={(id) =>
					setPreviewTab((current) =>
						current?.id === id ? { ...current, isPreview: false } : current,
					)
				}
				onSessionTabRestore={restore}
				onSessionTabsReorder={(ids) => setOrder(ids)}
				sessions={sessions}
				unreadKeys={new Set(['leaf-copy', 'root-review'])}
			/>
			<div
				className={cn(
					'grid h-128',
					isNarrow
						? 'grid-cols-1'
						: 'grid-cols-[minmax(0,1fr)_minmax(18rem,34%)]',
				)}
			>
				<main className='flex min-w-0 flex-col items-center justify-center gap-3 bg-canvas/40 p-8'>
					<p className='max-w-md truncate font-medium text-sm'>
						{activeSession.label}
					</p>
					{isNarrow ? (
						<Button onClick={() => setSheetOpen(true)}>
							Open agents sidebar
						</Button>
					) : null}
				</main>
				{isNarrow ? null : rail()}
			</div>
			{isNarrow ? (
				<ReviewRailSheetHost
					description='Fixture-fed workspace agent conversations.'
					title='Agents sidebar'
				>
					{(onDismiss) => rail(onDismiss)}
				</ReviewRailSheetHost>
			) : null}
		</div>
	);
}

/** Integrated Agents sidebar and tab-strip scene with local navigation state. */
export function AgentsNavigationScene({
	initialNarrow = false,
	initialRestoreFailure = false,
}: {
	initialNarrow?: boolean;
	initialRestoreFailure?: boolean;
} = {}) {
	const [isNarrow, setIsNarrow] = useState(initialNarrow);
	const [restoreFailure, setRestoreFailure] = useState(initialRestoreFailure);
	const [resetKey, setResetKey] = useState(0);
	const [store] = useState(() => {
		const fixtureStore = createStore();
		fixtureStore.set(chatPlanModeAtomFamily('child-fixtures'), true);
		fixtureStore.set(chatAfkModeAtomFamily('root-review'), true);
		return fixtureStore;
	});

	return (
		<Provider store={store}>
			<SceneControls>
				<ControlGroup label='viewport'>
					<SceneToggle
						isActive={!isNarrow}
						label='desktop'
						onClick={() => setIsNarrow(false)}
					/>
					<SceneToggle
						isActive={isNarrow}
						label='forced narrow sheet'
						onClick={() => setIsNarrow(true)}
					/>
				</ControlGroup>
				<ControlGroup label='restore'>
					<SceneToggle
						isActive={!restoreFailure}
						label='success'
						onClick={() => {
							setRestoreFailure(false);
							setResetKey((current) => current + 1);
						}}
					/>
					<SceneToggle
						isActive={restoreFailure}
						label='fail once'
						onClick={() => {
							setRestoreFailure(true);
							setResetKey((current) => current + 1);
						}}
					/>
				</ControlGroup>
				<SceneLanguageControl />
				<ControlGroup label='fixture'>
					<SceneToggle
						isActive={false}
						label='reset'
						onClick={() => setResetKey((current) => current + 1)}
					/>
				</ControlGroup>
			</SceneControls>
			<StubbedWorkbenchLayout
				initialRightSidebarSheetOpen={initialNarrow}
				isNarrowViewport={isNarrow}
				key={resetKey}
			>
				<AgentsNavigationWorkbench
					initialRestoreFailure={restoreFailure}
					isNarrow={isNarrow}
				/>
			</StubbedWorkbenchLayout>
		</Provider>
	);
}
