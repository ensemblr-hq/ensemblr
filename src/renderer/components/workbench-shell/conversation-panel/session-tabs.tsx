import { Icon } from '@iconify/react';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import {
	BotIcon,
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
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import {
	areStringArraysEqual,
	reconcileOrderedIds,
} from '@/renderer/lib/ordered-ids';
import { cn } from '@/renderer/lib/utils';
import {
	getWorkspaceFileIconNameForPath,
	harnessIconClassName,
	harnessIconName,
} from '@/renderer/lib/workbench';
import { useRequestComposerFocus } from '@/renderer/state/composer';
import { useDebugPanelToggle } from '@/renderer/state/pi';
import { developerModeAtom } from '@/renderer/state/preferences';
import { shouldSelectOnTabClick } from '@/renderer/state/workspace';
import type { SessionTabModel } from '@/renderer/types/workbench';
import { formatShortcut } from '@/shared/keymap';

/** Display label for the coding-agent launcher shortcut, e.g. `⌘⇧A`. */
const AGENTS_SHORTCUT_HINT = formatShortcut('agents.open');

/** Display label for the new-chat-tab shortcut, e.g. `⌘T`. */
const NEW_TAB_SHORTCUT_HINT = formatShortcut('tab.new');

/**
 * Ghost `icon-sm` button carrying a screen-reader-only label. Forwards its ref
 * and props so it can back a Radix `asChild` trigger (tooltip, dropdown).
 */
const GhostIconButton = forwardRef<
	HTMLButtonElement,
	{ icon: ReactNode; label: string } & ComponentPropsWithoutRef<typeof Button>
>(({ icon, label, ...props }, ref) => (
	<Button ref={ref} size='icon-sm' variant='ghost' {...props}>
		{icon}
		<span className='sr-only'>{label}</span>
	</Button>
));
GhostIconButton.displayName = 'GhostIconButton';

/** Tooltip body pairing a label with an optional keyboard-shortcut chip. */
function ShortcutTooltipContent({
	label,
	shortcut,
}: {
	label: string;
	shortcut?: string;
}) {
	return (
		<TooltipContent>
			{label}
			{shortcut ? <kbd className='font-sans'>{shortcut}</kbd> : null}
		</TooltipContent>
	);
}

/** Horizontal session-tab bar with close, restore, new-tab, and drag-order controls. */
export function SessionTabs({
	activeSession,
	closedSessions,
	onLaunchHarness,
	onSessionTabClose,
	onSessionTabChange,
	onSessionTabOpen,
	onSessionTabRestore,
	onSessionTabsReorder,
	sessions,
}: {
	activeSession: SessionTabModel;
	closedSessions: SessionTabModel[];
	onLaunchHarness: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabOpen: () => Promise<{ chatTabId: string } | null>;
	onSessionTabRestore: (sessionId: string) => void;
	onSessionTabsReorder: (sessionIds: string[]) => void;
	sessions: SessionTabModel[];
}) {
	const [isOpening, setIsOpening] = useState(false);
	const requestComposerFocus = useRequestComposerFocus();
	const [debugOpen, setDebugOpen] = useDebugPanelToggle();
	const developerMode = useAtomValue(developerModeAtom);
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

	useHotkey('tab.new', () => handleOpen());
	useHotkey('tab.next', () => cycleTab(1));
	useHotkey('tab.prev', () => cycleTab(-1));
	useHotkey('tab.selectByIndex', (event) => {
		const position = Number.parseInt(event.key, 10);
		if (!Number.isNaN(position)) {
			selectTabByPosition(position);
		}
	});

	useEffect(() => {
		orderedSessionIdsRef.current = orderedSessionIds;
	}, [orderedSessionIds]);

	useEffect(() => {
		setOrderedSessionIds((currentIds) => {
			const nextIds = reconcileOrderedIds(currentIds, sessionIds);
			return areStringArraysEqual(nextIds, currentIds) ? currentIds : nextIds;
		});
	}, [sessionIds]);

	useEffect(() => {
		if (!developerMode && debugOpen) {
			setDebugOpen(false);
		}
	}, [debugOpen, developerMode, setDebugOpen]);

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
					requestComposerFocus(result.chatTabId);
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

	/** Selects the tab `offset` positions from the active one, wrapping around. */
	function cycleTab(offset: number) {
		if (orderedSessionIds.length < 2) {
			return;
		}
		const activeIndex = orderedSessionIds.indexOf(activeSession.id);
		const base = activeIndex === -1 ? 0 : activeIndex;
		const nextIndex =
			(base + offset + orderedSessionIds.length) % orderedSessionIds.length;
		onSessionTabChange(orderedSessionIds[nextIndex]);
	}

	/** Selects a tab by its 1-based position; `9` always jumps to the last tab. */
	function selectTabByPosition(position: number) {
		if (!orderedSessionIds.length) {
			return;
		}
		const index = position === 9 ? orderedSessionIds.length - 1 : position - 1;
		const targetId = orderedSessionIds[index];
		if (targetId) {
			onSessionTabChange(targetId);
		}
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

						return (
							<SessionTab
								canReorderTabs={canReorderTabs}
								isActive={session.id === activeSession.id}
								isDraggingTab={isDraggingTab}
								key={session.id}
								onClose={onSessionTabClose}
								onDragEnd={handleReorderEnd}
								onDragStart={handleReorderStart}
								onSelect={onSessionTabChange}
								openChatTabCount={openChatTabCount}
								session={session}
							/>
						);
					})}
				</Reorder.Group>
				<div className='flex shrink-0 items-center gap-1'>
					<Tooltip>
						<TooltipTrigger asChild>
							<GhostIconButton
								disabled={isOpening}
								icon={<PlusIcon />}
								label='New chat tab'
								onClick={handleOpen}
							/>
						</TooltipTrigger>
						<ShortcutTooltipContent
							label='New chat tab'
							shortcut={NEW_TAB_SHORTCUT_HINT}
						/>
					</Tooltip>
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				{developerMode ? (
					<Button
						aria-label={
							debugOpen ? 'Hide Pi debug panel' : 'Show Pi debug panel'
						}
						className={cn(debugOpen && 'bg-muted text-foreground')}
						onClick={() => setDebugOpen(!debugOpen)}
						size='icon-sm'
						title='Pi raw frames (debug)'
						variant='ghost'
					>
						<BugIcon />
						<span className='sr-only'>Toggle Pi debug panel</span>
					</Button>
				) : null}
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

/** Props for a single reorderable session tab. */
interface SessionTabProps {
	session: SessionTabModel;
	isActive: boolean;
	canReorderTabs: boolean;
	isDraggingTab: boolean;
	/** Count of open chat tabs; a chat tab hides its close control when it is the last one. */
	openChatTabCount: number;
	onSelect: (sessionId: string) => void;
	onClose: (sessionId: string) => void;
	onDragStart: () => void;
	onDragEnd: () => void;
}

/** A single draggable session tab with select and hover-only close controls. */
function SessionTab({
	session,
	isActive,
	canReorderTabs,
	isDraggingTab,
	openChatTabCount,
	onSelect,
	onClose,
	onDragStart,
	onDragEnd,
}: SessionTabProps) {
	const isChatKind = (session.kind ?? 'chat') === 'chat';
	const canClose = isChatKind ? openChatTabCount > 1 : true;
	const showCloseControls = canClose && !isDraggingTab;
	const didDragRef = useRef(false);

	/** Marks this tab as dragged so the synthesized click does not select it. */
	function handleDragStart() {
		didDragRef.current = true;
		onDragStart();
	}

	/** Selects the tab, unless the click was synthesized at the end of a drag. */
	function handleSelect(event: MouseEvent<HTMLButtonElement>) {
		const select = shouldSelectOnTabClick(didDragRef.current, event.detail);
		didDragRef.current = false;
		if (select) {
			onSelect(session.id);
		}
	}

	return (
		<Reorder.Item
			className={cn(
				'group/session-tab relative m-0 flex h-12 min-w-30 max-w-52 flex-none items-center overflow-hidden border-transparent border-b-2 bg-clip-padding p-0 text-xs transition-colors',
				canReorderTabs && 'cursor-grab active:cursor-grabbing',
				isActive
					? 'border-primary bg-muted text-foreground'
					: 'border-background bg-background text-muted-foreground hover:text-foreground',
			)}
			data-session-tab-reorderable={canReorderTabs}
			dragElastic={canReorderTabs ? 0.08 : 0}
			dragListener={canReorderTabs}
			layout='position'
			onDragEnd={onDragEnd}
			onDragStart={handleDragStart}
			transition={isDraggingTab ? undefined : { layout: { duration: 0 } }}
			value={session.id}
			whileDrag={canReorderTabs ? { scale: 1.02, zIndex: 20 } : undefined}
		>
			<button
				aria-current={isActive ? 'page' : undefined}
				className='flex h-full min-w-0 flex-1 cursor-inherit items-center gap-2 px-3 text-left'
				onClick={handleSelect}
				onPointerDown={() => {
					didDragRef.current = false;
				}}
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
						onClose(session.id);
					}}
					onPointerDown={(event) => event.stopPropagation()}
					type='button'
				>
					<XIcon aria-hidden='true' className='size-3' />
				</button>
			) : null}
		</Reorder.Item>
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
		case 'terminal':
			return BotIcon;
		default:
			return MessageSquareIcon;
	}
}

/**
 * Robot-icon dropdown listing the installed AI coding-agent harnesses. Selecting
 * one (by click or its number key) launches it in a new embedded-terminal tab
 * and focuses that tab. Availability is detected in the main process; only
 * installed harnesses are shown. The list is fetched lazily on first open.
 */
function HarnessLauncherMenu({
	onLaunchHarness,
	onSessionTabChange,
}: {
	onLaunchHarness: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabChange: (sessionId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [launchingId, setLaunchingId] = useState<string | null>(null);
	const launchedRef = useRef(false);
	const { data, isPending } = useQuery({
		queryFn: async () =>
			(await window.ensemblr?.listAgentHarnesses()) ?? { harnesses: [] },
		queryKey: ['agent-harnesses'],
		staleTime: 30_000,
	});
	const installedHarnesses = (data?.harnesses ?? []).filter(
		(harness) => harness.available,
	);
	const noHarnessesDetected = !isPending && installedHarnesses.length === 0;

	useHotkey('agents.open', () => setOpen(true), {
		enabled: !noHarnessesDetected,
	});

	/** Launches the chosen harness, focuses the new tab, then closes the menu. */
	function handleLaunch(harnessId: string, harnessLabel: string) {
		if (launchingId) {
			return;
		}
		setLaunchingId(harnessId);
		void onLaunchHarness({ harnessId, harnessLabel })
			.then((result) => {
				if (result) {
					launchedRef.current = true;
					onSessionTabChange(result.chatTabId);
				}
			})
			.finally(() => {
				setLaunchingId(null);
				setOpen(false);
			});
	}

	/** Launches the harness whose 1-based position matches the pressed number. */
	function handleNumberShortcut(event: KeyboardEvent) {
		if (launchingId) {
			return;
		}
		const position = Number.parseInt(event.key, 10);
		if (
			Number.isNaN(position) ||
			position < 1 ||
			position > installedHarnesses.length
		) {
			return;
		}
		event.preventDefault();
		const harness = installedHarnesses[position - 1];
		handleLaunch(harness.id, harness.label);
	}

	if (noHarnessesDetected) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className='inline-flex'>
						<GhostIconButton
							disabled
							icon={<BotIcon />}
							label='Launch coding agent'
						/>
					</span>
				</TooltipTrigger>
				<ShortcutTooltipContent label='No harnesses detected' />
			</Tooltip>
		);
	}

	return (
		<DropdownMenu
			onOpenChange={(next) => {
				// Reset the launch marker on every open so a launch that resolves
				// after an early close (Escape while pending) can't leave a stale
				// true that suppresses focus restore on the next plain close.
				if (next) {
					launchedRef.current = false;
				}
				setOpen(next);
			}}
			open={open}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<GhostIconButton icon={<BotIcon />} label='Launch coding agent' />
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<ShortcutTooltipContent
					label='Launch coding agent'
					shortcut={AGENTS_SHORTCUT_HINT}
				/>
			</Tooltip>
			<DropdownMenuContent
				align='end'
				className='w-56 p-1'
				onCloseAutoFocus={(event) => {
					// A launch activates the new terminal tab, which mounts XtermTerminal
					// and grabs keyboard focus. Radix otherwise restores focus to the
					// trigger on close, stealing it back; skip the restore only for a
					// launch so plain closes (Escape, click-outside) keep normal a11y.
					if (launchedRef.current) {
						launchedRef.current = false;
						event.preventDefault();
					}
				}}
				onKeyDown={handleNumberShortcut}
			>
				{installedHarnesses.length ? (
					installedHarnesses.map((harness, index) => {
						const iconName = harnessIconName(harness.id);
						return (
							<DropdownMenuItem
								className='h-9 gap-2 px-2 text-[0.8125rem]'
								disabled={launchingId !== null}
								key={harness.id}
								onSelect={(event) => {
									event.preventDefault();
									handleLaunch(harness.id, harness.label);
								}}
							>
								{iconName ? (
									<Icon
										aria-hidden='true'
										className={cn(
											'size-4 shrink-0',
											harnessIconClassName(harness.id),
										)}
										icon={iconName}
									/>
								) : (
									<BotIcon
										aria-hidden='true'
										className='size-4 shrink-0 text-muted-foreground'
									/>
								)}
								<span className='min-w-0 flex-1 truncate font-medium'>
									{harness.label}
								</span>
								{launchingId === harness.id ? (
									<LoaderCircleIcon
										aria-hidden='true'
										className='size-3.5 shrink-0 animate-spin'
									/>
								) : index < 9 ? (
									<kbd className='grid size-4 shrink-0 place-items-center rounded-sm border border-border font-medium text-[0.625rem] text-muted-foreground'>
										{index + 1}
									</kbd>
								) : null}
							</DropdownMenuItem>
						);
					})
				) : (
					<DropdownMenuItem
						className='h-9 px-2 text-muted-foreground text-xs'
						disabled
					>
						No coding agents detected
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Leading icon for a closed-history row: the harness brand logo for a closed
 * terminal (agent) tab, or the generic chat glyph for a closed chat. Mirrors
 * {@link SessionTabIcon} so a conversation keeps the same icon in history.
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
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<GhostIconButton
							icon={<HistoryIcon />}
							label='Open closed chat tabs'
						/>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<ShortcutTooltipContent label='Closed chat tabs' />
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
						No closed chat tabs
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
