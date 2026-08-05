import { Button } from '@/renderer/components/ui/button';
import {
	getPullRequestLinkButtonClassName,
	resolvePreviewPillTone,
} from '@/renderer/lib/workbench/pull-request-link-button';
import type {
	PullRequestHeaderTone,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

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

/**
 * Deployment labels that add nothing next to the provider mark, since the pill's
 * icon and aria-label already say it is a preview deployment.
 */
const GENERIC_DEPLOYMENT_LABELS = new Set(['deploy', 'deployment', 'preview']);

/**
 * Drops the deployment label once the sidebar header's `pr-header` container has
 * less room than the pills plus the status label need, leaving the provider mark
 * to stand in for it and the status label room to read before it truncates. The
 * pill carries the same label as its `title`, so the collapsed mark still names
 * its deployment on hover.
 * Only a host that declares `@container/pr-header` collapses the label; anywhere
 * else the named query never matches and the label always shows.
 */
const COLLAPSE_LABEL_TO_PROVIDER_MARK = '@max-xs/pr-header:hidden';

/**
 * Pill-shaped preview-deployment button that opens the provider's URL, tinted by
 * the sidebar header's tone so both header pills read as one control group,
 * unless the deployment's own status outranks it.
 */
export function PreviewDeploymentButton({
	deployment,
	tone,
}: {
	deployment: NonNullable<
		WorkspaceShellModel['pullRequest']['previewDeployment']
	>;
	tone: PullRequestHeaderTone;
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
	const isLabelRedundant =
		normalizedDeploymentLabel === providerLabel.toLowerCase() ||
		GENERIC_DEPLOYMENT_LABELS.has(normalizedDeploymentLabel);
	const shouldShowTextLabel =
		normalizedDeploymentLabel.length > 0 &&
		(providerIconPath === null || !isLabelRedundant);
	const canCollapseTextLabel = shouldShowTextLabel && providerIconPath !== null;
	const pillTone = resolvePreviewPillTone(tone, deployment.status);

	return (
		<Button
			aria-label={`Open ${previewLabel}`}
			asChild
			className={getPullRequestLinkButtonClassName(pillTone)}
			size='sm'
			variant='outline'
		>
			<a
				href={deployment.url}
				rel='noreferrer'
				target='_blank'
				title={canCollapseTextLabel ? deployment.label : undefined}
			>
				{providerIconPath ? (
					<PreviewDeploymentProviderIcon path={providerIconPath} />
				) : null}
				{shouldShowTextLabel ? (
					<span
						className={
							canCollapseTextLabel ? COLLAPSE_LABEL_TO_PROVIDER_MARK : undefined
						}
					>
						{deployment.label}
					</span>
				) : null}
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
