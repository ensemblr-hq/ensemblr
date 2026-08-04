import type {
	PullRequestCheckStatus,
	PullRequestCheckSummary,
	PullRequestPreviewDeploymentSummary,
} from '@/renderer/types/workbench';
import type {
	GithubCommentWire,
	GithubDeploymentWire,
} from '@/shared/ipc/contracts/github';

/**
 * Origins a provider serves the deployed build from, as opposed to a dashboard
 * page. `netlify.com` is deliberately absent: `app.netlify.com` is the Netlify
 * dashboard, and legacy `*.netlify.com` site URLs were retired in 2020 and now
 * redirect to `.netlify.app`.
 */
const HOSTED_PREVIEW_URL_PATTERN =
	/^https?:\/\/[^\s/]+\.(?:vercel\.app|netlify\.app)(?:[/?#]|$)/i;

/**
 * Provider checks that ride the deployment integration but link to review
 * tooling rather than the deployed build — Vercel publishes `Vercel Agent
 * Review` and `Vercel Preview Comments` rows alongside the deployment status.
 */
const NON_DEPLOYMENT_CHECK_PATTERN =
	/\b(?:agent|review|comments?|analytics|insights|lighthouse)\b/i;

/** Logins of the provider bots whose PR comment advertises the preview URL. */
const DEPLOYMENT_BOT_AUTHOR_PATTERN = /^(?:netlify|vercel)(?:\[bot])?$/i;

/** Absolute URLs inside a markdown comment body, stopping at markdown delimiters. */
const COMMENT_URL_PATTERN = /https?:\/\/[^\s"'()<>[\]]+/g;

/** Inputs the preview deployment can be recovered from, richest source first. */
interface PreviewDeploymentSources {
	checks: readonly PullRequestCheckSummary[];
	comments: readonly GithubCommentWire[];
	deployments: readonly GithubDeploymentWire[];
}

/**
 * Picks the preview deployment shown on the sidebar header. A provider-hosted
 * preview URL wins from whichever source produced it, so the header never links
 * to review tooling while a real deployment link exists; when no source yields
 * a hosted URL the documented order applies (deployment statuses, then check
 * links, then the provider bot comment).
 * @param sources - Deployment statuses, checks, and PR comments from the snapshot.
 * @returns The preview deployment to link, or undefined when no source has one.
 */
export function derivePreviewDeployment({
	checks,
	comments,
	deployments,
}: PreviewDeploymentSources): PullRequestPreviewDeploymentSummary | undefined {
	const candidates = [
		fromDeploymentStatus(deployments),
		fromCheckLink(checks),
		fromBotComment(comments),
	].filter((candidate) => candidate !== undefined);

	return (
		candidates.find((candidate) => isHostedPreviewUrl(candidate.url)) ??
		candidates[0]
	);
}

/**
 * Reads the newest GitHub deployment whose statuses carried a URL, preferring
 * one that links the hosted build over a provider dashboard — a monorepo
 * publishes several deployments per commit and only some expose a preview.
 * @param deployments - Deployment rows from the GitHub deployments API.
 * @returns The deployment-backed preview, or undefined when none has a URL.
 */
function fromDeploymentStatus(
	deployments: readonly GithubDeploymentWire[],
): PullRequestPreviewDeploymentSummary | undefined {
	const deployed = deployments.filter((entry) => entry.url);
	const deployment =
		deployed.find((entry) => isHostedPreviewUrl(entry.url)) ?? deployed[0];
	if (!deployment?.url) {
		return undefined;
	}

	return {
		label: deployment.environment || 'Preview',
		provider: inferDeploymentProvider(deployment.url),
		source: 'github-deployment',
		status: toCheckStatus(deployment.state),
		url: deployment.url,
	};
}

/**
 * Reads a preview-provider check link, skipping the provider rows that point at
 * review tooling and preferring one that links to the hosted build. A
 * provider-hosted origin is decisive, so the label heuristic only filters rows
 * whose URL is not already a preview — otherwise a project named for one of
 * those words (`code-review-tool`, `customer-insights`) would lose its link.
 * @param checks - Check summaries from the PR status rollup.
 * @returns The check-backed preview, or undefined when no check qualifies.
 */
function fromCheckLink(
	checks: readonly PullRequestCheckSummary[],
): PullRequestPreviewDeploymentSummary | undefined {
	const deploymentChecks = checks.filter(
		(check) =>
			check.provider === 'vercel' &&
			check.url &&
			(isHostedPreviewUrl(check.url) ||
				!NON_DEPLOYMENT_CHECK_PATTERN.test(check.label)),
	);
	const check =
		deploymentChecks.find((entry) => isHostedPreviewUrl(entry.url)) ??
		deploymentChecks[0];
	if (!check?.url) {
		return undefined;
	}

	return {
		label: check.label,
		provider: inferDeploymentProvider(check.url),
		source: 'check-link',
		status: check.status,
		url: check.url,
	};
}

/**
 * Reads the hosted preview URL out of the provider bot's PR comment, the last
 * resort when neither deployment statuses nor check links expose one.
 * @param comments - PR comments from the snapshot, in chronological order.
 * @returns The comment-backed preview, or undefined when no bot advertised one.
 */
function fromBotComment(
	comments: readonly GithubCommentWire[],
): PullRequestPreviewDeploymentSummary | undefined {
	for (const comment of comments) {
		if (!DEPLOYMENT_BOT_AUTHOR_PATTERN.test(comment.author)) {
			continue;
		}
		const url = (comment.body.match(COMMENT_URL_PATTERN) ?? []).find(
			(candidate) => isHostedPreviewUrl(candidate),
		);
		if (url) {
			return {
				label: 'Preview',
				provider: inferDeploymentProvider(url),
				source: 'pr-comment',
				status: 'ready',
				url,
			};
		}
	}

	return undefined;
}

/**
 * Whether a URL points at the deployed build itself rather than a provider
 * dashboard, inspector, or marketing page.
 * @param url - Candidate URL, when the source carried one.
 * @returns True when the URL is a provider-hosted preview origin.
 */
function isHostedPreviewUrl(url: string | undefined): boolean {
	return url !== undefined && HOSTED_PREVIEW_URL_PATTERN.test(url);
}

/**
 * Maps a GitHub deployment state onto the check status the header pill renders.
 * @param state - Deployment state from the latest deployment status.
 * @returns The equivalent check status.
 */
function toCheckStatus(
	state: GithubDeploymentWire['state'],
): PullRequestCheckStatus {
	if (state === 'failure') {
		return 'blocked';
	}
	if (state === 'pending') {
		return 'pending';
	}
	return 'ready';
}

/**
 * Infers the preview deployment provider from a deployment URL.
 * @param url - The deployment URL
 * @returns The detected provider, or `'unknown'` when none matches
 */
function inferDeploymentProvider(
	url: string,
): PullRequestPreviewDeploymentSummary['provider'] {
	if (/vercel/i.test(url)) {
		return 'vercel';
	}
	if (/netlify/i.test(url)) {
		return 'netlify';
	}
	return 'unknown';
}
