import {
	BanIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ShieldAlertIcon,
	XIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { BundledLanguage } from 'shiki';
import { CodeBlock } from '@/renderer/components/code-block';
import { Terminal } from '@/renderer/components/terminal';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { Spinner } from '@/renderer/components/ui/spinner';
import { summarizeToolCall } from '@/renderer/lib/pi-timeline';
import { cn } from '@/renderer/lib/utils';
import type {
	PiToolCallItem,
	PiToolCallStatus,
} from '@/renderer/types/pi-timeline';

const COLLAPSED_TAIL_LINES = 24;
const ERROR_TAIL_LINES = 10;

/**
 * One tool call as a collapsed-by-default card: status icon, tool name, and a
 * one-line arg summary. Expanding reveals the full args plus the accumulated
 * output in a scroll-contained block (ANSI rendered via Terminal for shell
 * output, diff rendering for edits). Failed calls auto-expand showing only
 * the last ~10 lines of their error output.
 */
export function PiToolCard({
	call,
	className,
}: {
	call: PiToolCallItem;
	className?: string;
}) {
	const failed = call.status === 'error';
	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const open = userOpen ?? failed;
	const summary = summarizeToolCall(call);
	const durationMs =
		call.endedAtMs !== null ? call.endedAtMs - call.startedAtMs : null;
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	const awaitingApproval =
		call.status === 'awaiting-approval' && call.approval?.settledAtMs === null;

	return (
		<Collapsible
			className={cn('w-full', className)}
			data-kind='tool-call'
			data-role='timeline-item'
			data-status={call.status}
			onOpenChange={setUserOpen}
			open={open}
		>
			<CollapsibleTrigger className='group flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[0.8125rem] leading-5 transition-colors hover:bg-secondary/50'>
				<Chevron
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground/60'
				/>
				<ToolStatusIcon status={call.status} />
				<span className='shrink-0 font-medium text-foreground/85'>
					{call.toolName}
				</span>
				{summary ? (
					<span className='min-w-0 truncate font-mono text-muted-foreground text-xs'>
						{summary}
					</span>
				) : null}
				{durationMs !== null ? (
					<span className='ml-auto shrink-0 text-muted-foreground/60 text-xs'>
						{(durationMs / 1000).toFixed(1)}s
					</span>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className='flex flex-col gap-2 py-1.5 pl-6'>
					{awaitingApproval && call.approval ? (
						<div className='flex items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1.5 text-status-warning text-xs'>
							<ShieldAlertIcon aria-hidden='true' className='size-3.5' />
							<span>
								{call.approval.title}
								{call.approval.message ? ` — ${call.approval.message}` : null}
							</span>
						</div>
					) : null}
					<ToolArgs args={call.args} />
					<ToolOutput call={call} failed={failed} />
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** Status icon per lifecycle state: spinner / check / red x / ban / shield. */
function ToolStatusIcon({ status }: { status: PiToolCallStatus }) {
	switch (status) {
		case 'running':
			return <Spinner className='size-3.5 shrink-0 text-muted-foreground' />;
		case 'awaiting-approval':
			return (
				<ShieldAlertIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-status-warning'
				/>
			);
		case 'success':
			return (
				<CheckIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-status-ok'
				/>
			);
		case 'error':
			return (
				<XIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-status-danger'
				/>
			);
		case 'cancelled':
			return (
				<BanIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground/70'
				/>
			);
		default:
			return null;
	}
}

/** Full args, compact: single string args render bare, others as JSON. */
function ToolArgs({ args }: { args: Readonly<Record<string, unknown>> }) {
	const entries = Object.entries(args);
	if (entries.length === 0) {
		return null;
	}
	const single = entries.length === 1 ? entries[0] : null;
	const body =
		single && typeof single[1] === 'string'
			? `${single[0]}: ${single[1]}`
			: JSON.stringify(args, null, 2);
	return (
		<pre className='max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-secondary/40 px-2 py-1.5 font-mono text-muted-foreground text-xs'>
			{body}
		</pre>
	);
}

/**
 * Scroll-contained output block. Long output collapses to the trailing lines
 * with a "Show all N lines" toggle; failed calls show only the error tail.
 * Edits render their unified diff; shell output renders through Terminal so
 * ANSI colors survive (verified against unicode-and-ansi.jsonl).
 */
function ToolOutput({
	call,
	failed,
}: {
	call: PiToolCallItem;
	failed: boolean;
}) {
	const [showAll, setShowAll] = useState(false);
	const diff =
		call.details && typeof call.details.diff === 'string'
			? call.details.diff
			: null;
	if (diff) {
		return (
			<div className='max-h-72 overflow-auto'>
				<CodeBlock code={diff} language={'diff' as BundledLanguage} />
			</div>
		);
	}
	if (call.output.length === 0) {
		return null;
	}
	const lines = call.output.replace(/\n$/, '').split('\n');
	const tailLength = failed ? ERROR_TAIL_LINES : COLLAPSED_TAIL_LINES;
	const truncated = !showAll && lines.length > tailLength;
	const visible = truncated ? lines.slice(-tailLength) : lines;
	return (
		<div className='flex flex-col gap-1.5'>
			{truncated ? (
				<button
					className='w-fit rounded-md px-1 text-muted-foreground text-xs underline-offset-2 transition-colors hover:text-foreground hover:underline'
					onClick={() => setShowAll(true)}
					type='button'
				>
					Show all {lines.length} lines
				</button>
			) : null}
			<div className='max-h-72 overflow-auto'>
				{call.toolName === 'bash' ? (
					<Terminal
						isStreaming={call.status === 'running'}
						output={visible.join('\n')}
					/>
				) : (
					<pre
						className={cn(
							'whitespace-pre-wrap break-all rounded-md bg-secondary/40 px-2 py-1.5 font-mono text-xs',
							failed ? 'text-status-danger' : 'text-foreground/85',
						)}
					>
						{visible.join('\n')}
					</pre>
				)}
			</div>
		</div>
	);
}
