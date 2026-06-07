import {
	BotIcon,
	CheckCircle2Icon,
	CircleDashedIcon,
	FileCodeIcon,
	LoaderCircleIcon,
	type LucideIcon,
	SearchIcon,
	SquareTerminalIcon,
	UserIcon,
} from 'lucide-react';

import { SetupDiagnosticsPanel } from '@/renderer/components/setup-diagnostics';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/contexts';
import { cn } from '@/renderer/lib/utils';
import {
	getWorkbenchMockChatThread,
	type WorkbenchMockChatTool,
} from '@/renderer/mocks/workbench';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** Scrollable timeline content shown above the composer. */
export function WorkspaceTimeline({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}) {
	const { state, actions } = useSetupDiagnostics();
	const {
		setupDiagnostics,
		setupDiagnosticsError,
		isSetupDiagnosticsRetrying,
	} = state;

	return (
		<div className='mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5'>
			{setupDiagnostics?.status !== 'ready' ? (
				<>
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
									The workbench remains visible while setup diagnostics block
									the composer. Use the setup gate panel to resolve app
									readiness.
								</p>
							</div>
						</div>
					</section>
					<SetupDiagnosticsPanel
						error={setupDiagnosticsError}
						isRetrying={isSetupDiagnosticsRetrying}
						onRetry={actions.onSetupDiagnosticsRetry}
						snapshot={setupDiagnostics}
					/>
				</>
			) : null}

			<AgentChatThread
				activeSession={activeSession}
				composer={composer}
				workspace={workspace}
			/>
		</div>
	);
}

/** Mock agent chat thread rendered from the fixture chat builder. */
function AgentChatThread({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}) {
	const messages = getWorkbenchMockChatThread({
		activeSession,
		composer,
		workspace,
	});

	return (
		<section aria-label='Mock agent chat' className='flex flex-col gap-5'>
			{messages.map((message) => (
				<ChatMessage
					key={`${message.author}-${message.time}-${message.body[0]}`}
					{...message}
				/>
			))}
		</section>
	);
}

/** Single chat message bubble with avatar, body and optional tool list. */
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

/** Round chat avatar with tone-driven coloring and working-state animation. */
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

type ChatToolActivity = WorkbenchMockChatTool;

const chatToolIconByName: Record<ChatToolActivity['icon'], LucideIcon> = {
	check: CheckCircle2Icon,
	'circle-dashed': CircleDashedIcon,
	'file-code': FileCodeIcon,
	loader: LoaderCircleIcon,
	search: SearchIcon,
	terminal: SquareTerminalIcon,
};

/** Renders the list of tool calls attached to a chat message. */
function ChatToolList({ tools }: { tools: ChatToolActivity[] }) {
	return (
		<div className='mt-3 flex flex-col gap-1.5'>
			{tools.map((tool) => {
				const ToolIcon = chatToolIconByName[tool.icon];

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
