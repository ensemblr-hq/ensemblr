import { Icon } from '@iconify/react';
import {
	FileDiffIcon,
	FolderGitIcon,
	GitBranchIcon,
	MessageSquareIcon,
	XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProviderMark } from '@/renderer/components/workbench-shell/checks-panel/provider-mark';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { getWorkspaceFileIconName } from '@/renderer/lib/workbench';
import { formatCommentLocation } from '@/renderer/lib/workbench/comment-body';
import type { ComposerAttachment } from '@/renderer/types/workbench';
import type { ConciergeReference } from '@/shared/concierge-references';

/**
 * The glyph that says where an attachment came from: a tracker issue or a review
 * comment wears its provider's brand mark, a diff wears a compare mark, and a
 * project, workspace, or chat wears the mark the sidebar gives it — since the
 * markdown document or the id behind each would otherwise render as an anonymous
 * file icon.
 */
function AttachmentIcon({ attachment }: { attachment: ComposerAttachment }) {
	if (attachment.kind === 'project-ref') {
		return <FolderGitIcon aria-hidden='true' className='size-3.5 shrink-0' />;
	}
	if (attachment.kind === 'workspace-ref') {
		return <GitBranchIcon aria-hidden='true' className='size-3.5 shrink-0' />;
	}
	if (attachment.kind === 'chat-ref') {
		return (
			<MessageSquareIcon aria-hidden='true' className='size-3.5 shrink-0' />
		);
	}
	if (attachment.kind === 'review-comment') {
		return <ProviderMark provider={attachment.comment.provider} />;
	}
	if (attachment.kind === 'issue') {
		const Logo = attachment.provider === 'linear' ? LinearLogo : GithubLogo;
		return <Logo className='size-3.5 shrink-0' />;
	}
	if (attachment.kind === 'file-diff') {
		return (
			<FileDiffIcon
				aria-hidden='true'
				className='size-3.5 shrink-0 text-muted-foreground'
			/>
		);
	}
	return (
		<Icon
			aria-hidden='true'
			className='size-3.5 shrink-0'
			icon={getWorkspaceFileIconName({
				kind: attachment.kind === 'workspace-directory' ? 'directory' : 'file',
				name: attachment.label,
			})}
		/>
	);
}

/**
 * What the chip's tooltip says, which is the label unless the label is an
 * abbreviation of something longer: a review comment and a diff are both labelled
 * by their file's basename, so two of them on same-named files in different
 * directories read identically until the tooltip names the full path.
 * @param attachment - The attachment behind the chip
 * @returns The hover text; never empty
 */
function attachmentTooltip(attachment: ComposerAttachment): string {
	if (attachment.kind === 'file-diff') {
		return attachment.filePath || attachment.label;
	}
	if (
		attachment.kind === 'artifact-ref' ||
		attachment.kind === 'workspace-ref' ||
		attachment.kind === 'chat-ref'
	) {
		return referenceTooltip(attachment.reference) || attachment.label;
	}
	if (attachment.kind !== 'review-comment') {
		return attachment.label;
	}
	const { line, path } = attachment.comment;
	return formatCommentLocation(path, line) || attachment.label;
}

/**
 * Where a reference sits, so two same-named workspaces in different projects, two
 * chats called the same thing, or two artifacts in different folders are told
 * apart on hover.
 * @param reference - The reference behind the chip.
 * @returns The qualified name, or an empty string when the owner is unknown.
 */
function referenceTooltip(reference: ConciergeReference): string {
	if (reference.kind === 'artifact') {
		return reference.path;
	}
	if (reference.kind === 'workspace') {
		return reference.project ? `${reference.project} › ${reference.label}` : '';
	}
	if (reference.kind === 'chat') {
		return reference.workspace
			? `${reference.workspace} › ${reference.label}`
			: '';
	}
	return reference.label;
}

/**
 * Compact chip for one composer attachment, whatever its source: a VSCode-style
 * icon and the attachment's label inside a rounded outlined pill. The label
 * truncates rather than widening the chip, so one long path cannot push the
 * text after it onto another line.
 *
 * Given `onActivate` the label becomes a button that opens the file; without it
 * the chip is inert, which is how a directory and an out-of-workspace file
 * render, since the preview panel has nothing to show for either.
 */
export function AttachmentChip({
	attachment,
	onActivate,
	onRemove,
}: {
	attachment: ComposerAttachment;
	onActivate?: () => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const label = attachment.label;
	const body = (
		<>
			<AttachmentIcon attachment={attachment} />
			<span className='truncate font-medium'>{label}</span>
		</>
	);

	return (
		<span
			className='group/chip inline-flex h-5 max-w-xs items-center gap-1.5 rounded-md border border-border bg-background px-1.5 text-xs'
			title={attachmentTooltip(attachment)}
		>
			{onActivate ? (
				<button
					aria-label={t('common:actions.open-named', 'Open {{label}}', {
						label,
					})}
					className='inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left'
					onClick={onActivate}
					type='button'
				>
					{body}
				</button>
			) : (
				body
			)}
			<button
				aria-label={t('common:actions.remove-named', 'Remove {{label}}', {
					label,
				})}
				className='inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
				onClick={onRemove}
				type='button'
			>
				<XIcon className='size-3' />
			</button>
		</span>
	);
}
