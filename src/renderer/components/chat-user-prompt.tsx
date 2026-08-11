import {
	chipLabelForPath,
	parsePromptAttachments,
} from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import type { ParsedPromptPart } from '@/renderer/types/agent-timeline';
import { ChatAttachmentChip } from './chat-attachment-chip';
import { useFilePreviewOpener } from './workbench-shell/conversation-panel/file-preview-context';

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
 * Right-aligned compact user prompt card. Pulls `<attached_file>` markers (and
 * the `Referenced workspace folders` header) out of the persisted prompt text and
 * lays the typed runs and the attachment chips out in the order they were sent,
 * so the message reads back the way it was composed. Reads as a single horizontal
 * strip rather than a tall bubble.
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
	const { parts } = parsePromptAttachments(prompt);
	const openFilePreview = useFilePreviewOpener();
	if (parts.length === 0) {
		return null;
	}
	return (
		<div
			className={cn(
				'ml-auto flex w-fit max-w-[85%] flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-secondary/60 px-3 py-2 text-foreground text-sm',
				className,
			)}
			data-role='user-prompt'
		>
			{keyedParts(parts).map(({ key, part }) => {
				if (part.kind === 'text') {
					return (
						<span
							className='whitespace-pre-wrap break-words text-foreground/90 leading-5'
							key={key}
						>
							{part.text}
						</span>
					);
				}
				const { attachment } = part;
				return (
					<ChatAttachmentChip
						key={key}
						kind={attachment.content.length > 0 ? 'file' : 'folder'}
						label={chipLabelForPath(attachment.path)}
						onActivate={
							openFilePreview
								? () => openFilePreview(attachment.path)
								: undefined
						}
						title={attachment.path}
					/>
				);
			})}
		</div>
	);
}
