import { CheckIcon, ClipboardIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import type { PiTurnFooterItem } from '@/renderer/types/pi-timeline';

const COPY_FEEDBACK_MS = 1500;

/** Formats a settled turn duration: `12.4s` under a minute, `1m 12s` past. */
function formatFooterDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds - minutes * 60);
	return `${minutes}m ${rest}s`;
}

/**
 * Footer rendered at the end of a completed assistant turn: the turn duration
 * (prompt accepted → final event) in small muted text plus an icon-only copy
 * button that grabs the final answer as clean markdown. Aborted turns show a
 * calm "Stopped" marker instead of pretending the answer settled.
 */
export function PiTurnFooter({
	className,
	item,
}: {
	className?: string;
	item: PiTurnFooterItem;
}) {
	return (
		<div
			className={cn(
				'flex items-center gap-1.5 text-muted-foreground/70 text-xs',
				className,
			)}
			data-kind='turn-footer'
			data-role='timeline-item'
		>
			{item.aborted ? (
				<span className='rounded-sm border border-status-warning/40 px-1.5 py-0.5 text-status-warning'>
					Stopped
				</span>
			) : null}
			<span>{formatFooterDuration(item.durationMs)}</span>
			{item.answerText.length > 0 ? (
				<CopyAnswerButton answerText={item.answerText} />
			) : null}
		</div>
	);
}

/**
 * Live footer shown while the turn is still streaming: a ticking timer and no
 * copy button. Swapped for {@link PiTurnFooter} once the turn settles.
 */
export function PiLiveTurnFooter({
	className,
	startedAtMs,
}: {
	className?: string;
	startedAtMs: number;
}) {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNowMs(Date.now()), 100);
		return () => window.clearInterval(id);
	}, []);
	return (
		<div
			className={cn('text-muted-foreground/70 text-xs', className)}
			data-kind='turn-footer-live'
			data-role='timeline-item'
		>
			{formatFooterDuration(Math.max(0, nowMs - startedAtMs))}
		</div>
	);
}

/** Icon-only clipboard button with a transient check on success. */
function CopyAnswerButton({ answerText }: { answerText: string }) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (resetTimer.current !== null) {
				window.clearTimeout(resetTimer.current);
			}
		},
		[],
	);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(answerText);
			setCopied(true);
			if (resetTimer.current !== null) {
				window.clearTimeout(resetTimer.current);
			}
			resetTimer.current = window.setTimeout(
				() => setCopied(false),
				COPY_FEEDBACK_MS,
			);
		} catch {
			// Clipboard access denied — leave the icon unchanged.
		}
	};
	const Icon = copied ? CheckIcon : ClipboardIcon;
	return (
		<TooltipProvider>
			<Tooltip>
			<TooltipTrigger asChild>
				<button
					aria-label='Copy response'
					className={cn(
						'rounded-md p-1 transition-colors hover:bg-secondary/60 hover:text-foreground',
						copied && 'text-status-ok',
					)}
					onClick={copy}
					type='button'
				>
					<Icon aria-hidden='true' className='size-3.5' />
				</button>
			</TooltipTrigger>
				<TooltipContent>Copy response</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
