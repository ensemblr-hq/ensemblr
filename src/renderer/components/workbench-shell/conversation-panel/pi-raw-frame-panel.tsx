import {
	ArrowDownIcon,
	ArrowUpIcon,
	CheckIcon,
	CopyIcon,
	EraserIcon,
	XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import {
	useClearRawFrames,
	useDebugPanelToggle,
	useRawFrames,
} from '@/renderer/state/pi-raw-frames';
import type { PiRawFrameKind } from '@/shared/ipc';

/**
 * Temporary debug overlay that streams the raw JSONL frames Pi sends to/from
 * Ensemble. Used while iterating on conversation UI so the surface can be
 * compared against the underlying protocol without spelunking through logs.
 */
export function PiRawFramePanel({ sessionId }: { sessionId: string | null }) {
	const [open, setOpen] = useDebugPanelToggle();
	const allFrames = useRawFrames();
	const clear = useClearRawFrames();
	const [filter, setFilter] = useState<'all' | 'rx' | 'tx'>('all');
	// Default off: raw frames carry the adapter-internal session id, which
	// does not match the renderer-side Ensemble session id. Until that
	// mapping is plumbed, scoping silently hides everything.
	const [sessionScope, setSessionScope] = useState<boolean>(false);
	// Per-kind visibility — main chat traffic is the default surface; the
	// internal title-gen and summary-gen sessions are noisy so they start
	// hidden and can be toggled in.
	const [kindToggles, setKindToggles] = useState<
		Record<PiRawFrameKind, boolean>
	>({
		chat: true,
		summary: false,
		title: false,
		unknown: true,
	});
	const toggleKind = (kind: PiRawFrameKind): void => {
		setKindToggles((prev) => ({ ...prev, [kind]: !prev[kind] }));
	};
	// Thinking deltas carry long base64 cryptographic signatures that crowd the
	// view. Hidden by default; toggle off to see the raw payload.
	const [hideSignatures, setHideSignatures] = useState<boolean>(true);
	// Pi pings `get_session_stats` after every agent_end to refresh the context
	// usage gauge. The call/response pair is high-frequency housekeeping
	// noise, so it is hidden by default.
	const [hideSessionStats, setHideSessionStats] = useState<boolean>(true);

	const frames = useMemo(() => {
		return allFrames.filter((frame) => {
			if (!kindToggles[frame.kind]) {
				return false;
			}
			if (sessionScope && sessionId && frame.sessionId !== sessionId) {
				return false;
			}
			if (filter !== 'all' && frame.direction !== filter) {
				return false;
			}
			if (
				hideSessionStats &&
				(frame.category === 'session-stats-call' ||
					frame.category === 'session-stats-response')
			) {
				return false;
			}
			return true;
		});
	}, [
		allFrames,
		filter,
		hideSessionStats,
		kindToggles,
		sessionId,
		sessionScope,
	]);

	const listRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!open) {
			return;
		}
		const node = listRef.current;
		if (!node) {
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [open]);

	if (!open) {
		return null;
	}

	return (
		<aside
			aria-label='Pi raw frames debug panel'
			className='pointer-events-auto absolute top-0 right-0 z-30 flex h-full w-[30rem] flex-col border-border border-l bg-background/95 shadow-lg backdrop-blur'
			data-debug-panel='pi-raw-frames'
		>
			<header className='flex shrink-0 flex-col gap-2 border-border border-b px-3 py-2'>
				<div className='flex items-center justify-between gap-2'>
					<div className='flex items-center gap-2'>
						<span className='font-medium text-xs'>Pi raw frames</span>
						<span
							className='rounded-sm bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground'
							title='visible / total captured'
						>
							{frames.length} / {allFrames.length}
						</span>
					</div>
					<div className='flex items-center gap-1'>
						<FilterButton
							active={filter === 'all'}
							label='all'
							onClick={() => setFilter('all')}
						/>
						<FilterButton
							active={filter === 'rx'}
							label='rx'
							onClick={() => setFilter('rx')}
						/>
						<FilterButton
							active={filter === 'tx'}
							label='tx'
							onClick={() => setFilter('tx')}
						/>
						<Button
							aria-label='Toggle session scope'
							className={cn(
								'h-6 rounded-sm px-1.5 text-[0.625rem]',
								sessionScope
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground',
							)}
							onClick={() => setSessionScope((prev) => !prev)}
							size='xs'
							type='button'
							variant='ghost'
						>
							this session
						</Button>
						<Button
							aria-label='Clear frames'
							onClick={clear}
							size='icon-xs'
							type='button'
							variant='ghost'
						>
							<EraserIcon />
						</Button>
						<Button
							aria-label='Close debug panel'
							onClick={() => setOpen(false)}
							size='icon-xs'
							type='button'
							variant='ghost'
						>
							<XIcon />
						</Button>
					</div>
				</div>
				<div className='flex flex-wrap items-center gap-1 text-[0.625rem] text-muted-foreground'>
					<span className='mr-1 uppercase tracking-wide'>kind:</span>
					<KindToggle
						active={kindToggles.chat}
						label='chat'
						onClick={() => toggleKind('chat')}
					/>
					<KindToggle
						active={kindToggles.title}
						label='title-gen'
						onClick={() => toggleKind('title')}
					/>
					<KindToggle
						active={kindToggles.summary}
						label='summary-gen'
						onClick={() => toggleKind('summary')}
					/>
					<KindToggle
						active={kindToggles.unknown}
						label='other'
						onClick={() => toggleKind('unknown')}
					/>
					<span className='mr-1 ml-2 uppercase tracking-wide'>noise:</span>
					<KindToggle
						active={hideSignatures}
						label='hide signatures'
						onClick={() => setHideSignatures((prev) => !prev)}
					/>
					<KindToggle
						active={hideSessionStats}
						label='hide session_stats'
						onClick={() => setHideSessionStats((prev) => !prev)}
					/>
				</div>
			</header>
			<div
				className='flex-1 overflow-y-auto px-3 py-2 font-mono text-[0.6875rem]'
				ref={listRef}
			>
				{frames.length === 0 ? (
					<p className='text-muted-foreground text-xs'>
						Waiting for Pi traffic…
					</p>
				) : (
					<ul className='flex flex-col gap-2'>
						{frames.map((frame) => (
							<FrameItem
								frame={frame}
								hideSignatures={hideSignatures}
								key={frame.id}
							/>
						))}
					</ul>
				)}
			</div>
		</aside>
	);
}

function FilterButton({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			className={cn(
				'h-6 rounded-sm px-1.5 text-[0.625rem] uppercase tracking-wide',
				active ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
			)}
			onClick={onClick}
			size='xs'
			type='button'
			variant='ghost'
		>
			{label}
		</Button>
	);
}

/**
 * Recursively replaces any signature-bearing field with a short placeholder.
 * Pi/Anthropic emit several variants — bare `signature`, `thinkingSignature`,
 * `responseSignature`, and nested `encrypted_content` blobs inside JSON-
 * serialised signature strings. We match by substring so future variants are
 * covered without code changes.
 */
function stripSignatures(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => stripSignatures(entry));
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(
			value as Record<string, unknown>,
		)) {
			const lowered = key.toLowerCase();
			if (
				lowered.includes('signature') ||
				lowered === 'encrypted_content' ||
				lowered === 'encryptedcontent'
			) {
				out[key] = '<…stripped…>';
				continue;
			}
			out[key] = stripSignatures(entry);
		}
		return out;
	}
	return value;
}

function KindToggle({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			className={cn(
				'h-5 rounded-sm px-1.5 text-[0.625rem]',
				active
					? 'bg-primary/15 text-primary'
					: 'bg-transparent text-muted-foreground/60 line-through',
			)}
			onClick={onClick}
			size='xs'
			type='button'
			variant='ghost'
		>
			{label}
		</Button>
	);
}

function FrameItem({
	frame,
	hideSignatures,
}: {
	frame: {
		at: string;
		direction: 'rx' | 'tx';
		kind: PiRawFrameKind;
		label: string;
		line: string;
		sessionId: string;
	};
	hideSignatures: boolean;
}) {
	const pretty = useMemo(() => {
		try {
			const parsed = JSON.parse(frame.line);
			const cleaned = hideSignatures ? stripSignatures(parsed) : parsed;
			return JSON.stringify(cleaned, null, 2);
		} catch {
			return frame.line;
		}
	}, [frame.line, hideSignatures]);
	const time = frame.at.slice(11, 23);
	const directionTone =
		frame.direction === 'rx' ? 'text-status-ok' : 'text-status-warning';
	const DirectionIcon = frame.direction === 'rx' ? ArrowDownIcon : ArrowUpIcon;
	const [copied, setCopied] = useState(false);
	const handleCopy = useCallback(() => {
		void navigator.clipboard
			.writeText(pretty)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1200);
			})
			.catch(() => {
				// Clipboard permission rarely fails in Electron renderer; ignore.
			});
	}, [pretty]);
	return (
		<li className='rounded-sm border border-border/60 bg-pane/40'>
			<div className='flex items-center justify-between gap-2 border-border/60 border-b px-2 py-1 text-[0.625rem] text-muted-foreground'>
				<span className={cn('flex items-center gap-1', directionTone)}>
					<DirectionIcon className='size-3' />
					<span className='uppercase'>{frame.direction}</span>
				</span>
				<div className='flex items-center gap-2'>
					<span
						className='rounded-sm bg-muted/60 px-1 py-0.5 uppercase tracking-wide'
						title={frame.label}
					>
						{frame.kind}
					</span>
					<span>{time}</span>
					<Button
						aria-label={copied ? 'Copied frame to clipboard' : 'Copy frame'}
						className='size-5'
						onClick={handleCopy}
						size='icon-xs'
						title={
							copied
								? 'Copied'
								: 'Copy frame (signatures follow the current toggle)'
						}
						type='button'
						variant='ghost'
					>
						{copied ? (
							<CheckIcon className='size-3 text-status-ok' />
						) : (
							<CopyIcon className='size-3' />
						)}
					</Button>
				</div>
			</div>
			<pre className='whitespace-pre-wrap break-words px-2 py-1.5 text-foreground/90'>
				{pretty}
			</pre>
		</li>
	);
}
