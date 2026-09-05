import { Icon } from '@iconify/react';
import {
	BotIcon,
	FileDiffIcon,
	FileIcon,
	FileTextIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	NetworkIcon,
	XIcon,
} from 'lucide-react';
import { Reorder } from 'motion/react';
import { type MouseEvent, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/renderer/lib/utils';
import {
	getWorkspaceFileIconNameForPath,
	harnessIconClassName,
	harnessIconName,
} from '@/renderer/lib/workbench';
import {
	SESSION_TAB_CLOSE_FADE_CLASS,
	sessionTabIndicatorVariants,
	sessionTabVariants,
} from '@/renderer/lib/workbench/session-tabs-variants';
import { shouldSelectOnTabClick } from '@/renderer/state/workspace';
import type { SessionTabModel } from '@/renderer/types/workbench';

/** Props for a single reorderable session tab. */
interface SessionTabProps {
	session: SessionTabModel;
	isActive: boolean;
	canReorderTabs: boolean;
	isDraggingTab: boolean;
	/** Ids of the workspace's unread chats; the tab matches itself against them. */
	unreadKeys: ReadonlySet<string>;
	/** Count of open chat tabs; a chat tab hides its close control when it is the last one. */
	openChatTabCount: number;
	onSelect: (sessionId: string) => void;
	onClose: (sessionId: string) => void;
	/** Promotes this tab out of the ephemeral preview slot. */
	onPin: (sessionId: string) => void;
	onDragStart: () => void;
	onDragEnd: () => void;
}

/** A single draggable session tab with select and hover-only close controls. */
export function SessionTab({
	session,
	isActive,
	canReorderTabs,
	isDraggingTab,
	openChatTabCount,
	onSelect,
	onClose,
	onPin,
	onDragStart,
	onDragEnd,
	unreadKeys,
}: SessionTabProps) {
	const isChatKind = (session.kind ?? 'chat') === 'chat';
	const canClose = isChatKind ? openChatTabCount > 1 : true;
	const showCloseControls = canClose && !isDraggingTab;
	const showUnreadDot =
		!isActive && !isDraggingTab && isSessionUnread(session, unreadKeys);
	const clickGuard = useTabClickGuard({
		onDragStart,
		onSelect: () => onSelect(session.id),
	});

	return (
		<Reorder.Item
			className={sessionTabVariants({ canReorder: canReorderTabs, isActive })}
			data-session-tab-reorderable={canReorderTabs}
			data-tab-key={session.id}
			dragElastic={canReorderTabs ? 0.08 : 0}
			dragListener={canReorderTabs}
			layout='position'
			onDragEnd={onDragEnd}
			onDragStart={clickGuard.handleDragStart}
			transition={isDraggingTab ? undefined : { layout: { duration: 0 } }}
			value={session.id}
			whileDrag={canReorderTabs ? { scale: 1.02, zIndex: 20 } : undefined}
		>
			<SessionTabLabel
				isActive={isActive}
				onClick={clickGuard.handleSelect}
				onPin={() => onPin(session.id)}
				onPointerDown={clickGuard.resetDrag}
				session={session}
				showUnreadDot={showUnreadDot}
			/>
			{showUnreadDot ? <SessionTabUnreadDot /> : null}
			{showCloseControls ? (
				<SessionTabCloseControls
					label={session.label}
					onClose={() => onClose(session.id)}
				/>
			) : null}
			<span
				aria-hidden='true'
				className={sessionTabIndicatorVariants({
					edge: 'top',
					tone: session.isSubAgent ? 'accent' : 'none',
				})}
			/>
			<span
				aria-hidden='true'
				className={sessionTabIndicatorVariants({
					edge: 'bottom',
					tone: isActive ? 'active' : 'none',
				})}
			/>
		</Reorder.Item>
	);
}

/**
 * Keeps the click that ends a drag from selecting the tab underneath it.
 *
 * Reorder fires a synthesized click on pointer-up, which is indistinguishable
 * from a real one except that a drag preceded it — so the drag is recorded and
 * spent on the next click rather than reaching the select handler.
 * @param options - What to run on a real drag start, and on a real selection
 * @returns The tab's drag-start, click, and pointer-down handlers
 */
function useTabClickGuard({
	onDragStart,
	onSelect,
}: {
	onDragStart: () => void;
	onSelect: () => void;
}) {
	const didDragRef = useRef(false);

	const handleDragStart = useCallback(() => {
		didDragRef.current = true;
		onDragStart();
	}, [onDragStart]);

	const handleSelect = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			const select = shouldSelectOnTabClick(didDragRef.current, event.detail);
			didDragRef.current = false;
			if (select) {
				onSelect();
			}
		},
		[onSelect],
	);

	const resetDrag = useCallback(() => {
		didDragRef.current = false;
	}, []);

	return { handleDragStart, handleSelect, resetDrag };
}

/** Props for the tab's selectable label region. */
interface SessionTabLabelProps {
	isActive: boolean;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	onPin: () => void;
	onPointerDown: () => void;
	session: SessionTabModel;
	/** Reserves trailing room for the dot the tab draws over this region. */
	showUnreadDot: boolean;
}

/** The tab's icon and title, as the button that selects or pins it. */
function SessionTabLabel({
	isActive,
	onClick,
	onPin,
	onPointerDown,
	session,
	showUnreadDot,
}: SessionTabLabelProps) {
	return (
		<button
			aria-current={isActive ? 'page' : undefined}
			className='flex h-full min-w-0 flex-1 cursor-inherit items-center gap-2 px-3 text-left'
			onClick={onClick}
			onDoubleClick={onPin}
			onPointerDown={onPointerDown}
			type='button'
		>
			<span className='grid size-3.5 shrink-0 place-items-center'>
				<SessionTabIcon session={session} />
			</span>
			<span
				className={cn(
					'truncate',
					session.isPreview && 'italic',
					showUnreadDot && 'pr-3 font-medium text-foreground',
				)}
				title={session.fullLabel ?? session.label}
			>
				{session.label}
			</span>
		</button>
	);
}

/** The dot marking a tab whose conversation has gone unread. */
function SessionTabUnreadDot() {
	const { t } = useTranslation();

	return (
		<span
			className='pointer-events-none absolute top-1/2 right-2 size-1.5 -translate-y-1/2 rounded-full bg-primary transition-opacity group-hover/session-tab:opacity-0'
			data-session-tab-unread='true'
		>
			<span className='sr-only'>
				{t('workbench:session-tabs.unread', 'Unread messages')}
			</span>
		</span>
	);
}

/** Hover-revealed close button, over the fade that keeps the title from running under it. */
function SessionTabCloseControls({
	label,
	onClose,
}: {
	label: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();

	return (
		<>
			<span aria-hidden='true' className={SESSION_TAB_CLOSE_FADE_CLASS} />
			<button
				aria-label={t(
					'workbench:session-tabs.close-tab',
					'Close {{label}} tab',
					{
						label,
					},
				)}
				className='absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-sm opacity-0 transition hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/session-tab:opacity-100'
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
				onPointerDown={(event) => event.stopPropagation()}
				type='button'
			>
				<XIcon aria-hidden='true' className='size-3' />
			</button>
		</>
	);
}

/**
 * Whether a tab holds something the user has not read, matched on either id
 * because a mark made while the workspace was closed carries only the session.
 * @param session - The tab to test
 * @param unreadKeys - Ids of the workspace's unread chats
 * @returns True when the tab is unread
 */
function isSessionUnread(
	session: SessionTabModel,
	unreadKeys: ReadonlySet<string>,
): boolean {
	if (unreadKeys.size === 0) {
		return false;
	}
	return (
		unreadKeys.has(session.chatTabId) ||
		(session.agentSessionId !== null && unreadKeys.has(session.agentSessionId))
	);
}

/** Renders the icon for a chat, diff, document, or file preview tab. */
function SessionTabIcon({ session }: { session: SessionTabModel }) {
	if (session.status === 'working') {
		return (
			<LoaderCircleIcon aria-hidden='true' className='size-3.5 animate-spin' />
		);
	}

	const fileIconName = iconNameForFilePreviewTab(session);
	if (fileIconName) {
		return <Icon aria-hidden='true' className='size-3.5' icon={fileIconName} />;
	}

	if (session.kind === 'terminal') {
		const brandIconName = harnessIconName(session.harnessId);
		if (brandIconName) {
			return (
				<Icon
					aria-hidden='true'
					className={cn('size-3.5', harnessIconClassName(session.harnessId))}
					icon={brandIconName}
				/>
			);
		}
	}

	if (session.isSubAgent) {
		return <BotIcon aria-hidden='true' className='size-3.5' />;
	}

	const TabIcon = iconForTabKind(session.kind ?? 'chat');
	return <TabIcon aria-hidden='true' className='size-3.5' />;
}

/** Returns a VSCode icon name for file-backed tabs that have a file path. */
function iconNameForFilePreviewTab(session: SessionTabModel): string | null {
	if (
		(session.kind === 'document' ||
			session.kind === 'file' ||
			session.kind === 'preview') &&
		session.filePath
	) {
		return getWorkspaceFileIconNameForPath(session.filePath);
	}

	return null;
}

/** Returns the generic icon component for non-file-backed tab kinds. */
function iconForTabKind(kind: NonNullable<SessionTabModel['kind']>) {
	switch (kind) {
		case 'diagram':
			return NetworkIcon;
		case 'diff':
			return FileDiffIcon;
		case 'document':
			return FileTextIcon;
		case 'file':
		case 'preview':
			return FileIcon;
		case 'terminal':
			return BotIcon;
		default:
			return MessageSquareIcon;
	}
}
