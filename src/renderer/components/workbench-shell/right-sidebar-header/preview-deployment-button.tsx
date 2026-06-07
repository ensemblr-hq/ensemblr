import { ExternalLinkIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Pill-shaped preview-deployment button that opens the provider's URL. */
export function PreviewDeploymentButton({
	deployment,
}: {
	deployment: NonNullable<
		WorkspaceShellModel['pullRequest']['previewDeployment']
	>;
}) {
	const providerLabel = getPreviewDeploymentProviderLabel(deployment.provider);
	const previewLabel =
		providerLabel === 'deployment'
			? 'preview deployment'
			: `${providerLabel} preview deployment`;

	return (
		<Button
			aria-label={`Open ${previewLabel}`}
			asChild
			className={cn(
				'h-6.5 rounded-sm border px-1.75 font-semibold text-xs',
				deployment.status === 'ready' &&
					'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-status-ok/15',
				deployment.status === 'pending' &&
					'border-status-warning/35 bg-status-warning/10 text-foreground hover:bg-status-warning/15',
				deployment.status === 'blocked' &&
					'border-status-danger/35 bg-status-danger/10 text-status-danger hover:bg-status-danger/15',
			)}
			size='sm'
			variant='outline'
		>
			<a href={deployment.url} rel='noreferrer' target='_blank'>
				<span>{deployment.label}</span>
				<ExternalLinkIcon aria-hidden='true' className='size-3.5' />
			</a>
		</Button>
	);
}

/** Renders a deployment provider as a short display label. */
function getPreviewDeploymentProviderLabel(
	provider: NonNullable<
		WorkspaceShellModel['pullRequest']['previewDeployment']
	>['provider'],
) {
	if (provider === 'vercel') {
		return 'Vercel';
	}

	if (provider === 'netlify') {
		return 'Netlify';
	}

	return 'deployment';
}
