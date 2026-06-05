import {
	BotIcon,
	CheckCircle2Icon,
	CircleDashedIcon,
	FileCodeIcon,
	HistoryIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MessageSquareIcon,
	PlusIcon,
	RotateCcwIcon,
	SearchIcon,
	SquareTerminalIcon,
	UserIcon,
	XIcon,
} from 'lucide-react';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/workbench/workbench-model';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export function SessionTabs({
	activeSession,
	closedSessions,
	onSessionTabClose,
	onSessionTabChange,
	onSessionTabRestore,
	sessions,
}: {
	activeSession: SessionTabModel;
	closedSessions: SessionTabModel[];
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessions: SessionTabModel[];
}) {
	const canCloseTabs = sessions.length > 1;

	return (
		<div className='flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b bg-background px-3'>
			<div className='flex min-w-0 flex-1 items-center gap-1.5'>
				<div className='no-scrollbar flex min-w-0 gap-1 overflow-x-auto'>
					{sessions.map((session) => {
						const isActive = session.id === activeSession.id;
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
								{canCloseTabs ? (
									<>
										<span
											aria-hidden='true'
											className={cn(
												'pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l to-transparent opacity-0 transition-opacity group-hover/session-tab:opacity-100',
												isActive
													? 'from-muted via-muted/90'
													: 'from-background via-background/90',
											)}
										/>
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
									</>
								) : null}
							</div>
						);
					})}
				</div>
				<div className='flex shrink-0 items-center gap-1'>
					<Button size='icon-sm' variant='ghost'>
						<PlusIcon />
						<span className='sr-only'>New chat tab</span>
					</Button>
				</div>
			</div>
			<ClosedSessionHistoryMenu
				closedSessions={closedSessions}
				onSessionTabRestore={onSessionTabRestore}
			/>
		</div>
	);
}

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

export function WorkspaceTimeline({
	activeSession,
	composer,
	setupDiagnostics,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	workspace: WorkspaceShellModel;
}) {
	return (
		<div className='mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5'>
			{setupDiagnostics?.status !== 'ready' ? (
				<section className='flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3'>
					<div className='flex items-start gap-2'>
						<CircleDashedIcon
							aria-hidden='true'
							className='mt-0.5 size-4 shrink-0 text-status-warning'
						/>
						<div className='min-w-0'>
							<p className='font-medium text-sm'>
								Setup keeps the shell in place
							</p>
							<p className='mt-1 text-muted-foreground text-xs leading-5'>
								The workbench remains visible while setup diagnostics block the
								composer. Check the left sidebar footer for app readiness.
							</p>
						</div>
					</div>
				</section>
			) : null}

			<AgentChatThread
				activeSession={activeSession}
				composer={composer}
				workspace={workspace}
			/>
		</div>
	);
}

function AgentChatThread({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}) {
	return (
		<section aria-label='Mock agent chat' className='flex flex-col gap-5'>
			<ChatMessage
				author='You'
				body={[
					`Can you update ${workspace.name} so the sidebar feels closer to Conductor?`,
					'Start with the project groups, pinned workspaces, and workspace actions.',
				]}
				speaker='user'
				time='14:31'
			/>
			<ChatMessage
				author='Pi'
				body={[
					`I am working in ${workspace.branchName}. I will keep the sidebar data model local to the shell fixture and preserve the existing project ordering.`,
				]}
				speaker='assistant'
				time='14:32'
				tools={[
					{
						detail: 'Read workbench-shell.tsx and sidebar primitives',
						icon: SearchIcon,
						label: 'Inspecting layout',
						status: 'done',
					},
					{
						detail: 'Project collapse, context menus, and pinned rows',
						icon: FileCodeIcon,
						label: 'Editing sidebar',
						status: 'done',
					},
				]}
			/>
			<ChatMessage
				author='You'
				body={[
					'Pin should move a workspace out of Projects, and the row motion should stay calm.',
				]}
				speaker='user'
				time='14:38'
			/>
			<ChatMessage
				author='Pi'
				body={[
					'Pinned workspaces now render above Projects, project counts ignore pinned rows, and pinning briefly disables reorder layout motion while the list reflows.',
				]}
				speaker='assistant'
				time='14:39'
				tools={[
					{
						detail: 'bun run check',
						icon: SquareTerminalIcon,
						label: 'Biome and Tailwind',
						status: 'done',
					},
					{
						detail: 'bun run test:renderer',
						icon: CheckCircle2Icon,
						label: 'Renderer tests',
						status: 'done',
					},
					{
						detail: 'bun run typecheck',
						icon: CheckCircle2Icon,
						label: 'TypeScript',
						status: 'done',
					},
				]}
			/>
			<ChatMessage
				author='Pi'
				body={[
					`Current thread: ${activeSession.label}. I am mocking this chat pane with agent messages, tool activity, and verification output so the composer has a real conversation target.`,
				]}
				speaker='assistant'
				status={composer.disabled ? 'blocked' : 'working'}
				time='now'
				tools={[
					{
						detail: composer.disabled
							? 'Waiting for setup diagnostics to clear'
							: 'Replacing timeline cards with chat transcript',
						icon: composer.disabled ? CircleDashedIcon : LoaderCircleIcon,
						label: composer.disabled
							? 'Composer blocked'
							: 'Chat mock in progress',
						status: composer.disabled ? 'pending' : 'running',
					},
				]}
			/>
		</section>
	);
}

function ChatMessage({
	author,
	body,
	speaker,
	status,
	time,
	tools = [],
}: {
	author: string;
	body: string[];
	speaker: 'assistant' | 'user';
	status?: 'blocked' | 'working';
	time: string;
	tools?: ChatToolActivity[];
}) {
	const isUser = speaker === 'user';
	const AvatarIcon = isUser ? UserIcon : BotIcon;

	return (
		<div className={cn('flex gap-3', isUser && 'justify-end')}>
			{isUser ? null : (
				<ChatAvatar
					icon={AvatarIcon}
					isWorking={status === 'working'}
					tone={status === 'blocked' ? 'warning' : 'muted'}
				/>
			)}
			<div
				className={cn(
					'flex min-w-0 max-w-[min(38rem,100%)] flex-col gap-1.5',
					isUser && 'items-end',
				)}
			>
				<div className='flex items-center gap-2 text-muted-foreground text-xs'>
					<span className='font-medium text-foreground'>{author}</span>
					<span>{time}</span>
				</div>
				<div
					className={cn(
						'rounded-md px-3 py-2 text-[0.8125rem] leading-5',
						isUser
							? 'bg-primary/15 text-foreground'
							: 'border border-border bg-pane text-foreground',
					)}
				>
					<div className='flex flex-col gap-2'>
						{body.map((paragraph) => (
							<p key={paragraph}>{paragraph}</p>
						))}
					</div>
					{tools.length ? <ChatToolList tools={tools} /> : null}
				</div>
			</div>
			{isUser ? <ChatAvatar icon={AvatarIcon} tone='primary' /> : null}
		</div>
	);
}

function ChatAvatar({
	icon: AvatarIcon,
	isWorking = false,
	tone,
}: {
	icon: LucideIcon;
	isWorking?: boolean;
	tone: 'muted' | 'primary' | 'warning';
}) {
	return (
		<div
			className={cn(
				'mt-5 grid size-7 shrink-0 place-items-center rounded-full border',
				tone === 'primary' &&
					'border-primary/30 bg-primary/15 text-primary-foreground',
				tone === 'warning' &&
					'border-status-warning/30 bg-status-warning/10 text-status-warning',
				tone === 'muted' && 'border-border bg-pane text-muted-foreground',
			)}
		>
			<AvatarIcon
				aria-hidden='true'
				className={cn('size-3.5', isWorking && 'animate-pulse')}
			/>
		</div>
	);
}

interface ChatToolActivity {
	detail: string;
	icon: LucideIcon;
	label: string;
	status: 'done' | 'pending' | 'running';
}

function ChatToolList({ tools }: { tools: ChatToolActivity[] }) {
	return (
		<div className='mt-3 flex flex-col gap-1.5'>
			{tools.map((tool) => {
				const ToolIcon = tool.icon;

				return (
					<div
						className='flex min-w-0 items-center gap-2 rounded-sm bg-muted/45 px-2 py-1.5 text-xs'
						key={`${tool.label}-${tool.detail}`}
					>
						<ToolIcon
							aria-hidden='true'
							className={cn(
								'size-3.5 shrink-0',
								tool.status === 'done' && 'text-status-ok',
								tool.status === 'pending' && 'text-status-warning',
								tool.status === 'running' &&
									'animate-spin text-muted-foreground',
							)}
						/>
						<span className='min-w-0 flex-1 truncate font-medium'>
							{tool.label}
						</span>
						<span className='min-w-0 max-w-72 truncate text-muted-foreground'>
							{tool.detail}
						</span>
					</div>
				);
			})}
		</div>
	);
}

export function ComposerPanel({ composer }: { composer: ComposerShellState }) {
	return (
		<footer className='shrink-0 border-border border-t bg-background p-3'>
			<div className='rounded-md border border-border bg-pane p-2'>
				<Textarea
					aria-label='Pi composer'
					className='min-h-24 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0'
					disabled={composer.disabled}
					placeholder={composer.placeholder}
				/>
				<div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
					<div className='flex flex-wrap items-center gap-1.5'>
						<StatusBadge tone='muted'>{composer.modelLabel}</StatusBadge>
						<StatusBadge tone='muted'>{composer.thinkingLabel}</StatusBadge>
						{composer.disabledReason ? (
							<StatusBadge
								className='min-w-0 max-w-full truncate'
								tone='warning'
							>
								{composer.disabledReason}
							</StatusBadge>
						) : null}
					</div>
					<div className='flex items-center gap-1.5'>
						<Button disabled={composer.disabled} size='sm' variant='outline'>
							<FileCodeIcon data-icon='inline-start' />
							Attach
						</Button>
						<Button disabled={composer.disabled} size='sm'>
							Send
						</Button>
					</div>
				</div>
			</div>
		</footer>
	);
}
