import { ArrowUpRightIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

export type PullRequestHeaderTone = 'blocked' | 'neutral' | 'pending' | 'ready';

/** Pill-shaped PR number button, opening the URL when provided. */
export function PullRequestNumberButton({
	number,
	tone,
	url,
}: {
	number: number;
	tone: PullRequestHeaderTone;
	url?: string;
}) {
	const className = cn(
		'h-6.5 rounded-sm border px-1.75 font-semibold text-xs',
		tone === 'ready' &&
			'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-transparent dark:border-status-ok/35 dark:hover:bg-transparent',
		tone === 'pending' &&
			'border-status-warning/35 bg-status-warning/10 text-foreground hover:bg-status-warning/15',
		tone === 'blocked' &&
			'border-status-danger/35 bg-status-danger/10 text-status-danger hover:bg-status-danger/15',
		tone === 'neutral' &&
			'border-border bg-transparent text-muted-foreground hover:bg-muted/70',
	);
	const content = (
		<>
			<span className='font-mono tabular-nums'>#{number}</span>
			<ArrowUpRightIcon aria-hidden='true' className='size-3.5' />
		</>
	);

	if (url) {
		return (
			<Button
				aria-label={`Open pull request #${number}`}
				asChild
				className={className}
				size='sm'
				variant='outline'
			>
				<a href={url} rel='noreferrer' target='_blank'>
					{content}
				</a>
			</Button>
		);
	}

	return (
		<Button
			aria-label={`Open pull request #${number}`}
			className={className}
			size='sm'
			variant='outline'
		>
			{content}
		</Button>
	);
}
