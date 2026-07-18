import { CircleSlashIcon, GitBranchIcon, TriangleIcon } from 'lucide-react';

import { cn } from '@/renderer/lib/utils';
import type { ProviderMarkKind } from '@/renderer/types/components';

import { getProviderLabel } from './provider-label';

/** Renders the provider's brand mark (GitHub/Linear/Vercel/etc) inline. */
export function ProviderMark({ provider }: { provider: ProviderMarkKind }) {
	const isGithubProvider =
		provider === 'github' || provider === 'github-actions';
	const providerLabel = getProviderLabel(provider);

	if (provider === 'vercel') {
		return (
			<span
				aria-label={providerLabel}
				className='grid size-3.5 shrink-0 place-items-center text-muted-foreground'
				role='img'
			>
				<TriangleIcon
					aria-hidden='true'
					className='size-3 fill-current stroke-1'
				/>
			</span>
		);
	}

	return (
		<span
			aria-label={providerLabel}
			className={cn(
				'grid size-3.5 shrink-0 place-items-center rounded-full',
				isGithubProvider
					? 'bg-foreground text-background'
					: 'bg-muted text-muted-foreground',
			)}
			role='img'
		>
			{isGithubProvider ? (
				<GitBranchIcon aria-hidden='true' className='size-2.5' />
			) : (
				<CircleSlashIcon aria-hidden='true' className='size-2.5' />
			)}
		</span>
	);
}
