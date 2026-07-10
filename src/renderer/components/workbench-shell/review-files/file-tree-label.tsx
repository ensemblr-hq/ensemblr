import { Fragment } from 'react';

/**
 * Renders a file-tree row's path segments as a `/`-separated breadcrumb. Shared
 * by the folder rows in `all-files-list` and `review-file-tree` so the two views
 * stay visually identical from one source.
 */
export function FileTreeLabel({ parts }: { parts: readonly string[] }) {
	return (
		<span className='min-w-0 truncate font-mono'>
			{parts.map((label, index) => (
				<Fragment key={parts.slice(0, index + 1).join('/')}>
					{index > 0 ? (
						<span className='px-1 text-muted-foreground/70'>/</span>
					) : null}
					<span>{label}</span>
				</Fragment>
			))}
		</span>
	);
}
