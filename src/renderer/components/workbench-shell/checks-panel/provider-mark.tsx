import { CircleSlashIcon, GitBranchIcon } from 'lucide-react';

import { cn } from '@/renderer/lib/utils';
import type { ProviderMarkKind } from '@/renderer/types/components';

/** Renders the provider's brand mark (GitHub/Linear/Vercel/etc) inline. */
export function ProviderMark({ provider }: { provider: ProviderMarkKind }) {
	const isGithubProvider =
		provider === 'github' || provider === 'github-actions';

	return (
		<span
			className={cn(
				'grid size-3.5 shrink-0 place-items-center rounded-full',
				isGithubProvider
					? 'bg-foreground text-background'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{isGithubProvider ? (
				<GitBranchIcon aria-hidden='true' className='size-2.5' />
			) : (
				<CircleSlashIcon aria-hidden='true' className='size-2.5' />
			)}
		</span>
	);
}
