import { Fragment } from 'react';
import type { FrontmatterBlock } from '@/renderer/lib/markdown-frontmatter';
import { cn } from '@/renderer/lib/utils';

/**
 * Draws a markdown document's frontmatter as a metadata band above the body.
 *
 * The block is the document's own vocabulary rather than the app's — the keys
 * are whatever the author wrote — so nothing here is translated and nothing is
 * relabelled. A block that did not group into keys is shown as written, on the
 * reasoning that metadata read wrong is worse than metadata read literally.
 */
export function FrontmatterHeader({
	block,
	className,
}: {
	block: FrontmatterBlock;
	className?: string;
}) {
	const surface = cn(
		'rounded-lg border border-border/70 bg-muted/30 px-4 py-3 text-xs',
		className,
	);
	if (block.kind === 'raw') {
		return (
			<pre className={cn(surface, 'overflow-x-auto font-mono leading-relaxed')}>
				{block.text}
			</pre>
		);
	}
	return (
		<dl
			className={cn(
				surface,
				'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5',
			)}
		>
			{block.entries.map((entry) => (
				<Fragment key={entry.key}>
					<dt className='font-medium text-muted-foreground'>{entry.key}</dt>
					<dd className='break-words text-foreground'>
						{entry.value.length > 0 ? (
							entry.value
						) : (
							<span aria-hidden='true' className='text-muted-foreground'>
								—
							</span>
						)}
					</dd>
				</Fragment>
			))}
		</dl>
	);
}
