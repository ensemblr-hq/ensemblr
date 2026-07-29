import { ArrowUpRightIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { getPullRequestLinkButtonClassName } from '@/renderer/lib/workbench/pull-request-link-button';
import type { PullRequestHeaderTone } from '@/renderer/types/workbench';

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
	const className = getPullRequestLinkButtonClassName(tone);
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
