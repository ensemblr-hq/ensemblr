import type { RootDirectoryChangePreview } from '@/shared/ipc/contracts/root-directory';

/** Read-only preview block showing what a root-directory change will do. */
export function RootPathPreview({
	preview,
}: {
	preview: RootDirectoryChangePreview;
}) {
	return (
		<div className='grid gap-2 text-xs'>
			<div className='rounded-md border border-border bg-background/60 px-3 py-2'>
				<p className='font-medium'>Current root</p>
				<code className='mt-1 block break-all text-muted-foreground'>
					{preview.oldRoot?.path ?? 'No current root snapshot'}
				</code>
			</div>
			<div className='rounded-md border border-border bg-background/60 px-3 py-2'>
				<p className='font-medium'>Selected root</p>
				<code className='mt-1 block break-all text-muted-foreground'>
					{preview.newRoot.path}
				</code>
			</div>
		</div>
	);
}
