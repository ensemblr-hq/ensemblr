import { FileIcon, FolderIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';

/** Compact attachment pill showing a file or folder icon and the path basename; acts as a button that opens the file preview when given an activation handler. */
export function ChatAttachmentChip({
	className,
	kind = 'file',
	label,
	onActivate,
	...rest
}: ComponentProps<'span'> & {
	kind?: 'file' | 'folder';
	label: string;
	onActivate?: () => void;
}) {
	const Icon = kind === 'folder' ? FolderIcon : FileIcon;
	const chipClassName = cn(
		'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/60 px-2 py-0.5 font-medium text-foreground/90 text-xs leading-5',
		onActivate &&
			'cursor-pointer transition-colors hover:border-border hover:bg-muted',
		className,
	);
	const content = (
		<>
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0 text-muted-foreground'
			/>
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
