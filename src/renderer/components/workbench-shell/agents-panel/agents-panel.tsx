import type { TFunction } from 'i18next';
import {
	AlertCircleIcon,
	BotIcon,
	ChevronRightIcon,
	LeafIcon,
	Loader2Icon,
	MessageSquareIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AgentProviderLogo } from '@/renderer/components/agent-provider-brand';
import { Button } from '@/renderer/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { PanelPlaceholder } from '@/renderer/components/workbench-shell/panel-placeholder';
import { cn } from '@/renderer/lib/utils';
import type {
	AgentContextUsage,
	AgentConversation,
	AgentConversationActivity,
	AgentConversationStatus,
	AgentsPanelProps,
} from '@/renderer/types/agents';
import {
	type AgentProviderId,
	getAgentProviderLabel,
} from '@/shared/agent-provider';

/** Returns the localized label for a runtime status code.
 * @param status - Reported conversation state.
 * @param t - Current language translator.
 * @returns Human-readable state without inferring completion.
 */
function statusLabel(status: AgentConversationStatus, t: TFunction): string {
	if (status === 'working') {
		return t('workbench:agents.status.working', 'Working');
	}
	if (status === 'blocked') {
		return t('workbench:agents.status.blocked', 'Blocked');
	}
	return t('workbench:agents.status.idle', 'Idle');
}

/** Returns context use as a bounded whole percentage.
 * @param usage - Valid context-window reading.
 * @returns Used percentage capped at 100.
 */
function contextPercent(usage: AgentContextUsage): number {
	if (usage.maxTokens <= 0) {
		return 0;
	}
	return Math.min(100, Math.round((usage.usedTokens / usage.maxTokens) * 100));
}

/** Builds the exact localized token reading shown by a context tooltip.
 * @param usage - Latest valid reading, if available.
 * @param language - Locale used for number formatting.
 * @param t - Current language translator.
 * @returns Context details for the tooltip and accessible row description.
 */
function contextDetails(
	usage: AgentContextUsage | null,
	language: string,
	t: TFunction,
): string {
	if (!usage) {
		return t('workbench:agents.context.unavailable', 'Context unavailable');
	}
	const formatter = new Intl.NumberFormat(language);
	const values = {
		max: formatter.format(usage.maxTokens),
		used: formatter.format(usage.usedTokens),
	};
	if (usage.reading === 'last-recorded') {
		return t(
			'workbench:agents.context.last-recorded',
			'Last recorded: {{used}} of {{max}} tokens',
			values,
		);
	}
	return t(
		'workbench:agents.context.live',
		'{{used}} of {{max}} tokens',
		values,
	);
}

/** One conversation and the visible children nested beneath it. */
interface AgentTreeNode {
	children: readonly AgentTreeNode[];
	conversation: AgentConversation;
}

/** Open hierarchy plus the ids claimed by its live rows and required ancestors. */
interface OpenConversationTree {
	nodes: readonly AgentTreeNode[];
	visibleIds: ReadonlySet<string>;
}

/**
 * Builds the visible open tree once, retaining closed ancestors and detaching cycles.
 * @param conversations - Workspace conversations in stable sibling order.
 * @returns Nested roots and every conversation id represented in them.
 */
function openConversationTree(
	conversations: readonly AgentConversation[],
): OpenConversationTree {
	const byId = new Map(
		conversations.map((conversation) => [conversation.chatTabId, conversation]),
	);
	const visibleIds = new Set<string>();
	for (const conversation of conversations) {
		if (conversation.isClosed) {
			continue;
		}
		let current: AgentConversation | undefined = conversation;
		while (current && !visibleIds.has(current.chatTabId)) {
			visibleIds.add(current.chatTabId);
			current = current.parentChatTabId
				? byId.get(current.parentChatTabId)
				: undefined;
		}
	}

	const visible = conversations.filter((conversation) =>
		visibleIds.has(conversation.chatTabId),
	);
	const childrenByParent = new Map<string, AgentConversation[]>();
	for (const conversation of visible) {
		if (!conversation.parentChatTabId) {
			continue;
		}
		const siblings = childrenByParent.get(conversation.parentChatTabId) ?? [];
		childrenByParent.set(conversation.parentChatTabId, [
			...siblings,
			conversation,
		]);
	}
	const added = new Set<string>();
	/** Builds one branch while preventing repeated or cyclic nodes.
	 * @param conversation - Branch root to materialize.
	 * @returns A new tree node, or null when already included.
	 */
	const buildNode = (conversation: AgentConversation): AgentTreeNode | null => {
		if (added.has(conversation.chatTabId)) {
			return null;
		}
		added.add(conversation.chatTabId);
		const children: AgentTreeNode[] = [];
		for (const child of childrenByParent.get(conversation.chatTabId) ?? []) {
			const node = buildNode(child);
			if (node) {
				children.push(node);
			}
		}
		return { children, conversation };
	};
	const roots = visible.filter(
		(conversation) =>
			!conversation.parentChatTabId ||
			!visibleIds.has(conversation.parentChatTabId),
	);
	const nodes: AgentTreeNode[] = [];
	for (const conversation of [...roots, ...visible]) {
		const node = buildNode(conversation);
		if (node) {
			nodes.push(node);
		}
	}
	return { nodes, visibleIds };
}

/** Uses only valid readings and treats every archived reading as last recorded.
 * @param conversation - Conversation whose context is being presented.
 * @returns Valid live or archived context, or null when unavailable.
 */
function rowContextUsage(
	conversation: AgentConversation,
): AgentContextUsage | null {
	const usage = conversation.contextUsage;
	if (
		!usage ||
		!Number.isFinite(usage.maxTokens) ||
		usage.maxTokens <= 0 ||
		!Number.isFinite(usage.usedTokens) ||
		usage.usedTokens < 0
	) {
		return null;
	}
	return conversation.isClosed ? { ...usage, reading: 'last-recorded' } : usage;
}

/** Labeled context percentage with exact token details on hover. */
function ContextReading({ usage }: { usage: AgentContextUsage | null }) {
	const { i18n, t } = useTranslation();
	const percent = usage ? contextPercent(usage) : null;
	const details = contextDetails(usage, i18n.language, t);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className='inline-flex shrink-0 items-center gap-1 text-muted-foreground'>
					<span>{t('workbench:agents.context.label', 'Context')}</span>
					<span className='font-mono tabular-nums'>
						{percent === null ? '—' : `${percent}%`}
					</span>
				</span>
			</TooltipTrigger>
			<TooltipContent>{details}</TooltipContent>
		</Tooltip>
	);
}

/** Returns the status text shown in a conversation row.
 * @param conversation - Row whose runtime or archived state is shown.
 * @param isPending - Whether a restore attempt is in progress.
 * @param t - Current language translator.
 * @returns Localized state or restoration progress.
 */
function rowStatusLabel(
	conversation: AgentConversation,
	isPending: boolean,
	t: TFunction,
): string {
	if (!conversation.isClosed) {
		return statusLabel(conversation.status, t);
	}
	if (isPending) {
		return t('workbench:agents.restore.pending', 'Restoring…');
	}
	return t('workbench:agents.status.closed', 'Closed');
}

/** Reserves a stable line for tool activity, working progress, or idle readiness. */
function AgentActivityPreview({
	activity,
	depth,
	status,
}: {
	activity: AgentConversationActivity | null | undefined;
	depth: AgentConversation['depth'];
	status: AgentConversationStatus;
}) {
	const { t } = useTranslation();
	if (!activity) {
		let placeholder: string | null = null;
		if (status === 'working') {
			placeholder = t('workbench:agents.activity.working', 'Working...');
		} else if (status === 'idle') {
			placeholder =
				depth === 0
					? t(
							'workbench:agents.activity.ready-root',
							'Ready for your next message',
						)
					: t(
							'workbench:agents.activity.ready-parent',
							'Ready for the parent chat',
						);
		}
		return (
			<div
				aria-hidden={placeholder ? undefined : 'true'}
				className='mt-1 flex h-4 min-w-0 items-center text-muted-foreground text-xxs leading-4'
			>
				{placeholder ? (
					<span className='min-w-0 truncate' title={placeholder}>
						{placeholder}
					</span>
				) : null}
			</div>
		);
	}
	const additionalCalls = Math.max(0, (activity.parallelCount ?? 1) - 1);

	return (
		<div className='mt-1 flex h-4 min-w-0 items-center gap-1.5 text-muted-foreground text-xxs leading-4'>
			<span
				className='min-w-0 truncate text-foreground/80'
				title={activity.title}
			>
				{activity.title}
			</span>
			{activity.target ? (
				<span className='min-w-0 flex-1 truncate' title={activity.target}>
					{activity.target}
				</span>
			) : null}
			{additionalCalls > 0 ? (
				<span className='shrink-0'>
					{t('workbench:agents.activity.parallel', '+{{count}} parallel', {
						count: additionalCalls,
					})}
				</span>
			) : null}
		</div>
	);
}

/** Parent relationship or screen-reader-only closed-parent context. */
function AgentLineageLabel({
	isPlaceholder,
	parentTitle,
}: {
	isPlaceholder: boolean;
	parentTitle?: string;
}) {
	const { t } = useTranslation();
	if (isPlaceholder) {
		return (
			<span className='sr-only'>
				{t('workbench:agents.row.closed-parent', 'Closed parent chat')}
			</span>
		);
	}
	if (!parentTitle) {
		return null;
	}
	return (
		<span className='mt-1 block w-full truncate text-muted-foreground text-xxs leading-4'>
			{t('workbench:agents.row.parent', 'Parent chat: {{title}}', {
				title: parentTitle,
			})}
		</span>
	);
}

/** Retry hint retained inside a closed row after restoration fails. */
function RestoreError({ visible }: { visible: boolean }) {
	const { t } = useTranslation();
	if (!visible) {
		return null;
	}
	return (
		<span className='mt-1 flex items-center gap-1 text-destructive text-xxs leading-4'>
			<AlertCircleIcon aria-hidden='true' className='size-3' />
			{t('workbench:agents.restore.failed', 'Restore failed. Try again.')}
		</span>
	);
}

/** Chat identity glyph shared with the approved session-tab vocabulary. */
function AgentIdentityIcon({ depth }: { depth: AgentConversation['depth'] }) {
	if (depth === 0) {
		return (
			<span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
				<MessageSquareIcon aria-hidden='true' className='size-3.5' />
			</span>
		);
	}
	return (
		<span
			className={cn(
				'grid size-5 shrink-0 place-items-center rounded-sm',
				depth === 2
					? 'bg-status-ok/15 text-status-ok'
					: 'bg-accent text-accent-foreground',
			)}
		>
			{depth === 2 ? (
				<LeafIcon aria-hidden='true' className='size-3.5' />
			) : (
				<BotIcon aria-hidden='true' className='size-3.5' />
			)}
		</span>
	);
}

/** Conversation title with a working spinner or exceptional state label. */
function AgentRowHeading({
	conversation,
	isPending,
}: {
	conversation: AgentConversation;
	isPending: boolean;
}) {
	const { t } = useTranslation();
	return (
		<div className='flex min-w-0 items-baseline gap-2'>
			<span
				className={cn(
					'min-w-0 flex-1 truncate font-medium text-[0.8125rem] leading-5',
					conversation.isClosed ? 'text-muted-foreground' : 'text-foreground',
				)}
			>
				{conversation.title}
			</span>
			{!conversation.isClosed && conversation.status === 'working' ? (
				<Spinner
					aria-label={statusLabel(conversation.status, t)}
					className='size-3 shrink-0 self-center text-muted-foreground motion-reduce:animate-none'
				/>
			) : conversation.isClosed || conversation.status === 'blocked' ? (
				<span
					className={cn(
						'shrink-0 text-xxs leading-5',
						conversation.isClosed ? 'text-muted-foreground' : 'text-foreground',
					)}
				>
					{rowStatusLabel(conversation, isPending, t)}
				</span>
			) : null}
			{conversation.isClosed && !isPending ? (
				<span className='shrink-0 font-medium text-foreground text-xxs leading-5'>
					{t('workbench:agents.restore.action', 'Restore')}
				</span>
			) : null}
			{isPending ? (
				<Loader2Icon aria-hidden='true' className='size-3 animate-spin' />
			) : null}
		</div>
	);
}

/** Identifies the explicit agent runtime without adding another row action. */
function AgentRuntimeIcon({ runtime }: { runtime?: AgentProviderId | null }) {
	if (!runtime) {
		return null;
	}
	const label = getAgentProviderLabel(runtime);
	return (
		<span
			aria-label={label}
			className='inline-flex size-3.5 shrink-0 items-center justify-center'
			role='img'
		>
			<AgentProviderLogo className='size-3' provider={runtime} />
		</span>
	);
}

/** Model and labeled context line for one agent conversation. */
function AgentRowMeta({ conversation }: { conversation: AgentConversation }) {
	const { t } = useTranslation();
	return (
		<div className='mt-0.5 flex min-w-0 items-center gap-2 text-xxs leading-4'>
			<span className='flex min-w-0 flex-1 items-center gap-1 text-muted-foreground'>
				<AgentRuntimeIcon runtime={conversation.runtime} />
				<span className='min-w-0 truncate'>
					{conversation.model ??
						t('workbench:agents.model.unavailable', 'Model unavailable')}
				</span>
			</span>
			<ContextReading usage={rowContextUsage(conversation)} />
		</div>
	);
}

/** Inputs for one selectable or restorable conversation row. */
interface AgentRowProps {
	conversation: AgentConversation;
	isPlaceholder: boolean;
	isSelected: boolean;
	onRestore: (chatTabId: string) => void;
	onSelect: (chatTabId: string) => void;
	parentTitle?: string;
}

/** One selectable or restorable conversation row. */
function AgentRow({
	conversation,
	isPlaceholder,
	isSelected,
	onRestore,
	onSelect,
	parentTitle,
}: AgentRowProps) {
	const { i18n, t } = useTranslation();
	const isRestorable = conversation.isClosed;
	const isPending = conversation.restoreState === 'pending';
	const activity =
		!conversation.isClosed && conversation.status === 'working'
			? conversation.activity
			: null;
	const details = [
		rowStatusLabel(conversation, isPending, t),
		conversation.model,
		contextDetails(rowContextUsage(conversation), i18n.language, t),
		activity?.title,
		activity?.target,
	]
		.filter(Boolean)
		.join(' · ');
	const actionLabel = isRestorable
		? t('workbench:agents.row.restore', 'Restore {{title}}', {
				title: conversation.title,
			})
		: t('workbench:agents.row.open', 'Open {{title}}', {
				title: conversation.title,
			});

	return (
		<button
			aria-busy={isPending || undefined}
			aria-current={!isRestorable && isSelected ? 'true' : undefined}
			aria-description={details}
			aria-label={actionLabel}
			className={cn(
				'group flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
				isSelected && !isRestorable && 'bg-accent hover:bg-accent',
			)}
			disabled={isPending}
			onClick={() => {
				if (isRestorable) {
					onRestore(conversation.chatTabId);
					return;
				}
				onSelect(conversation.chatTabId);
			}}
			title={`${conversation.title} — ${details}`}
			type='button'
		>
			<AgentIdentityIcon depth={conversation.depth} />
			<span className='min-w-0 flex-1'>
				<AgentRowHeading conversation={conversation} isPending={isPending} />
				<AgentRowMeta conversation={conversation} />
				<AgentLineageLabel
					isPlaceholder={isPlaceholder}
					parentTitle={parentTitle}
				/>
				{!conversation.isClosed ? (
					<AgentActivityPreview
						activity={activity}
						depth={conversation.depth}
						status={conversation.status}
					/>
				) : null}
				<RestoreError visible={conversation.restoreState === 'error'} />
			</span>
		</button>
	);
}

/** One nested list item and its connected descendant branch. */
function AgentTreeItem({
	node,
	onRestore,
	onSelect,
	selectedChatTabId,
}: {
	node: AgentTreeNode;
	onRestore: (chatTabId: string) => void;
	onSelect: (chatTabId: string) => void;
	selectedChatTabId: string | null;
}) {
	return (
		<li>
			<AgentRow
				conversation={node.conversation}
				isPlaceholder={node.conversation.isClosed}
				isSelected={node.conversation.chatTabId === selectedChatTabId}
				onRestore={onRestore}
				onSelect={onSelect}
			/>
			{node.children.length > 0 ? (
				<ul
					className='ml-4 flex flex-col gap-1 border-border/80 border-l pt-1 pl-2'
					data-agent-branch='true'
				>
					{node.children.map((child) => (
						<AgentTreeItem
							key={child.conversation.chatTabId}
							node={child}
							onRestore={onRestore}
							onSelect={onSelect}
							selectedChatTabId={selectedChatTabId}
						/>
					))}
				</ul>
			) : null}
		</li>
	);
}

/** Open hierarchy, including any closed ancestors needed for context. */
function OpenConversationSection({
	onRestore,
	onSelect,
	rows,
	selectedChatTabId,
}: {
	onRestore: (chatTabId: string) => void;
	onSelect: (chatTabId: string) => void;
	rows: readonly AgentTreeNode[];
	selectedChatTabId: string | null;
}) {
	const { t } = useTranslation();
	const nodes = rows;
	return (
		<section
			aria-label={t('workbench:agents.open-section', 'Open conversations')}
		>
			{nodes.length > 0 ? (
				<ul className='flex flex-col gap-1'>
					{nodes.map((node) => (
						<AgentTreeItem
							key={node.conversation.chatTabId}
							node={node}
							onRestore={onRestore}
							onSelect={onSelect}
							selectedChatTabId={selectedChatTabId}
						/>
					))}
				</ul>
			) : (
				<p className='px-2 py-4 text-center text-muted-foreground text-xs'>
					{t('workbench:agents.no-open', 'No open conversations.')}
				</p>
			)}
		</section>
	);
}

/** Initially collapsed restorable history with its count and immediate-parent context. */
function ClosedConversationSection({
	onRestore,
	onSelect,
	rows,
	titles,
}: {
	onRestore: (chatTabId: string) => void;
	onSelect: (chatTabId: string) => void;
	rows: readonly AgentConversation[];
	titles: ReadonlyMap<string, string>;
}) {
	const { t } = useTranslation();
	if (rows.length === 0) {
		return null;
	}
	return (
		<Collapsible asChild defaultOpen={false}>
			<section
				aria-label={t(
					'workbench:agents.closed-section',
					'Closed conversations',
				)}
				className='mt-3 border-border border-t pt-2'
			>
				<h3>
					<CollapsibleTrigger className='group flex w-full items-center gap-1 rounded-md px-2 py-1 font-medium text-muted-foreground text-xxs uppercase tracking-wide outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'>
						<ChevronRightIcon
							aria-hidden='true'
							className='size-3 shrink-0 group-data-[state=open]:rotate-90'
						/>
						{t('workbench:agents.closed-heading', 'Closed')}
						<span className='ml-auto shrink-0 font-mono tabular-nums'>
							{rows.length}
						</span>
					</CollapsibleTrigger>
				</h3>
				<CollapsibleContent asChild>
					<ul className='flex flex-col gap-1'>
						{rows.map((conversation) => (
							<li key={`closed-${conversation.chatTabId}`}>
								<AgentRow
									conversation={conversation}
									isPlaceholder={false}
									isSelected={false}
									onRestore={onRestore}
									onSelect={onSelect}
									parentTitle={
										conversation.parentChatTabId
											? titles.get(conversation.parentChatTabId)
											: undefined
									}
								/>
							</li>
						))}
					</ul>
				</CollapsibleContent>
			</section>
		</Collapsible>
	);
}

/** State-specific contents of the Agents panel. */
function AgentsPanelBody({
	conversations,
	onRestore,
	onRetry,
	onSelect,
	selectedChatTabId,
	state,
}: Required<
	Pick<AgentsPanelProps, 'conversations' | 'onRestore' | 'onSelect'>
> &
	Pick<AgentsPanelProps, 'onRetry'> & {
		selectedChatTabId: string | null;
		state: NonNullable<AgentsPanelProps['state']>;
	}) {
	const { t } = useTranslation();
	if (state === 'loading') {
		return (
			<div
				className='flex h-32 items-center justify-center gap-2 text-muted-foreground text-xs'
				role='status'
			>
				<Loader2Icon aria-hidden='true' className='size-4 animate-spin' />
				{t('workbench:agents.loading', 'Loading agent conversations…')}
			</div>
		);
	}
	if (state === 'error') {
		return (
			<div
				className='flex h-40 flex-col items-center justify-center gap-3 text-center'
				role='alert'
			>
				<AlertCircleIcon
					aria-hidden='true'
					className='size-5 text-destructive'
				/>
				<p className='text-muted-foreground text-xs'>
					{t('workbench:agents.error', 'Could not load agent conversations.')}
				</p>
				{onRetry ? (
					<Button onClick={onRetry} size='xs' type='button' variant='ghost'>
						{t('workbench:agents.retry', 'Retry')}
					</Button>
				) : null}
			</div>
		);
	}
	if (conversations.length === 0) {
		return (
			<PanelPlaceholder
				icon={BotIcon}
				message={t(
					'workbench:agents.empty-message',
					'Agent conversations appear here.',
				)}
				title={t('workbench:agents.empty', 'No agent conversations yet')}
			/>
		);
	}

	const openTree = openConversationTree(conversations);
	const closedRows = conversations.filter(
		(conversation) =>
			conversation.isClosed && !openTree.visibleIds.has(conversation.chatTabId),
	);
	const titles = new Map(
		conversations.map((conversation) => [
			conversation.chatTabId,
			conversation.title,
		]),
	);
	return (
		<>
			<OpenConversationSection
				onRestore={onRestore}
				onSelect={onSelect}
				rows={openTree.nodes}
				selectedChatTabId={selectedChatTabId}
			/>
			<ClosedConversationSection
				onRestore={onRestore}
				onSelect={onSelect}
				rows={closedRows}
				titles={titles}
			/>
		</>
	);
}

/** Prop-driven workspace panel for open and closed agent conversations. */
export function AgentsPanel({
	conversations,
	onRestore,
	onRetry,
	onSelect,
	selectedChatTabId = null,
	state = 'ready',
}: AgentsPanelProps) {
	const { t } = useTranslation();
	return (
		<aside
			aria-label={t('workbench:agents.label', 'Agents')}
			className='h-full min-h-0 bg-transparent'
		>
			<div
				className={cn(
					'sleek-scrollbar h-full min-h-0 overflow-y-auto',
					(state !== 'ready' || conversations.length > 0) && 'p-2',
				)}
			>
				<AgentsPanelBody
					conversations={conversations}
					onRestore={onRestore}
					onRetry={onRetry}
					onSelect={onSelect}
					selectedChatTabId={selectedChatTabId}
					state={state}
				/>
			</div>
		</aside>
	);
}
