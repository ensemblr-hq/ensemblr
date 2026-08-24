import { useId, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnchoredDisclosure } from '@/renderer/hooks/conversation/use-anchored-disclosure';
import {
	chipLabelForPath,
	parsePromptAttachments,
} from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import type { ParsedPromptPart } from '@/renderer/types/agent-timeline';
import { ChatAttachmentChip } from './chat-attachment-chip';
import {
	useFilePreviewOpener,
	useWorkspacePathResolver,
} from './workbench-shell/conversation-panel/file-preview-context';

/** Sub-pixel rounding leaves a clamped element a hair taller than its content. */
const CLIP_TOLERANCE_PX = 1;

/**
 * Pairs each parsed part with a key drawn from what it holds. Content alone is
 * not unique — the same folder can be referenced twice in one message — so a
 * repeat is distinguished by how many identical parts came before it.
 * @param parts - The prompt's runs and attachments, in document order
 * @returns The same parts, each with a key unique among its siblings
 */
function keyedParts(
	parts: readonly ParsedPromptPart[],
): readonly { key: string; part: ParsedPromptPart }[] {
	const occurrences = new Map<string, number>();
	return parts.map((part) => {
		const identity =
			part.kind === 'text'
				? `text:${part.text}`
				: `file:${part.attachment.path}`;
		const seen = occurrences.get(identity) ?? 0;
		occurrences.set(identity, seen + 1);
		return { key: `${identity}#${seen}`, part };
	});
}

/**
 * Lays a prompt's typed runs and attachment chips out in document order, as
 * direct children of whatever strip wraps them. Chips open the file preview
 * where a surface provides an opener and stay inert where none does, which is
 * how the replay timeline renders the same prompt without a workspace behind
 * it.
 *
 * A surface that also provides a resolver has the last word on which paths it
 * can open, the way a tool badge does: a file attached and since deleted, or one
 * the Concierge cannot place in any project, stays inert rather than offering a
 * control that opens onto a read error.
 */
function PromptParts({ parts }: { parts: readonly ParsedPromptPart[] }) {
	const openFilePreview = useFilePreviewOpener();
	const resolveWorkspacePath = useWorkspacePathResolver();
	return (
		<>
			{keyedParts(parts).map(({ key, part }) => {
				if (part.kind === 'text') {
					return (
						<span
							className='wrap-anywhere whitespace-pre-wrap text-foreground/90 leading-5'
							key={key}
						>
							{part.text}
						</span>
					);
				}
				const { attachment } = part;
				const isPlaceable =
					resolveWorkspacePath === null ||
					resolveWorkspacePath(attachment.path) !== null;
				return (
					<ChatAttachmentChip
						key={key}
						kind={attachment.content.length > 0 ? 'file' : 'folder'}
						label={chipLabelForPath(attachment.path)}
						onActivate={
							openFilePreview && isPlaceable
								? () => openFilePreview(attachment.path)
								: undefined
						}
						title={attachment.path}
					/>
				);
			})}
		</>
	);
}

/**
 * Reports whether a clamped element is hiding part of its content, so the
 * expand control only appears when there is something behind it.
 *
 * The measurement is taken while the clamp is on and held while the element is
 * expanded: an expanded element clips nothing, and letting the reading go false
 * would retract the control the reader needs to collapse it again. Re-measuring
 * on resize matters because the same prompt clips in a narrow conversation
 * panel and fits in a wide one.
 *
 * Measuring before paint rather than after keeps the fade and the expand
 * control from arriving a frame late: a transcript full of clamped prompts
 * would otherwise paint every card hard-cut, then grow each one by the
 * control's height on the following frame.
 * @param isClamped - Whether the element currently carries the height clamp
 * @param content - The text the element renders, re-measured when it changes
 * @returns The ref to attach to the clamped element, and whether it clips
 */
function useClampedOverflow(
	isClamped: boolean,
	content: string,
): { isClipped: boolean; measuredRef: (node: HTMLElement | null) => void } {
	const [measured, setMeasured] = useState<HTMLElement | null>(null);
	const [isClipped, setIsClipped] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: content is the trigger, not an input — a clamped element keeps its pinned height when its text changes, so the observer never fires and only a dependency re-runs the measurement.
	useLayoutEffect(() => {
		if (measured === null || !isClamped) {
			return;
		}
		const measure = () =>
			setIsClipped(
				measured.scrollHeight > measured.clientHeight + CLIP_TOLERANCE_PX,
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(measured);

		return () => observer.disconnect();
	}, [content, isClamped, measured]);

	return { isClipped, measuredRef: setMeasured };
}

/**
 * Right-aligned compact user prompt card. Pulls `<attached_file>` markers (and
 * the `Referenced workspace folders` header) out of the persisted prompt text and
 * lays the typed runs and the attachment chips out in the order they were sent,
 * so the message reads back the way it was composed. Reads as a single horizontal
 * strip rather than a tall bubble.
 *
 * A prompt too tall for the card — a pasted stack trace, a wall of build output —
 * is clamped and faded out with a control to unfold it, so one paste cannot bury
 * the turn that answered it. The text stays verbatim: what the user typed is not
 * re-read as markdown. Long unbreakable runs (module ids, absolute paths, URLs)
 * wrap anywhere rather than spilling past the card's edge, which is what
 * `wrap-break-word` alone would let them do — a flex item will not shrink below
 * its longest word unless the break is allowed mid-word.
 *
 * Attachment chips are buttons, and a clamp hides them without taking them out
 * of the tab order, so keyboard focus reaching one unfolds the card: a chip
 * that is focused but invisible shows no focus ring, and the browser answers by
 * scrolling a strip that has no scrollbar and ignores the wheel. Pointer focus
 * is left alone — it can only land on a chip that is already on screen.
 *
 * A `/skill:name` invocation shows here as that command; the mapper has already
 * lifted the expanded `SKILL.md` into the assistant turn as a "Skill activated"
 * marker, so the bubble keeps only what the user typed.
 */
export function ChatUserPrompt({
	className,
	prompt,
}: {
	className?: string;
	prompt: string;
}) {
	const { t } = useTranslation();
	const { parts } = parsePromptAttachments(prompt);
	const { isOpen: isExpanded, rowRef, toggle } = useAnchoredDisclosure();
	const { isClipped, measuredRef } = useClampedOverflow(!isExpanded, prompt);
	const bodyId = useId();

	if (parts.length === 0) {
		return null;
	}
	return (
		<div
			className={cn(
				'ml-auto flex w-fit max-w-[85%] flex-col gap-1 rounded-lg border border-border/40 bg-secondary/60 px-3 py-2 text-foreground text-sm',
				className,
			)}
			data-role='user-prompt'
			ref={rowRef}
		>
			<div
				className={cn(
					'flex flex-wrap items-center gap-2',
					!isExpanded && 'max-h-64 overflow-hidden',
					!isExpanded && isClipped && 'mask-b-from-80% mask-b-to-100%',
				)}
				id={bodyId}
				onFocusCapture={(event) => {
					if (
						isClipped &&
						!isExpanded &&
						event.target.matches(':focus-visible')
					) {
						toggle();
					}
				}}
				ref={measuredRef}
			>
				<PromptParts parts={parts} />
			</div>
			{isClipped ? (
				<button
					aria-controls={bodyId}
					aria-expanded={isExpanded}
					className='-mr-1 cursor-pointer self-end rounded-sm px-1 py-0.5 text-muted-foreground text-xs transition-colors hover:text-foreground'
					onClick={toggle}
					type='button'
				>
					{isExpanded
						? t('workbench:timeline.user-prompt.show-less', 'Show less')
						: t('workbench:timeline.user-prompt.show-more', 'Show more')}
				</button>
			) : null}
		</div>
	);
}
