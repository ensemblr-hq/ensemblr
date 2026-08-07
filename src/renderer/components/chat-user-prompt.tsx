import {
	chipLabelForPath,
	parsePromptAttachments,
} from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import { ChatAttachmentChip } from './chat-attachment-chip';
import { useFilePreviewOpener } from './workbench-shell/conversation-panel/file-preview-context';

/**
 * Right-aligned compact user prompt card. Pulls `<attached_file>` markers (and
 * the `Referenced workspace folders` header) out of the persisted prompt text
 * and shows the typed message first, followed by inline attachment chips. Reads
 * as a single horizontal strip rather than a tall bubble.
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
	const { attachments, text } = parsePromptAttachments(prompt);
	const openFilePreview = useFilePreviewOpener();
	const hasBubble = attachments.length > 0 || text.length > 0;
	if (!hasBubble) {
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
			{text.length > 0 ? (
				<span className='whitespace-pre-wrap break-words text-foreground/90 leading-5'>
					{text}
				</span>
			) : null}
			{attachments.map((attachment) => {
				const isFile = attachment.content.length > 0;
				return (
					<ChatAttachmentChip
						key={`${attachment.path}`}
						kind={isFile ? 'file' : 'folder'}
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
