import { Icon } from '@iconify/react';
import { useAtomValue } from 'jotai';
import {
	BotIcon,
	BugIcon,
	HistoryIcon,
	MessageSquareIcon,
	PlusIcon,
	RotateCcwIcon,
} from 'lucide-react';
import { Reorder } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { TabScroller } from '@/renderer/components/ui/tab-scroller';
import { Tooltip, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useSessionTabOrder } from '@/renderer/hooks/workbench-shell/conversation-panel/use-session-tab-order';
import { useSessionTabShortcuts } from '@/renderer/hooks/workbench-shell/conversation-panel/use-session-tab-shortcuts';
import { cn } from '@/renderer/lib/utils';
import {
	harnessIconClassName,
	harnessIconName,
} from '@/renderer/lib/workbench';
import { useRequestComposerFocus } from '@/renderer/state/composer';
import { useMenuDynamicEntries } from '@/renderer/state/menu-commands';
import { useDebugPanelToggle } from '@/renderer/state/pi';
import { developerModeAtom } from '@/renderer/state/preferences';
import type { SessionTabModel } from '@/renderer/types/workbench';
import type { SessionTabPlacement } from '@/renderer/types/workbench-shell';
import { formatShortcut } from '@/shared/keymap';

import { ArchitectureDiagramButton } from './architecture-diagram/architecture-diagram-button';
import { GhostIconButton } from './ghost-icon-button';
import { HarnessLauncherMenu } from './harness-launcher/harness-launcher-menu';
import { SessionTab } from './session-tab';
import { ShortcutTooltipContent } from './shortcut-tooltip-content';

/** Display label for the new-chat-tab shortcut, e.g. `⌘T`. */
const NEW_TAB_SHORTCUT_HINT = formatShortcut('tab.new');

/** Horizontal session-tab bar with close, restore, new-tab, and drag-order controls. */
export function SessionTabs({
	activeSession,
	closedSessions,
	onLaunchHarness,
	onOpenArchitectureDiagram,
	onSessionTabClose,
	onSessionTabChange,
	onSessionTabOpen,
	onSessionTabPin,
	onSessionTabRestore,
	onSessionTabsReorder,
	sessions,
	unreadKeys,
}: {
	activeSession: SessionTabModel;
	closedSessions: SessionTabModel[];
	onLaunchHarness: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	/** Opens the workspace's architecture diagram tab. */
	onOpenArchitectureDiagram: () => Promise<{ chatTabId: string } | null>;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabOpen: (options?: {
		placement?: SessionTabPlacement;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabPin: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	onSessionTabsReorder: (
		sessionIds: string[],
		draggedSessionId: string,
	) => void;
	sessions: SessionTabModel[];
	/**
	 * Tab ids and session ids of this workspace's unread chats. Both, because a
	 * chat marked while the workspace was closed knows only its session id.
	 */
	unreadKeys: ReadonlySet<string>;
}) {
	const { t } = useTranslation();
	const [isOpening, setIsOpening] = useState(false);
	const requestComposerFocus = useRequestComposerFocus();
	const [debugOpen, setDebugOpen] = useDebugPanelToggle();
	const developerMode = useAtomValue(developerModeAtom);
	const openChatTabCount = useMemo(
		() =>
			sessions.filter((candidate) => (candidate.kind ?? 'chat') === 'chat')
				.length,
		[sessions],
	);
	const {
		canReorderTabs,
		handleReorder,
		handleReorderEnd,
		handleReorderStart,
		isDraggingTab,
		orderedSessionIds,
		sessionById,
	} = useSessionTabOrder({ onSessionTabsReorder, sessions });

	useEffect(() => {
		if (!developerMode && debugOpen) {
			setDebugOpen(false);
		}
	}, [debugOpen, developerMode, setDebugOpen]);

	/**
	 * Opens a chat tab through the workspace-level controller and selects it. The
	 * strip's own button is the one place a new tab appends rather than landing
	 * beside the active tab.
	 */
	function handleOpen() {
		if (isOpening) {
			return;
		}
		setIsOpening(true);
		void onSessionTabOpen({ placement: 'append' })
			.then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
					requestComposerFocus(result.chatTabId);
				}
			})
			.finally(() => setIsOpening(false));
	}

	/**
	 * Switches to a tab and, when it is a chat tab, queues composer focus so
	 * keyboard-driven tab switches land the caret in the composer.
	 * @param targetId - Session id of the tab to activate
	 */
	function selectSession(targetId: string) {
		onSessionTabChange(targetId);
		const target = sessionById.get(targetId);
		if ((target?.kind ?? 'chat') === 'chat') {
			requestComposerFocus(targetId);
		}
	}

	useSessionTabShortcuts({
		activeSessionId: activeSession.id,
		onOpenTab: handleOpen,
		onPinTab: onSessionTabPin,
		onSelectSession: selectSession,
		orderedSessionIds,
	});

	const chatTabEntries = useMemo(
		() =>
			orderedSessionIds.flatMap((sessionId) => {
				const session = sessionById.get(sessionId);
				return session
					? [{ id: session.id, label: session.fullLabel ?? session.label }]
					: [];
			}),
		[orderedSessionIds, sessionById],
	);
	useMenuDynamicEntries('chatTabs', chatTabEntries);

	return (
		<div className='flex h-10 shrink-0 items-center justify-between gap-3 border-border border-b bg-background pr-3'>
			<div className='flex h-full min-w-0 flex-1 items-center gap-1.5'>
				<TabScroller activeKey={activeSession.id} className='h-full'>
					<Reorder.Group
						axis='x'
						className='isolate m-0 flex h-full w-max min-w-full list-none p-0'
						onReorder={handleReorder}
						values={orderedSessionIds}
					>
						{orderedSessionIds.map((sessionId) => {
							const session = sessionById.get(sessionId);
							if (!session) {
								return null;
							}

							return (
								<SessionTab
									canReorderTabs={canReorderTabs}
									isActive={session.id === activeSession.id}
									isDraggingTab={isDraggingTab}
									key={session.id}
									onClose={onSessionTabClose}
									onDragEnd={() => handleReorderEnd(session.id)}
									onDragStart={handleReorderStart}
									onPin={onSessionTabPin}
									onSelect={onSessionTabChange}
									openChatTabCount={openChatTabCount}
									session={session}
									unreadKeys={unreadKeys}
								/>
							);
						})}
					</Reorder.Group>
				</TabScroller>
				<div className='flex shrink-0 items-center gap-1'>
					<Tooltip>
						<TooltipTrigger asChild>
							<GhostIconButton
								disabled={isOpening}
								icon={<PlusIcon />}
								label={t('workbench:session-tabs.new-tab', 'New chat tab')}
								onClick={handleOpen}
							/>
						</TooltipTrigger>
						<ShortcutTooltipContent
							label={t('workbench:session-tabs.new-tab', 'New chat tab')}
							shortcut={NEW_TAB_SHORTCUT_HINT}
						/>
					</Tooltip>
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				{developerMode ? (
					<Button
						aria-label={
							debugOpen
								? t('workbench:session-tabs.debug.hide', 'Hide Pi debug panel')
								: t('workbench:session-tabs.debug.show', 'Show Pi debug panel')
						}
						className={cn(debugOpen && 'bg-muted text-foreground')}
						onClick={() => setDebugOpen(!debugOpen)}
						size='icon-sm'
						title={t(
							'workbench:session-tabs.debug.title',
							'Pi raw frames (debug)',
						)}
						variant='ghost'
					>
						<BugIcon />
						<span className='sr-only'>
							{t(
								'workbench:session-tabs.debug.toggle',
								'Toggle Pi debug panel',
							)}
						</span>
					</Button>
				) : null}
				<ArchitectureDiagramButton
					onOpenArchitectureDiagram={onOpenArchitectureDiagram}
					onSessionTabChange={onSessionTabChange}
				/>
				<HarnessLauncherMenu
					onLaunchHarness={onLaunchHarness}
					onSessionTabChange={onSessionTabChange}
				/>
				<ClosedSessionHistoryMenu
					closedSessions={closedSessions}
					onSessionTabRestore={onSessionTabRestore}
				/>
			</div>
		</div>
	);
}

/**
 * Leading icon for a closed-history row: the harness brand logo for a closed
 * terminal (agent) tab, the bot glyph for a closed subagent chat, or the
 * generic chat glyph for a closed chat. Mirrors {@link SessionTabIcon} so a
 * conversation keeps the same icon in history.
 */
function ClosedSessionIcon({ session }: { session: SessionTabModel }) {
	if (session.kind === 'terminal') {
		const brandIconName = harnessIconName(session.harnessId);
		if (brandIconName) {
			return (
				<Icon
					aria-hidden='true'
					className={cn(
						'size-4 shrink-0 text-muted-foreground',
						harnessIconClassName(session.harnessId),
					)}
					icon={brandIconName}
				/>
			);
		}
		return (
			<BotIcon
				aria-hidden='true'
				className='size-4 shrink-0 text-muted-foreground'
			/>
		);
	}
	if (session.isSubAgent) {
		return (
			<BotIcon
				aria-hidden='true'
				className='size-4 shrink-0 text-muted-foreground'
			/>
		);
	}
	return (
		<MessageSquareIcon
			aria-hidden='true'
			className='size-4 shrink-0 text-muted-foreground'
		/>
	);
}

/** Dropdown listing recently-closed session tabs for restoration. */
function ClosedSessionHistoryMenu({
	closedSessions,
	onSessionTabRestore,
}: {
	closedSessions: SessionTabModel[];
	onSessionTabRestore: (sessionId: string) => void;
}) {
	const { t } = useTranslation();
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<GhostIconButton
							icon={<HistoryIcon />}
							label={t(
								'workbench:closed-tabs.trigger',
								'Open closed chat tabs',
							)}
						/>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<ShortcutTooltipContent
					label={t('workbench:closed-tabs.tooltip', 'Closed chat tabs')}
				/>
			</Tooltip>
			<DropdownMenuContent align='end' className='w-72 p-1'>
				{closedSessions.length ? (
					closedSessions.map((session) => (
						<DropdownMenuItem
							className='h-10 gap-2 px-2 text-[0.8125rem]'
							key={session.id}
							onSelect={() => onSessionTabRestore(session.id)}
						>
							<ClosedSessionIcon session={session} />
							<span className='min-w-0 flex-1 truncate font-medium'>
								{session.label}
							</span>
							<span className='shrink-0 text-muted-foreground text-xs'>
								{session.updatedLabel}
							</span>
							<RotateCcwIcon
								aria-hidden='true'
								className='size-3.5 shrink-0 text-muted-foreground'
							/>
						</DropdownMenuItem>
					))
				) : (
					<DropdownMenuItem
						className='h-9 px-2 text-muted-foreground text-xs'
						disabled
					>
						{t('workbench:closed-tabs.empty', 'No closed chat tabs')}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
