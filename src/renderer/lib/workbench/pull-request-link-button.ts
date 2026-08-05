import { cn } from '@/renderer/lib/utils';
import type {
	PullRequestCheckStatus,
	PullRequestHeaderTone,
} from '@/renderer/types/workbench';

/**
 * Picks the tone of the preview-deployment pill, letting an unfinished
 * deployment outrank the header tone. GitHub reports deployments separately from
 * checks, so the header can read green or merged while the linked build is still
 * running or already broken; only a `ready` deployment has nothing to add and
 * defers to the header so both pills read as one control group.
 * @param headerTone - Tone the sidebar header resolved from pull-request status.
 * @param deploymentStatus - Status of the linked preview deployment.
 * @returns The tone the deployment pill should render.
 */
export function resolvePreviewPillTone(
	headerTone: PullRequestHeaderTone,
	deploymentStatus: PullRequestCheckStatus,
): PullRequestHeaderTone {
	return deploymentStatus === 'ready' ? headerTone : deploymentStatus;
}

/**
 * Builds the shared PR/deployment pill styling so both controls keep matching borders.
 * @param tone - PR header tone used to color the pill.
 * @returns Tailwind classes for a header link pill.
 */
export function getPullRequestLinkButtonClassName(tone: PullRequestHeaderTone) {
	return cn(
		'h-7 rounded-sm border px-1.75 font-semibold text-xs',
		tone === 'ready' &&
			'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-transparent dark:border-status-ok/35 dark:hover:bg-transparent',
		tone === 'pending' &&
			'border-status-warning/55 bg-background/90 text-foreground hover:bg-status-warning/15 dark:border-status-warning dark:bg-background/80 dark:text-status-warning dark:hover:bg-status-warning/20',
		tone === 'blocked' &&
			'border-status-danger/55 bg-status-danger/10 text-status-danger hover:bg-status-danger/15 dark:border-status-danger',
		tone === 'merged' &&
			'border-pr-merged bg-background/90 text-pr-merged hover:bg-pr-merged-soft dark:border-pr-merged dark:bg-background/80 dark:hover:bg-pr-merged-soft',
		tone === 'neutral' &&
			'border-border bg-transparent text-muted-foreground hover:bg-muted/70',
	);
}
