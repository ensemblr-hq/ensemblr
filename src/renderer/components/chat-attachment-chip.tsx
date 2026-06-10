import { FileIcon, FolderIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';

/**
 * Compact pill that mirrors the composer attachment chip used inside the chat
 * transcript. Shows a leading file/folder icon and the basename of the path.
 * Visually matches the reference design — small, muted background, single line.
 */
export interface ChatAttachmentChipProps extends ComponentProps<'span'> {
	kind?: 'file' | 'folder';
	label: string;
}

export function ChatAttachmentChip({
	className,
	kind = 'file',
	label,
	...rest
}: ChatAttachmentChipProps) {
	const Icon = kind === 'folder' ? FolderIcon : FileIcon;
	return (
		<span
			className={cn(
				'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/60 px-2 py-0.5 font-medium text-[12px] text-foreground/90 leading-5',
				className,
			)}
			{...rest}
		>
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0 text-muted-foreground'
			/>
			<span className='truncate'>{label}</span>
		</span>
	);
}
