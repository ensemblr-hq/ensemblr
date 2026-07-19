import { Button } from '@/renderer/components/ui/button';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import { getPullRequestLinkButtonClassName } from './pull-request-number-button';

/** Preview deployment provider ids recognized by the shell. */
type PreviewDeploymentProvider = NonNullable<
	WorkspaceShellModel['pullRequest']['previewDeployment']
>['provider'];

const PREVIEW_DEPLOYMENT_PROVIDER_ICON_PATHS: Partial<
	Record<PreviewDeploymentProvider, string>
> = {
	netlify:
		'M6.49 19.04h-.23L5.13 17.9v-.23l1.73-1.71h1.2l.15.15v1.2L6.5 19.04ZM5.13 6.31V6.1l1.13-1.13h.23L8.2 6.68v1.2l-.15.15h-1.2L5.13 6.31Zm9.96 9.09h-1.65l-.14-.13v-3.83c0-.68-.27-1.2-1.1-1.23-.42 0-.9 0-1.43.02l-.07.08v4.96l-.14.14H8.9l-.13-.14V8.73l.13-.14h3.7a2.6 2.6 0 0 1 2.61 2.6v4.08l-.13.14Zm-8.37-2.44H.14L0 12.82v-1.64l.14-.14h6.58l.14.14v1.64l-.14.14Zm17.14 0h-6.58l-.14-.14v-1.64l.14-.14h6.58l.14.14v1.64l-.14.14ZM11.05 6.55V1.64l.14-.14h1.65l.14.14v4.9l-.14.14h-1.65l-.14-.13Zm0 15.81v-4.9l.14-.14h1.65l.14.13v4.91l-.14.14h-1.65l-.14-.14Z',
	vercel: 'm12 1.608 12 20.784H0Z',
};

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
	const providerIconPath = getPreviewDeploymentProviderIconPath(
		deployment.provider,
	);
	const normalizedDeploymentLabel = deployment.label.trim().toLowerCase();
	const shouldShowTextLabel =
		normalizedDeploymentLabel.length > 0 &&
		(providerIconPath === null ||
			normalizedDeploymentLabel !== providerLabel.toLowerCase());

	return (
		<Button
			aria-label={`Open ${previewLabel}`}
			asChild
			className={getPullRequestLinkButtonClassName(deployment.status)}
			size='sm'
			variant='outline'
		>
			<a href={deployment.url} rel='noreferrer' target='_blank'>
				{providerIconPath ? (
					<PreviewDeploymentProviderIcon path={providerIconPath} />
				) : null}
				{shouldShowTextLabel ? <span>{deployment.label}</span> : null}
			</a>
		</Button>
	);
}

/** Inline SVG mark for a known preview deployment provider. */
function PreviewDeploymentProviderIcon({ path }: { path: string }) {
	return (
		<svg
			aria-hidden='true'
			className='size-3.5'
			fill='currentColor'
			role='presentation'
			viewBox='0 0 24 24'
			xmlns='http://www.w3.org/2000/svg'
		>
			<path d={path} />
		</svg>
	);
}

/** Returns the inline SVG path for recognized deployment providers. */
function getPreviewDeploymentProviderIconPath(
	provider: PreviewDeploymentProvider,
) {
	return PREVIEW_DEPLOYMENT_PROVIDER_ICON_PATHS[provider] ?? null;
}

/** Renders a deployment provider as a short display label. */
function getPreviewDeploymentProviderLabel(
	provider: PreviewDeploymentProvider,
) {
	if (provider === 'vercel') {
		return 'Vercel';
	}

	if (provider === 'netlify') {
		return 'Netlify';
	}

	return 'deployment';
}
