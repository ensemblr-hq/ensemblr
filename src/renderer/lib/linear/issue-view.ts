import type { WorkspaceSource } from '@/renderer/types/workbench';
import type { LinearConnectionSnapshot, LinearIssueWire, LinearServiceFailure } from '@/shared/ipc/contracts/linear';
import type { WorkspaceLinkedIssueInput } from '@/shared/ipc/contracts/workspace';

/** Connection-level gate state for every Linear surface. */
export type LinearGateState =
	| { kind: 'loading' }
	| { kind: 'not-configured' }
	| { kind: 'disconnected' }
	| { kind: 'reconnect-required' }
	| { kind: 'ready' };

const PRIORITY_LABELS: Record<number, string> = {
	0: 'No priority',
	1: 'Urgent',
	2: 'High',
	3: 'Medium',
	4: 'Low',
};

const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Derives the gate state shown before any Linear issue content renders.
 * @param options - Connection snapshot plus its loading flag.
 * @returns A {@link LinearGateState}.
 */
export function deriveLinearGateState({
	connection,
	isLoading,
}: {
	connection: LinearConnectionSnapshot | undefined;
	isLoading: boolean;
}): LinearGateState {
	if (isLoading || !connection) {
		return { kind: 'loading' };
	}

	switch (connection.state) {
		case 'connected':
			return { kind: 'ready' };
		case 'not-configured':
			return { kind: 'not-configured' };
		case 'reconnect-required':
			return { kind: 'reconnect-required' };
		default:
			return { kind: 'disconnected' };
	}
}

/** Human label for a Linear priority number (0 = none … 4 = low). */
export function getLinearPriorityLabel(priority: number | null): string {
	if (priority === null) {
		return PRIORITY_LABELS[0] as string;
	}

	return PRIORITY_LABELS[priority] ?? (PRIORITY_LABELS[0] as string);
}

/**
 * User-facing copy for a Linear data failure, including the retry hint for
 * rate limits.
 */
export function describeLinearFailure(failure: LinearServiceFailure): string {
	switch (failure.code) {
		case 'not-connected':
			return 'Linear is not connected. Sign in from integration settings.';
		case 'reconnect-required':
			return 'The Linear connection expired. Reconnect from integration settings.';
		case 'permission-denied':
			return 'Your Linear account does not have permission for this action.';
		case 'rate-limited':
			return failure.retryAfterSeconds
				? `Linear rate limit reached. Try again in ${failure.retryAfterSeconds}s.`
				: 'Linear rate limit reached. Try again shortly.';
		case 'not-found':
			return 'This Linear issue no longer exists or is not visible to you.';
		case 'invalid-request':
			return failure.message;
		default:
			return 'Linear is unreachable. Showing cached data where available.';
	}
}

/** True when a cached row's `syncedAt` is older than the freshness window. */
export function isLinearDataStale(
	syncedAt: string | null,
	now: Date,
	staleAfterMs = STALE_AFTER_MS,
): boolean {
	if (!syncedAt) {
		return true;
	}

	return now.getTime() - Date.parse(syncedAt) > staleAfterMs;
}

/**
 * Formats the composer context block inserted when linking a Linear issue or
 * when seeding a workspace created from an issue.
 */
export function formatLinearIssueContext(issue: {
	description?: string | null;
	identifier: string;
	title: string;
	url?: string | null;
}): string {
	const link = issue.url ? `\n${issue.url}` : '';
	const excerpt = issue.description?.trim()
		? `\n\n${truncateText(issue.description.trim(), 600)}`
		: '';

	return `Linear issue ${issue.identifier}: ${issue.title}${link}${excerpt}`;
}

/**
 * Maps cached Linear issues into create-workspace dialog sources so the
 * "Create from…" picker lists live issues instead of fixtures.
 */
export function mapLinearIssuesToWorkspaceSources(
	issues: LinearIssueWire[],
): WorkspaceSource[] {
	return issues.map((issue) => ({
		id: issue.id,
		kind: 'issue',
		provider: 'linear',
		reference: issue.identifier,
		subtitle: issue.stateName ?? undefined,
		title: issue.title,
	}));
}

/** Workspace creation seed derived from a Linear issue. */
export interface LinearWorkspaceSeed {
	branchName: string;
	composerSeed: string;
	linkedIssue: WorkspaceLinkedIssueInput;
	name: string;
}

/**
 * Derives the workspace name, branch name, linked-issue record, and composer
 * context for a workspace created from a Linear issue (ADR 0024).
 */
export function buildWorkspaceSeedFromLinearIssue(
	issue: LinearIssueWire,
): LinearWorkspaceSeed {
	return {
		branchName: `feat/${issue.identifier.toLowerCase()}-${slugify(issue.title)}`,
		composerSeed: formatLinearIssueContext(issue),
		linkedIssue: {
			id: issue.id,
			identifier: issue.identifier,
			provider: 'linear',
			...(issue.teamKey ? { teamKey: issue.teamKey } : {}),
			...(issue.teamName ? { teamName: issue.teamName } : {}),
			title: issue.title,
			url: issue.url,
		},
		name: `${issue.identifier} ${issue.title}`,
	};
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/(^-|-$)/g, '')
		.slice(0, 40)
		.replace(/-$/, '');

	return slug || 'issue';
}

function truncateText(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
