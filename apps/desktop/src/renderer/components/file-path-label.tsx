import { cn } from '@/renderer/lib/utils';

/**
 * A file path that gives up its directory prefix before its file name: when the
 * space runs out the directory truncates (ellipsis) while the name stays whole.
 * The name is what identifies the file, so it never gets clipped first.
 */
export function FilePathLabel({
	className,
	path,
}: {
	className?: string;
	path: string;
}) {
	const separatorIndex = path.lastIndexOf('/');
	const directory =
		separatorIndex === -1 ? '' : path.slice(0, separatorIndex + 1);
	const fileName =
		separatorIndex === -1 ? path : path.slice(separatorIndex + 1);

	return (
		<span
			className={cn('flex min-w-0 items-center overflow-hidden', className)}
		>
			{directory ? (
				<span className='min-w-0 truncate text-muted-foreground'>
					{directory}
				</span>
			) : null}
			<span className='shrink-0'>{fileName}</span>
		</span>
	);
}
