import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
	CheckIcon,
	CircleSlashIcon,
	ClockIcon,
	PlugIcon,
	RefreshCwIcon,
	TriangleAlertIcon,
	XIcon,
} from 'lucide-react';
import {
	type ComponentType,
	type CSSProperties,
	useCallback,
	useMemo,
	useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
	agentProviderExecutablePathQuery,
	agentProviderMcpServersQuery,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import { useRequestDockTerminal } from '@/renderer/state/workspace/terminal-requests';
import { getAgentProviderDescriptor } from '@/shared/agent-provider';
import type {
	AgentProviderMcpServerWire,
	AgentProviderMcpStatus,
	ListAgentProviderMcpServersResult,
} from '@/shared/ipc/contracts/agent-provider';
import { getRosterHeight } from './mcp-roster-height';

const CLAUDE_DESCRIPTOR = getAgentProviderDescriptor('claude');

/** Slash command that opens Claude Code's own MCP management screen. */
const MCP_COMMAND = '/mcp';

/**
 * Geometry every roster row shares. An authorise row is a real `<button>` rather
 * than a styled `Button`, so that both kinds of row are laid out by one class
 * string and cannot drift apart on height, padding, or gap.
 */
const ROW_CLASSES =
	'flex w-full items-center gap-2 rounded-md px-1 py-1 text-left';

/**
 * How each connection state reads: its icon, tint, and right-hand label. The
 * label is a resolver rather than a string so the row renders it in the active
 * language; a connected server states its health with the glyph alone.
 */
const STATUS_PRESENTATION = {
	connected: { icon: CheckIcon, label: null, tint: 'text-status-ok' },
	disabled: {
		icon: CircleSlashIcon,
		label: (t: TFunction) =>
			t('workbench:mcp-servers.status.disabled', 'Disabled'),
		tint: 'text-muted-foreground',
	},
	failed: {
		icon: XIcon,
		label: (t: TFunction) => t('workbench:mcp-servers.status.failed', 'Error'),
		tint: 'text-status-danger',
	},
	'needs-auth': {
		icon: TriangleAlertIcon,
		label: (t: TFunction) =>
			t('workbench:mcp-servers.status.needs-auth', 'Needs auth'),
		tint: 'text-status-warning',
	},
	pending: {
		icon: ClockIcon,
		label: (t: TFunction) =>
			t('workbench:mcp-servers.status.pending', 'Awaiting status'),
		tint: 'text-accent-strong',
	},
} satisfies Record<
	AgentProviderMcpStatus,
	{
		icon: ComponentType<{ className?: string }>;
		label: ((t: TFunction) => string) | null;
		tint: string;
	}
>;

/**
 * Builds the shell command that drops the user into Claude Code's MCP screen.
 * Single-quoted so a runtime installed under a path with spaces still resolves,
 * with embedded quotes escaped the POSIX way.
 * @param executablePath - Runtime path the readiness probe resolved, when it did.
 * @returns The command a dock terminal runs.
 */
function buildMcpCommand(executablePath: string | null): string {
	const executable = executablePath || CLAUDE_DESCRIPTOR.executableCommand;
	return `'${executable.replaceAll("'", `'\\''`)}' ${MCP_COMMAND}`;
}

/**
 * Explains an empty roster: "none configured" and "could not be read" look the
 * same on screen but mean opposite things.
 * @param result - The roster the runtime returned, when it answered at all.
 * @param t - Translator from the calling component, so the line follows the UI language.
 * @returns The line the panel shows in place of rows.
 */
function emptyRosterMessage(
	result: ListAgentProviderMcpServersResult | undefined,
	t: TFunction,
): string {
	return (
		result?.error ??
		t('workbench:mcp-servers.empty', 'No MCP servers are configured.')
	);
}

/**
 * One MCP server row: status glyph, name, and the state on the right. A
 * `needs-auth` row is the whole row rendered as a button, because authorising is
 * the one thing Ensemblr can hand off to the runtime rather than only report,
 * and the target should be the row the user is already reading.
 */
function McpServerRow({
	onAuthorize,
	server,
}: {
	onAuthorize: (() => void) | null;
	server: AgentProviderMcpServerWire;
}) {
	const { t } = useTranslation();
	const presentation = STATUS_PRESENTATION[server.status];
	const StatusIcon = presentation.icon;
	const statusLabel = presentation.label?.(t) ?? null;
	const cells = (
		<>
			<StatusIcon className={cn('size-3.5 shrink-0', presentation.tint)} />
			<span className='min-w-0 flex-1 truncate text-foreground text-xs'>
				{server.name}
			</span>
			{statusLabel ? (
				<span className={cn('shrink-0 text-xxs', presentation.tint)}>
					{statusLabel}
				</span>
			) : null}
		</>
	);

	const row = onAuthorize ? (
		<button
			aria-label={t('workbench:mcp-servers.authorise', 'Authorise {{name}}', {
				name: server.name,
			})}
			className={cn(
				ROW_CLASSES,
				'transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
			)}
			onClick={onAuthorize}
			type='button'
		>
			{cells}
		</button>
	) : (
		<div className={ROW_CLASSES}>{cells}</div>
	);

	return server.error ? (
		<Tooltip>
			<TooltipTrigger asChild>{row}</TooltipTrigger>
			<TooltipContent>{server.error}</TooltipContent>
		</Tooltip>
	) : (
		row
	);
}

/**
 * Composer chip auditing Claude Code's MCP servers. The roster is read against
 * the workspace directory, so it covers every tier `claude` itself would see —
 * user, project, local, plugin, and remote connectors — rather than only the
 * global ones. Reading it starts a runtime child, so it is deferred until the
 * panel is first opened and refreshed only on demand.
 *
 * Claude-only by construction — pi reports an empty roster, and the caller
 * renders this chip only for a Claude-backed chat.
 */
export function McpServersPanel({
	cwd,
	disabled,
	workspaceId = null,
}: {
	/** Directory the roster resolves project- and local-scope servers against. */
	cwd: string;
	disabled?: boolean;
	/**
	 * Workspace whose dock hosts the terminal the `claude mcp` authorize flow runs
	 * in. Null for the Concierge, which has no workspace and cannot open a
	 * terminal — the roster still reads, and a server needing auth simply offers
	 * no authorize control rather than one that would fail.
	 */
	workspaceId?: string | null;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const { data, isFetching, refetch } = useQuery({
		...agentProviderMcpServersQuery('claude', cwd),
		enabled: open && cwd.length > 0,
	});
	const { data: executable } = useQuery({
		...agentProviderExecutablePathQuery('claude'),
		enabled: open,
	});
	const requestDockTerminal = useRequestDockTerminal();
	const servers = data?.servers ?? [];

	const authorize = useCallback(() => {
		if (!workspaceId) {
			return;
		}
		requestDockTerminal({
			command: buildMcpCommand(executable?.resolvedPath ?? null),
			title: `${CLAUDE_DESCRIPTOR.label} ${MCP_COMMAND}`,
			workspaceId,
		});
		setOpen(false);
	}, [executable?.resolvedPath, requestDockTerminal, workspaceId]);

	const scrollAreaStyle = useMemo<CSSProperties>(
		() => ({ height: getRosterHeight(servers.length) }),
		[servers.length],
	);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label={t('workbench:mcp-servers.aria-label', 'MCP servers')}
							className='rounded-md'
							disabled={disabled}
							size='icon-sm'
							type='button'
							variant='subtle'
						>
							<PlugIcon className='size-3.5' />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent sideOffset={4}>
					{t('workbench:mcp-servers.aria-label', 'MCP servers')}
				</TooltipContent>
			</Tooltip>
			<PopoverContent align='start' className='w-72 overflow-hidden p-1.5'>
				<div className='flex items-center justify-between gap-2 px-1 pb-1'>
					<span className='text-muted-foreground text-xs'>
						{t('workbench:mcp-servers.heading', 'MCPs')}
					</span>
					<Button
						aria-label={t(
							'workbench:mcp-servers.refresh',
							'Refresh MCP servers',
						)}
						className='size-6 rounded-md'
						disabled={isFetching}
						onClick={() => void refetch()}
						size='icon-sm'
						type='button'
						variant='ghost'
					>
						{isFetching ? (
							<Spinner className='size-3.5' />
						) : (
							<RefreshCwIcon className='size-3.5' />
						)}
					</Button>
				</div>
				{servers.length === 0 ? (
					<p className='px-1 py-2 text-muted-foreground text-xs'>
						{isFetching
							? t('workbench:mcp-servers.loading', 'Reading the MCP roster…')
							: emptyRosterMessage(data, t)}
					</p>
				) : (
					<ScrollArea className='-mr-1.5 pr-1.5' style={scrollAreaStyle}>
						<div className='flex flex-col'>
							{servers.map((server) => (
								<McpServerRow
									key={server.name}
									onAuthorize={
										server.status === 'needs-auth' && workspaceId
											? authorize
											: null
									}
									server={server}
								/>
							))}
						</div>
					</ScrollArea>
				)}
			</PopoverContent>
		</Popover>
	);
}
