import { i18n } from '@/renderer/lib/i18n';
import type {
	LinearGateState,
	LinearWorkspaceSeed,
} from '@/renderer/types/linear';
import type { WorkspaceSource } from '@/renderer/types/workbench';
import type {
	LinearConnectionSnapshot,
	LinearIssueWire,
	LinearServiceFailure,
} from '@/shared/ipc/contracts/linear';

/**
 * Translates one Linear priority number. Resolved per call rather than from a
 * module-scope table, so a language switch is picked up without a reload.
 * @param priority - Linear priority number, 0 (none) through 4 (low)
 * @returns The localized priority label
 */
function priorityLabel(priority: number): string {
	switch (priority) {
		case 1:
			return i18n.t('linear:priority.urgent', 'Urgent');
		case 2:
			return i18n.t('linear:priority.high', 'High');
		case 3:
			return i18n.t('linear:priority.medium', 'Medium');
		case 4:
			return i18n.t('linear:priority.low', 'Low');
		default:
			return i18n.t('linear:priority.none', 'No priority');
	}
}

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
	return priorityLabel(priority ?? 0);
}

/**
 * User-facing copy for a Linear data failure, including the retry hint for
 * rate limits.
 */
export function describeLinearFailure(failure: LinearServiceFailure): string {
	switch (failure.code) {
		case 'not-connected':
			return i18n.t(
				'linear:failure.not-connected',
				'Linear is not connected. Sign in from integration settings.',
			);
		case 'reconnect-required':
			return i18n.t(
				'linear:failure.reconnect-required',
				'The Linear connection expired. Reconnect from integration settings.',
			);
		case 'permission-denied':
			return i18n.t(
				'linear:failure.permission-denied',
				'Your Linear account does not have permission for this action.',
			);
		case 'rate-limited':
			return failure.retryAfterSeconds
				? i18n.t(
						'linear:failure.rate-limited-retry',
						'Linear rate limit reached. Try again in {{seconds}}s.',
						{ seconds: failure.retryAfterSeconds },
					)
				: i18n.t(
						'linear:failure.rate-limited',
						'Linear rate limit reached. Try again shortly.',
					);
		case 'not-found':
			return i18n.t(
				'linear:failure.not-found',
				'This Linear issue no longer exists or is not visible to you.',
			);
		case 'invalid-request':
			return failure.message;
		default:
			return i18n.t(
				'linear:failure.unreachable',
				'Linear is unreachable. Showing cached data where available.',
			);
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

/**
 * Builds the linked-issue record (including the issue description, which seeds
 * the first-prompt composer draft) for a workspace created from a Linear issue
 * (ADR 0024). Workspace name and branch follow the default path — only the
 * composer is seeded from the issue.
 */
export function buildWorkspaceSeedFromLinearIssue(
	issue: LinearIssueWire,
): LinearWorkspaceSeed {
	return {
		linkedIssue: {
			...(issue.description ? { description: issue.description } : {}),
			id: issue.id,
			identifier: issue.identifier,
			provider: 'linear',
			...(issue.teamKey ? { teamKey: issue.teamKey } : {}),
			...(issue.teamName ? { teamName: issue.teamName } : {}),
			title: issue.title,
			url: issue.url,
		},
	};
}

/**
 * Truncates text to a maximum length, appending an ellipsis when shortened.
 * @param text - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns The original text, or an ellipsis-truncated copy
 */
function truncateText(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
