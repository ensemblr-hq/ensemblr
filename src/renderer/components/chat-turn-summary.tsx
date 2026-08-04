import { useAtomValue } from 'jotai';
import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { useScrollAnchor } from '@/renderer/hooks/conversation/use-anchored-disclosure';
import { formatTurnDuration } from '@/renderer/lib/format-duration';
import { cn } from '@/renderer/lib/utils';
import { toolCallCollapseAtom } from '@/renderer/state/preferences';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';
import { GLYPH_ICONS } from './tool-collapsible/glyph-icons';

/**
 * How many tool marks the collapsed strip paints before it gives up and counts
 * the rest. Past this the strip stops reading as a shape and starts wrapping.
 */
const MAX_STRIP_GLYPHS = 12;

/**
 * Auto-collapsed summary chip rendered once the assistant turn finalizes. The
 * counts say how much work folded away and the glyph strip says what kind, so
 * a settled turn reads like `62 tool calls, 24 messages` followed by the marks
 * of the tools it ran. Clicking expands the chip to reveal the original rows.
 */
export function ChatTurnSummary({
	children,
	className,
	defaultOpen = false,
	durationMs,
	messageCount,
	toolGlyphs,
}: {
	children: ReactNode;
	className?: string;
	defaultOpen?: boolean;
	durationMs: number | null;
	messageCount: number;
	/** One glyph per folded tool call, in the order the turn ran them. */
	toolGlyphs: readonly ToolGlyph[];
}) {
	// ⌃O (and the General settings switch) flips this global mode to expand or
	// collapse every settled turn at once. A manual click is remembered against
	// the mode it was made under, so the next flip invalidates it and the turn
	// obeys the new default again.
	const collapseMode = useAtomValue(toolCallCollapseAtom);
	const bodyId = useId();
	const [override, setOverride] = useState<{
		mode: typeof collapseMode;
		open: boolean;
	} | null>(null);
	const open =
		override?.mode === collapseMode
			? override.open
			: defaultOpen || collapseMode === 'expanded';
	const { anchorRef, captureAnchor } = useScrollAnchor();
	const segments: string[] = [];
	if (toolGlyphs.length > 0) {
		segments.push(
			`${toolGlyphs.length} tool ${pluralize('call', toolGlyphs.length)}`,
		);
	}
	if (messageCount > 0) {
		segments.push(`${messageCount} ${pluralize('message', messageCount)}`);
	}
	if (segments.length === 0) {
		segments.push('Work');
	}
	const headline = segments.join(', ');
	const trailing = durationMs !== null ? formatTurnDuration(durationMs) : null;
	return (
		<div
			className={cn('flex flex-col gap-2', className)}
			data-role='turn-summary'
			ref={anchorRef}
		>
			<button
				aria-controls={bodyId}
				aria-expanded={open}
				className='-ml-1.5 flex w-fit max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted-foreground text-xs leading-5 transition-colors hover:bg-muted/50 hover:text-foreground'
				onClick={() => {
					captureAnchor();
					setOverride({ mode: collapseMode, open: !open });
				}}
				type='button'
			>
				<ChevronRightIcon
					aria-hidden='true'
					className={cn(
						'size-4 shrink-0 transition-transform',
						open && 'rotate-90',
					)}
				/>
				<span className='truncate'>{headline}</span>
				{trailing ? (
					<span className='shrink-0 text-muted-foreground/70'>{trailing}</span>
				) : null}
				{open ? null : <ToolGlyphStrip glyphs={toolGlyphs} />}
			</button>
			{open ? (
				<div
					className='flex flex-col gap-1.5 border-border/40 border-l pl-3'
					id={bodyId}
				>
					{children}
				</div>
			) : null}
		</div>
	);
}

/**
 * Paints the folded tool calls as their icons, in call order, so the collapsed
 * turn still says what kind of work it did. Overflow past the cap becomes a
 * count rather than a second line.
 */
function ToolGlyphStrip({ glyphs }: { glyphs: readonly ToolGlyph[] }) {
	if (glyphs.length === 0) {
		return null;
	}
	const shown = glyphs.slice(0, MAX_STRIP_GLYPHS);
	const overflow = glyphs.length - shown.length;
	return (
		<span className='flex shrink-0 items-center gap-1.5 text-muted-foreground/60'>
			{shown.map((glyph, index) => {
				const GlyphIcon = GLYPH_ICONS[glyph];
				return (
					<GlyphIcon
						aria-hidden='true'
						className='size-3.5'
						key={`${glyph}:${index}`}
					/>
				);
			})}
			{overflow > 0 ? <span className='text-xxs'>+{overflow}</span> : null}
		</span>
	);
}

/**
 * Pluralize a word by appending `s` unless the count is exactly one.
 * @param word - Singular word to pluralize
 * @param count - Count that selects singular or plural
 * @returns The singular or pluralized word
 */
function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}
