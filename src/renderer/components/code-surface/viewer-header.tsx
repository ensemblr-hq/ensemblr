import { Icon } from '@iconify/react';
import type { ReactNode } from 'react';
import { FilePathLabel } from '@/renderer/components/file-path-label';
import { getWorkspaceFileIconNameForPath } from '@/renderer/lib/workbench';

/**
 * Header bar above a code surface that fills a panel or a tab: the file it shows
 * on the left, the controls acting on it on the right.
 *
 * One bar for the file viewer, the diff viewer, and the turn diff, so switching
 * between a file and its diff moves nothing but the body. The icon defaults to
 * the file-type icon for `title`, which is what makes a path look the same here
 * as it does in the workspace file tree.
 */
export function CodeViewerHeader({
	actions,
	icon,
	title,
}: {
	/** Right-aligned controls and status text. */
	actions?: ReactNode;
	/** Replaces the file-type icon derived from `title`. */
	icon?: ReactNode;
	title: string;
}) {
	return (
		<div className='flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted/30 pr-2 pl-3'>
			{icon ?? (
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
					icon={getWorkspaceFileIconNameForPath(title)}
				/>
			)}
			<FilePathLabel
				className='font-mono text-muted-foreground text-xs'
				path={title}
			/>
			{actions ? (
				<div className='ml-auto flex shrink-0 items-center gap-1'>
					{actions}
				</div>
			) : null}
		</div>
	);
}
