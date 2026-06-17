import { GitPullRequestArrowIcon } from 'lucide-react';

/** Centered placeholder shown when the workspace has no file changes. */
export function ReviewFileEmptyState() {
	return (
		<div className='flex h-full flex-col items-center justify-center px-8 text-center'>
			<GitPullRequestArrowIcon
				aria-hidden='true'
				className='size-9 text-muted-foreground/50'
				strokeWidth={1.25}
			/>
			<p className='mt-4 font-medium text-foreground text-sm'>
				No file changes yet
			</p>
			<p className='mt-1 text-muted-foreground text-xs'>Changes appear here.</p>
		</div>
	);
}
