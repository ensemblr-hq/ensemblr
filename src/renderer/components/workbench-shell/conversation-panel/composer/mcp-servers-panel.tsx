import { useQuery } from '@tanstack/react-query';
import {
	CheckIcon,
	CircleSlashIcon,
	ClockIcon,
	PlugIcon,
	RefreshCwIcon,
	TriangleAlertIcon,
	XIcon,
} from 'lucide-react';
import { type ComponentType, useCallback, useState } from 'react';

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

const CLAUDE_DESCRIPTOR = getAgentProviderDescriptor('claude');

/** Slash command that opens Claude Code's own MCP management screen. */
const MCP_COMMAND = '/mcp';

/** How each connection state reads: its icon, tint, and right-hand label. */
const STATUS_PRESENTATION = {
	connected: { icon: CheckIcon, label: null, tint: 'text-status-ok' },
	disabled: {
		icon: CircleSlashIcon,
		label: 'Disabled',
		tint: 'text-muted-foreground',
	},
	failed: { icon: XIcon, label: 'Error', tint: 'text-status-danger' },
	'needs-auth': {
		icon: TriangleAlertIcon,
		label: 'Needs auth',
		tint: 'text-status-warning',
	},
	pending: {
		icon: ClockIcon,
		label: 'Awaiting status',
		tint: 'text-accent-strong',
	},
} satisfies Record<
	AgentProviderMcpStatus,
	{
		icon: ComponentType<{ className?: string }>;
		label: string | null;
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
 * @returns The line the panel shows in place of rows.
 */
function emptyRosterMessage(
	result: ListAgentProviderMcpServersResult | undefined,
): string {
	return result?.error ?? 'No MCP servers are configured.';
}

/** Counts the servers the user can actually do something about. */
function countUnhealthy(
	servers: readonly AgentProviderMcpServerWire[],
): number {
	return servers.filter(
		(server) => server.status === 'failed' || server.status === 'needs-auth',
	).length;
}

/**
 * One MCP server row: status glyph, name, and the state on the right. A
 * `needs-auth` row's state is a button, because authorising is the one thing
 * Ensemblr can hand off to the runtime rather than only report.
 */
function McpServerRow({
	onAuthorize,
	server,
}: {
	onAuthorize: (() => void) | null;
	server: AgentProviderMcpServerWire;
}) {
	const presentation = STATUS_PRESENTATION[server.status];
	const StatusIcon = presentation.icon;
	const nameCell = (
		<span className='flex min-w-0 items-center gap-2'>
			<StatusIcon className={cn('size-3.5 shrink-0', presentation.tint)} />
			<span className='truncate text-foreground text-xs'>{server.name}</span>
			{server.scope ? (
				<span className='shrink-0 text-muted-foreground text-xxs'>
					{server.scope}
				</span>
			) : null}
		</span>
	);

	return (
		<div className='flex items-center justify-between gap-2 rounded-md px-1 py-1'>
			{server.error ? (
				<Tooltip>
					<TooltipTrigger asChild>{nameCell}</TooltipTrigger>
					<TooltipContent>{server.error}</TooltipContent>
				</Tooltip>
			) : (
				nameCell
			)}
			{onAuthorize ? (
				<Button
					className='h-5 shrink-0 rounded-md px-1.5 text-xxs'
					onClick={onAuthorize}
					size='sm'
					type='button'
					variant='subtle'
				>
					{presentation.label}
				</Button>
			) : (
				presentation.label && (
					<span className={cn('shrink-0 text-xxs', presentation.tint)}>
						{presentation.label}
					</span>
				)
			)}
		</div>
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
	workspaceId,
}: {
	/** Workspace directory the roster resolves project- and local-scope servers against. */
	cwd: string;
	disabled?: boolean;
	workspaceId: string;
}) {
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
		requestDockTerminal({
			command: buildMcpCommand(executable?.resolvedPath ?? null),
			title: `${CLAUDE_DESCRIPTOR.label} ${MCP_COMMAND}`,
			workspaceId,
		});
		setOpen(false);
	}, [executable?.resolvedPath, requestDockTerminal, workspaceId]);

	const unhealthy = countUnhealthy(servers);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label='MCP servers'
							className={cn(
								'h-7 rounded-md px-2 font-medium',
								unhealthy > 0 &&
									'bg-status-warning/10 text-status-warning hover:bg-status-warning/15 hover:text-status-warning',
							)}
							disabled={disabled}
							size='sm'
							type='button'
							variant='subtle'
						>
							<PlugIcon className='size-3.5' />
							{unhealthy > 0 ? <span>{unhealthy}</span> : null}
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent sideOffset={4}>MCP servers</TooltipContent>
			</Tooltip>
			<PopoverContent align='start' className='w-72 overflow-hidden p-1.5'>
				<div className='flex items-center justify-between gap-2 px-1 pb-1'>
					<span className='text-muted-foreground text-xs'>MCPs</span>
					<Button
						aria-label='Refresh MCP servers'
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
						{isFetching ? 'Reading the MCP roster…' : emptyRosterMessage(data)}
					</p>
				) : (
					<ScrollArea className='max-h-72 pr-3.5'>
						<div className='flex flex-col'>
							{servers.map((server) => (
								<McpServerRow
									key={server.name}
									onAuthorize={
										server.status === 'needs-auth' ? authorize : null
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
