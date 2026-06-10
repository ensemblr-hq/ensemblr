import {
	BugIcon,
	HistoryIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	PlusIcon,
	RotateCcwIcon,
	XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import { useDebugPanelToggle } from '@/renderer/state/pi-raw-frames';
import type { SessionTabModel } from '@/renderer/types/workbench';

/** Horizontal session-tab bar with close, restore, and new-tab controls. */
export function SessionTabs({
	activeSession,
	closedSessions,
	onSessionTabClose,
	onSessionTabChange,
	onSessionTabOpen,
	onSessionTabRestore,
	sessions,
}: {
	activeSession: SessionTabModel;
	closedSessions: SessionTabModel[];
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabOpen: () => Promise<{ chatTabId: string } | null>;
	onSessionTabRestore: (sessionId: string) => void;
	sessions: SessionTabModel[];
}) {
	const [isOpening, setIsOpening] = useState(false);
	const [debugOpen, setDebugOpen] = useDebugPanelToggle();

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

	return (
		<div className='flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b bg-background px-3'>
			<div className='flex min-w-0 flex-1 items-center gap-1.5'>
				<div className='no-scrollbar flex min-w-0 gap-1 overflow-x-auto'>
					{sessions.map((session) => {
						const isActive = session.id === activeSession.id;
						const canClose = sessions.length > 1;
						const SessionIcon =
							session.status === 'working'
								? LoaderCircleIcon
								: MessageSquareIcon;

						return (
							<div
								className={cn(
									'group/session-tab relative flex h-12 min-w-30 flex-none items-center overflow-hidden border-transparent border-b-2 text-xs transition-colors',
									isActive
										? 'border-primary bg-muted/50 text-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								key={session.id}
							>
								<button
									className='flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left'
									onClick={() => onSessionTabChange(session.id)}
									type='button'
								>
									<span className='grid size-3.5 shrink-0 place-items-center'>
										<SessionIcon
											aria-hidden='true'
											className={cn(
												'size-3.5',
												session.status === 'working' && 'animate-spin',
											)}
										/>
									</span>
									<span className='truncate'>{session.label}</span>
								</button>
								{canClose ? (
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
								{canClose ? (
									<button
										aria-label={`Close ${session.label} tab`}
										className='absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-sm opacity-0 transition-all hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/session-tab:opacity-100'
										onClick={(event) => {
											event.stopPropagation();
											onSessionTabClose(session.id);
										}}
										type='button'
									>
										<XIcon aria-hidden='true' className='size-3' />
									</button>
								) : null}
							</div>
						);
					})}
				</div>
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
