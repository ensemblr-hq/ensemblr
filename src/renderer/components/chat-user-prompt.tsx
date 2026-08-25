import { useId, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnchoredDisclosure } from '@/renderer/hooks/conversation/use-anchored-disclosure';
import {
	chipLabelForPath,
	parsePromptAttachments,
} from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import type { ParsedPromptPart } from '@/renderer/types/agent-timeline';
import { conciergeReferenceId } from '@/shared/concierge-references';
import { ChatAttachmentChip } from './chat-attachment-chip';
import { useConciergeReferenceAccess } from './concierge/concierge-reference-context';
import {
	useFilePreviewOpener,
	useWorkspacePathResolver,
} from './workbench-shell/conversation-panel/file-preview-context';

/** Sub-pixel rounding leaves a clamped element a hair taller than its content. */
const CLIP_TOLERANCE_PX = 1;

/**
 * What a chip drops to when it sits inside a sentence. The chip's standing
 * height is 26px against the card's 20px line box, so at its own size two chips
 * on consecutive lines overlap each other — which is a property of the chip
 * being taller than the line, and no amount of aligning its host fixes it.
 * Shedding the vertical padding and tightening the leading brings it to 18px,
 * inside the line it belongs to.
 */
const INLINE_CHIP_CLASS = 'py-0 leading-4';

/**
 * Punctuation that binds to what precedes it, so a chip before it takes no
 * trailing gap. A straight apostrophe counts only as a possessive or
 * contraction — `@ensemblr's docs` binds, `@ensemblr 'the release notes'` does
 * not — since a trimmed run offers nothing else to tell an opening quote from a
 * closing one.
 */
const BINDS_BACKWARD = /^(?:[)\]},.;:!?…»”’]|'(?:d|ll|m|re|s|t|ve)\b)/;

/**
 * Punctuation that binds to what follows it, so a chip after it takes no leading
 * gap. Straight quotes are left out: a trimmed run ending in `"` is as likely to
 * have closed a quote as to be opening one, and guessing wrong runs two words
 * together, where a stray gap only reads loose.
 */
const BINDS_FORWARD = /[([{/@«“‘]$/;

/**
 * The host a chip sits in, pinned to exactly one line box and aligned to its
 * top. A chip is a flex box rather than a run of text, so left to itself it
 * would sit on the text's baseline and hang below it; the host puts its centre
 * on the line's centre instead, and caps what it can contribute to the line's
 * height so a paragraph keeps even leading whether or not a chip landed on that
 * line. `1lh` is that line box read off the prose's own leading, so the host
 * tracks a change to it rather than restating the number. The same trick the
 * composer's Lexical chip host plays.
 *
 * The gap either side is reconstructed rather than preserved.
 * `serializeComposerDraft` trims each typed run and joins the blocks with a
 * blank line, so whatever the user typed around a chip is gone by the time the
 * prompt is read back: a neighbouring word earns a gap, and punctuation that
 * binds to the chip does not, which is what keeps `@src/renderer. Inspect it`
 * from reading back as `renderer . Inspect it`. Only a word earns the trailing
 * gap, so a run of chips is one gap apart rather than two.
 * @param previous - The part before the chip, absent when it opens the prompt
 * @param next - The part after the chip, absent when it closes the prompt
 * @returns The host's class list
 */
function chipHostClassName(
	previous: ParsedPromptPart | undefined,
	next: ParsedPromptPart | undefined,
): string {
	const hasLeadingGap =
		previous !== undefined &&
		!(previous.kind === 'text' && BINDS_FORWARD.test(previous.text));
	const hasTrailingGap =
		next?.kind === 'text' && !BINDS_BACKWARD.test(next.text);
	return cn(
		'inline-flex h-[1lh] max-w-full items-center align-top',
		hasLeadingGap && 'ml-1',
		hasTrailingGap && 'mr-1',
	);
}

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
		const identity = partIdentity(part);
		const seen = occurrences.get(identity) ?? 0;
		occurrences.set(identity, seen + 1);
		return { key: `${identity}#${seen}`, part };
	});
}

/**
 * What a part is, for keying: two identical parts differ only in how many came
 * before them.
 * @param part - The part being keyed
 * @returns A stable identity string
 */
function partIdentity(part: ParsedPromptPart): string {
	if (part.kind === 'text') {
		return `text:${part.text}`;
	}
	if (part.kind === 'reference') {
		return `ref:${part.reference.kind}:${conciergeReferenceId(part.reference)}`;
	}
	return `file:${part.attachment.path}`;
}

/**
 * Lays a prompt's typed runs and attachment chips out in document order, in one
 * inline flow so the sentence wraps around its chips the way it was typed rather
 * than breaking to a new line either side of every one. Chips open the file
 * preview where a surface provides an opener and stay inert where none does,
 * which is how the replay timeline renders the same prompt without a workspace
 * behind it.
 *
 * A surface that also provides a resolver has the last word on which paths it
 * can open, the way a tool badge does: a file attached and since deleted, or one
 * the Concierge cannot place in any project, stays inert rather than offering a
 * control that opens onto a read error.
 */
function PromptParts({ parts }: { parts: readonly ParsedPromptPart[] }) {
	const openFilePreview = useFilePreviewOpener();
	const resolveWorkspacePath = useWorkspacePathResolver();
	const referenceAccess = useConciergeReferenceAccess();
	return (
		<>
			{keyedParts(parts).map(({ key, part }, index) => {
				if (part.kind === 'text') {
					return (
						<span className='wrap-anywhere whitespace-pre-wrap' key={key}>
							{part.text}
						</span>
					);
				}
				const hostClassName = chipHostClassName(
					parts[index - 1],
					parts[index + 1],
				);
				if (part.kind === 'reference') {
					const { reference } = part;
					return (
						<span className={hostClassName} key={key}>
							<ChatAttachmentChip
								className={INLINE_CHIP_CLASS}
								kind={reference.kind}
								label={reference.label}
								onActivate={
									referenceAccess && reference.kind !== 'project'
										? () => referenceAccess.openReference(reference)
										: undefined
								}
								title={reference.label}
							/>
						</span>
					);
				}
				const { attachment } = part;
				const isPlaceable =
					resolveWorkspacePath === null ||
					resolveWorkspacePath(attachment.path) !== null;
				return (
					<span className={hostClassName} key={key}>
						<ChatAttachmentChip
							className={INLINE_CHIP_CLASS}
							kind={attachment.content.length > 0 ? 'file' : 'folder'}
							label={chipLabelForPath(attachment.path)}
							onActivate={
								openFilePreview && isPlaceable
									? () => openFilePreview(attachment.path)
									: undefined
							}
							title={attachment.path}
						/>
					</span>
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
 * so the message reads back the way it was composed — one paragraph the chips sit
 * inside, rather than a column of blocks.
 *
 * A prompt too tall for the card — a pasted stack trace, a wall of build output —
 * is clamped and faded out with a control to unfold it, so one paste cannot bury
 * the turn that answered it. The text stays verbatim: what the user typed is not
 * re-read as markdown. Long unbreakable runs (module ids, absolute paths, URLs)
 * wrap anywhere rather than spilling past the card's edge, which is what
 * `wrap-break-word` alone would let them do.
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
					'text-foreground/90 leading-5',
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
