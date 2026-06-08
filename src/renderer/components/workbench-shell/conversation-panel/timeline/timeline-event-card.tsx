import {
	AlertTriangleIcon,
	BotIcon,
	CircleDashedIcon,
	type LucideIcon,
	SquareTerminalIcon,
	UserIcon,
} from 'lucide-react';

import { StatusBadge } from '@/renderer/components/status-badge';
import { cn } from '@/renderer/lib/utils';
import type { PiSessionEventWire } from '@/shared/ipc';

/**
 * Renders a single `pi_session_events` row. The structured event model keeps
 * roles, tool calls, errors, and metadata visually distinct — never a flat
 * terminal transcript (ADR-0025: Pi RPC is structured, not a tty stream).
 */
export function TimelineEventCard({ event }: { event: PiSessionEventWire }) {
	if (event.stream === 'stderr') {
		return <StderrCard event={event} />;
	}
	switch (event.eventType) {
		case 'message':
			return <MessageCard event={event} />;
		case 'status':
			return <StatusCard event={event} />;
		case 'error':
			return <ErrorCard event={event} />;
		case 'metadata':
			return <MetadataCard event={event} />;
		case 'shutdown':
			return <ShutdownCard event={event} />;
		default:
			return <UnknownCard event={event} />;
	}
}

function MessageCard({ event }: { event: PiSessionEventWire }) {
	const role = readMessageRole(event.payload);
	const text = readMessageText(event.payload);
	const isUser = role === 'user';
	const Avatar: LucideIcon = isUser ? UserIcon : BotIcon;

	return (
		<article
			className={cn('flex gap-3', isUser && 'justify-end')}
			data-event-id={event.id}
			data-event-type='message'
			data-message-role={role}
		>
			{isUser ? null : <AvatarBubble icon={Avatar} tone='muted' />}
			<div
				className={cn(
					'flex min-w-0 max-w-[min(38rem,100%)] flex-col gap-1.5',
					isUser && 'items-end',
				)}
			>
				<div className='flex items-center gap-2 text-muted-foreground text-xs'>
					<span className='font-medium text-foreground'>
						{isUser ? 'You' : role === 'tool' ? 'Tool' : 'Pi'}
					</span>
					<time>{event.createdAt}</time>
				</div>
				<div
					className={cn(
						'rounded-md px-3 py-2 text-[0.8125rem] leading-5',
						isUser
							? 'bg-primary/15 text-foreground'
							: 'border border-border bg-pane text-foreground',
					)}
				>
					{text ? (
						<p>{text}</p>
					) : (
						<p className='text-muted-foreground'>(no text)</p>
					)}
				</div>
			</div>
			{isUser ? <AvatarBubble icon={Avatar} tone='primary' /> : null}
		</article>
	);
}

function StatusCard({ event }: { event: PiSessionEventWire }) {
	const status = readPayloadField(event.payload, 'status') ?? 'unknown';
	const previous = readPayloadField(event.payload, 'previous');
	return (
		<article
			className='flex items-center gap-2 px-3 text-muted-foreground text-xs'
			data-event-id={event.id}
			data-event-type='status'
		>
			<CircleDashedIcon aria-hidden='true' className='size-3.5' />
			<span>
				Status: <span className='font-medium text-foreground'>{status}</span>
				{previous ? <span> (was {previous})</span> : null}
			</span>
		</article>
	);
}

function ErrorCard({ event }: { event: PiSessionEventWire }) {
	const error = readErrorPayload(event.payload);
	return (
		<article
			className='flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3'
			data-event-id={event.id}
			data-event-type='error'
		>
			<AlertTriangleIcon
				aria-hidden='true'
				className='mt-0.5 size-4 shrink-0 text-status-warning'
			/>
			<div className='min-w-0 flex-1'>
				<p className='font-medium text-foreground text-xs'>
					{error.message ?? 'Runtime error'}
				</p>
				{error.detail ? (
					<p className='mt-0.5 break-words text-muted-foreground text-xs'>
						{error.detail}
					</p>
				) : null}
				<StatusBadge className='mt-1.5' tone='warning'>
					{error.recoverable ? 'recoverable' : 'fatal'}
				</StatusBadge>
			</div>
		</article>
	);
}

function StderrCard({ event }: { event: PiSessionEventWire }) {
	const error = readErrorPayload(event.payload);
	return (
		<article
			className='flex items-start gap-2 rounded-md border border-border bg-pane/60 p-2.5 font-mono text-[0.7rem] text-muted-foreground'
			data-event-id={event.id}
			data-event-type='stderr'
		>
			<SquareTerminalIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0'
			/>
			<pre className='min-w-0 flex-1 whitespace-pre-wrap break-words'>
				{error.detail ?? '(empty stderr chunk)'}
			</pre>
		</article>
	);
}

function MetadataCard({ event }: { event: PiSessionEventWire }) {
	const sessionId =
		readPayloadField(event.payload, ['metadata', 'sessionId']) ?? null;
	if (!sessionId) {
		return null;
	}
	return (
		<article
			className='px-3 text-muted-foreground text-xs'
			data-event-id={event.id}
			data-event-type='metadata'
		>
			<span>
				Pi runtime session id: <span className='font-mono'>{sessionId}</span>
			</span>
		</article>
	);
}

function ShutdownCard({ event }: { event: PiSessionEventWire }) {
	const reason = readPayloadField(event.payload, 'reason') ?? 'manual';
	return (
		<article
			className='flex items-center gap-2 rounded-md border border-border bg-pane/60 px-3 py-1.5 text-muted-foreground text-xs'
			data-event-id={event.id}
			data-event-type='shutdown'
		>
			<span>Session ended ({reason})</span>
		</article>
	);
}

function UnknownCard({ event }: { event: PiSessionEventWire }) {
	return (
		<article
			className='rounded-md border border-border bg-pane/60 p-2.5 text-muted-foreground text-xs'
			data-event-id={event.id}
			data-event-type='unknown'
		>
			<span className='font-mono'>{event.eventType}</span>
		</article>
	);
}

function AvatarBubble({
	icon: Icon,
	tone,
}: {
	icon: LucideIcon;
	tone: 'muted' | 'primary';
}) {
	return (
		<div
			className={cn(
				'mt-5 grid size-7 shrink-0 place-items-center rounded-full border',
				tone === 'primary'
					? 'border-primary/30 bg-primary/15 text-primary-foreground'
					: 'border-border bg-pane text-muted-foreground',
			)}
		>
			<Icon aria-hidden='true' className='size-3.5' />
		</div>
	);
}

function readMessageRole(payload: unknown): 'agent' | 'tool' | 'user' {
	const role = readPayloadField(payload, 'role');
	if (role === 'user' || role === 'tool' || role === 'agent') {
		return role;
	}
	return 'agent';
}

function readMessageText(payload: unknown): string | null {
	const inline = readPayloadField(payload, ['payload', 'text']);
	if (typeof inline === 'string') {
		return inline;
	}
	const flatText = readPayloadField(payload, 'text');
	if (typeof flatText === 'string') {
		return flatText;
	}
	const prompt = readPayloadField(payload, ['payload', 'prompt']);
	if (typeof prompt === 'string') {
		return prompt;
	}
	return null;
}

function readErrorPayload(payload: unknown): {
	detail: string | null;
	message: string | null;
	recoverable: boolean;
} {
	const message = readPayloadField(payload, ['error', 'message']);
	const detail = readPayloadField(payload, ['error', 'detail']);
	const recoverableRaw = readPayloadField(payload, ['error', 'recoverable']);
	const recoverable = recoverableRaw !== 'false' && recoverableRaw !== false;
	return {
		detail: typeof detail === 'string' ? detail : null,
		message: typeof message === 'string' ? message : null,
		recoverable,
	};
}

type PrimitiveField = string | number | boolean | null | undefined;

function readPayloadField(
	payload: unknown,
	key: readonly string[] | string,
): PrimitiveField {
	if (!payload || typeof payload !== 'object') {
		return undefined;
	}
	const path = typeof key === 'string' ? [key] : key;
	let current: unknown = payload;
	for (const segment of path) {
		if (!current || typeof current !== 'object') {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	if (
		typeof current === 'string' ||
		typeof current === 'number' ||
		typeof current === 'boolean' ||
		current === null ||
		current === undefined
	) {
		return current;
	}
	return undefined;
}
