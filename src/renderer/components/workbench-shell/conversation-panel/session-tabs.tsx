import { Icon } from '@iconify/react';
import {
	BugIcon,
	FileDiffIcon,
	FileIcon,
	FileTextIcon,
	HistoryIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	PlusIcon,
	RotateCcwIcon,
	XIcon,
} from 'lucide-react';
import { Reorder } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	areStringArraysEqual,
	reconcileOrderedIds,
} from '@/renderer/lib/ordered-ids';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceFileIconNameForPath } from '@/renderer/lib/workbench';
import { useDebugPanelToggle } from '@/renderer/state/pi';
import type { SessionTabModel } from '@/renderer/types/workbench';

/** Horizontal session-tab bar with close, restore, new-tab, and drag-order controls. */
export function SessionTabs({
	activeSession,
	closedSessions,
	onSessionTabClose,
	onSessionTabChange,
	onSessionTabOpen,
	onSessionTabRestore,
	onSessionTabsReorder,
	sessions,
}: {
	activeSession: SessionTabModel;
	closedSessions: SessionTabModel[];
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabOpen: () => Promise<{ chatTabId: string } | null>;
	onSessionTabRestore: (sessionId: string) => void;
	onSessionTabsReorder: (sessionIds: string[]) => void;
	sessions: SessionTabModel[];
}) {
	const [isOpening, setIsOpening] = useState(false);
	const [debugOpen, setDebugOpen] = useDebugPanelToggle();
	const sessionIds = useMemo(
		() => sessions.map((session) => session.id),
		[sessions],
	);
	const sessionById = useMemo(
		() => new Map(sessions.map((session) => [session.id, session] as const)),
		[sessions],
	);
	const openChatTabCount = useMemo(
		() =>
			sessions.filter((candidate) => (candidate.kind ?? 'chat') === 'chat')
				.length,
		[sessions],
	);
	const [orderedSessionIds, setOrderedSessionIds] =
		useState<string[]>(sessionIds);
	const [isDraggingTab, setIsDraggingTab] = useState(false);
	const orderedSessionIdsRef = useRef(orderedSessionIds);
	const canReorderTabs = sessionIds.length > 1;

	useEffect(() => {
		setOrderedSessionIds((currentIds) => {
			const nextIds = reconcileOrderedIds(currentIds, sessionIds);
			orderedSessionIdsRef.current = nextIds;
			return areStringArraysEqual(nextIds, currentIds) ? currentIds : nextIds;
		});
	}, [sessionIds]);

	/** Opens a chat tab through the workspace-level controller and selects it. */
	function handleOpen() {
		if (isOpening) {
			return;
		}
		setIsOpening(true);
		void onSessionTabOpen()
			.then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			})
			.finally(() => setIsOpening(false));
	}

	/** Hides hover-only controls while a tab is being reordered. */
	function handleReorderStart() {
		if (!canReorderTabs) {
			return;
		}
		setIsDraggingTab(true);
	}

	/** Applies motion's in-drag order to local state while the user moves a tab. */
	function handleReorder(nextIds: string[]) {
		if (!canReorderTabs) {
			return;
		}
		orderedSessionIdsRef.current = nextIds;
		setOrderedSessionIds(nextIds);
	}

	/** Commits the final dragged order to the workspace tab controller. */
	function handleReorderEnd() {
		setIsDraggingTab(false);
		if (!canReorderTabs) {
			return;
		}
		const nextIds = orderedSessionIdsRef.current;
		if (areStringArraysEqual(nextIds, sessionIds)) {
			return;
		}
		onSessionTabsReorder(nextIds);
	}

	return (
		<div className='flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b bg-background px-3'>
			<div className='flex min-w-0 flex-1 items-center gap-1.5'>
				<Reorder.Group
					axis='x'
					className='no-scrollbar m-0 flex min-w-0 list-none gap-1 overflow-x-auto p-0'
					onReorder={handleReorder}
					values={orderedSessionIds}
				>
					{orderedSessionIds.map((sessionId) => {
						const session = sessionById.get(sessionId);
						if (!session) {
							return null;
						}

						const isActive = session.id === activeSession.id;
						const isChatKind = (session.kind ?? 'chat') === 'chat';
						const canClose = isChatKind ? openChatTabCount > 1 : true;
						const showCloseControls = canClose && !isDraggingTab;

						return (
							<Reorder.Item
								className={cn(
									'group/session-tab relative m-0 flex h-12 min-w-30 max-w-52 flex-none items-center overflow-hidden border-transparent border-b-2 bg-clip-padding p-0 text-xs transition-colors',
									canReorderTabs && 'cursor-grab active:cursor-grabbing',
									isActive
										? 'border-primary bg-muted text-foreground'
										: 'bg-background text-muted-foreground hover:text-foreground',
								)}
								data-session-tab-reorderable={canReorderTabs}
								dragElastic={canReorderTabs ? 0.08 : 0}
								dragListener={canReorderTabs}
								key={session.id}
								layout='position'
								onDragEnd={handleReorderEnd}
								onDragStart={handleReorderStart}
								value={session.id}
								whileDrag={
									canReorderTabs ? { scale: 1.02, zIndex: 20 } : undefined
								}
							>
								<button
									aria-current={isActive ? 'page' : undefined}
									className='flex h-full min-w-0 flex-1 cursor-inherit items-center gap-2 px-3 text-left'
									onClick={() => onSessionTabChange(session.id)}
									type='button'
								>
									<span className='grid size-3.5 shrink-0 place-items-center'>
										<SessionTabIcon session={session} />
									</span>
									<span className='truncate'>{session.label}</span>
								</button>
								{showCloseControls ? (
									<span
										aria-hidden='true'
										className={cn(
											'pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l to-transparent opacity-0 transition-opacity group-hover/session-tab:opacity-100',
											isActive
												? 'from-muted via-muted/90'
												: 'from-background via-background/90',
										)}
									/>
								) : null}
								{showCloseControls ? (
									<button
										aria-label={`Close ${session.label} tab`}
										className='absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-sm opacity-0 transition-all hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/session-tab:opacity-100'
										onClick={(event) => {
											event.stopPropagation();
											onSessionTabClose(session.id);
										}}
										onPointerDown={(event) => event.stopPropagation()}
										type='button'
									>
										<XIcon aria-hidden='true' className='size-3' />
									</button>
								) : null}
							</Reorder.Item>
						);
					})}
				</Reorder.Group>
				<div className='flex shrink-0 items-center gap-1'>
					<Button
						disabled={isOpening}
						onClick={handleOpen}
						size='icon-sm'
						variant='ghost'
					>
						<PlusIcon />
						<span className='sr-only'>New chat tab</span>
					</Button>
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				<Button
					aria-label={debugOpen ? 'Hide Pi debug panel' : 'Show Pi debug panel'}
					className={cn(debugOpen && 'bg-muted text-foreground')}
					onClick={() => setDebugOpen(!debugOpen)}
					size='icon-sm'
					title='Pi raw frames (debug)'
					variant='ghost'
				>
					<BugIcon />
					<span className='sr-only'>Toggle Pi debug panel</span>
				</Button>
				<ClosedSessionHistoryMenu
					closedSessions={closedSessions}
					onSessionTabRestore={onSessionTabRestore}
				/>
			</div>
		</div>
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
		case 'diff':
			return FileDiffIcon;
		case 'document':
			return FileTextIcon;
		case 'file':
		case 'preview':
			return FileIcon;
		default:
			return MessageSquareIcon;
	}
}

/** Dropdown listing recently-closed session tabs for restoration. */
function ClosedSessionHistoryMenu({
	closedSessions,
	onSessionTabRestore,
}: {
	closedSessions: SessionTabModel[];
	onSessionTabRestore: (sessionId: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<HistoryIcon />
					<span className='sr-only'>Open closed chat tabs</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-72 p-1'>
				{closedSessions.length ? (
					closedSessions.map((session) => (
						<DropdownMenuItem
							className='h-10 gap-2 px-2 text-[0.8125rem]'
							key={session.id}
							onSelect={() => onSessionTabRestore(session.id)}
						>
							<MessageSquareIcon
								aria-hidden='true'
								className='size-4 shrink-0 text-muted-foreground'
							/>
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
						No closed chat tabs
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
