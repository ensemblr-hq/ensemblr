import { GitPullRequestArrowIcon } from 'lucide-react';

/**
 * Centered placeholder shown when the selected change source has no files. The
 * copy is overridable so each source (all / uncommitted / a commit) can explain
 * its own empty case.
 */
export function ReviewFileEmptyState({
	message = 'Changes appear here.',
	title = 'No file changes yet',
}: {
	message?: string;
	title?: string;
} = {}) {
	return (
		<div className='flex h-full flex-col items-center justify-center px-8 text-center'>
			<GitPullRequestArrowIcon
				aria-hidden='true'
				className='size-9 text-muted-foreground opacity-50'
				strokeWidth={1.25}
			/>
			<p className='mt-4 font-medium text-foreground text-sm'>{title}</p>
			<p className='mt-1 text-muted-foreground text-xs'>{message}</p>
		</div>
	);
}
