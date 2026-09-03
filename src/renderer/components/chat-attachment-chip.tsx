import { Icon } from '@iconify/react';
import { FolderGitIcon, GitBranchIcon, MessageSquareIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceFileIconName } from '@/renderer/lib/workbench';
import type { AttachmentMark } from '@/renderer/types/components';
import { AttachmentGlyph } from './attachment-glyph';

/**
 * What a chip stands for. The first two are read off a path and wear the file
 * tree's own icon set, the next three are the app's own surfaces and wear the
 * mark the sidebar gives them, and an {@link AttachmentMark} covers everything
 * whose path is a generated `.context/` filename that names nothing.
 */
export type ChatAttachmentChipKind =
	| AttachmentMark
	| 'chat'
	| 'file'
	| 'folder'
	| 'project'
	| 'workspace';

/**
 * The glyph a chip leads with: a VSCode-style file icon for anything read off a
 * path, the sidebar's own mark for a project, workspace, or chat, and the shared
 * attachment glyph for everything carrying a mark.
 * @param kind - What the chip stands for.
 * @param label - Chip text, which a file icon is chosen by extension from.
 * @returns The icon element.
 */
function chipIcon(kind: ChatAttachmentChipKind, label: string): ReactNode {
	if (kind === 'project') {
		return <FolderGitIcon aria-hidden='true' className='size-3.5 shrink-0' />;
	}
	if (kind === 'workspace') {
		return <GitBranchIcon aria-hidden='true' className='size-3.5 shrink-0' />;
	}
	if (kind === 'chat') {
		return (
			<MessageSquareIcon aria-hidden='true' className='size-3.5 shrink-0' />
		);
	}
	if (kind !== 'file' && kind !== 'folder') {
		return <AttachmentGlyph mark={kind} />;
	}
	return (
		<Icon
			aria-hidden='true'
			className='size-3.5 shrink-0'
			icon={getWorkspaceFileIconName({
				kind: kind === 'folder' ? 'directory' : 'file',
				name: label,
			})}
		/>
	);
}

/** Compact attachment pill showing what it stands for and its short name; acts as a button that opens that thing when given an activation handler. */
export function ChatAttachmentChip({
	className,
	kind = 'file',
	label,
	onActivate,
	...rest
}: ComponentProps<'span'> & {
	kind?: ChatAttachmentChipKind;
	label: string;
	onActivate?: () => void;
}) {
	const chipClassName = cn(
		'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/60 px-2 py-0.5 font-medium text-foreground/90 text-xs leading-5',
		onActivate &&
			'cursor-pointer transition-colors hover:border-border hover:bg-muted',
		className,
	);
	const content = (
		<>
			{chipIcon(kind, label)}
			<span className='truncate'>{label}</span>
		</>
	);
	if (onActivate) {
		return (
			<button
				className={cn(chipClassName, 'text-left')}
				onClick={onActivate}
				title={typeof rest.title === 'string' ? rest.title : undefined}
				type='button'
			>
				{content}
			</button>
		);
	}
	return (
		<span className={chipClassName} {...rest}>
			{content}
		</span>
	);
}
