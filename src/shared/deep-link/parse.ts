/**
 * Pure parser for `ensemblr://` deep links. Production URL-scheme registration
 * happens at packaging time (per Linear ENS-066); the handler logic here is
 * exercised by unit tests and used at runtime once an external open arrives.
 *
 * Supported shapes:
 *   ensemblr://workbench
 *   ensemblr://repo/<repositoryId>
 *   ensemblr://repo/<repositoryId>/settings/<section>
 *   ensemblr://workspace/<repositoryId>/<workspaceId>
 *   ensemblr://workspace/<repositoryId>/<workspaceId>/chat/<chatId>
 *   ensemblr://linear/<issueId>
 *   ensemblr://settings/<section>
 *   ensemblr://review/<workspaceId>
 *
 * Inputs are aggressively validated; unsafe segments (path traversal, query
 * smuggling, embedded protocols) return `{ kind: 'invalid', reason }`.
 */

type DeepLink =
	| { kind: 'workbench' }
	| { kind: 'repo'; repositoryId: string }
	| {
			kind: 'repo-settings';
			repositoryId: string;
			section: RepoSettingsSection;
	  }
	| { kind: 'workspace'; repositoryId: string; workspaceId: string }
	| {
			kind: 'workspace-chat';
			repositoryId: string;
			workspaceId: string;
			chatId: string;
	  }
	| { kind: 'linear-issue'; issueId: string }
	| { kind: 'settings'; section: AppSettingsSection }
	| { kind: 'review'; workspaceId: string }
	| { kind: 'invalid'; reason: string };

/** Identifier for a section of the app-level (global) settings surface. */
type AppSettingsSection =
	| 'general'
	| 'models'
	| 'providers'
	| 'environment'
	| 'git'
	| 'appearance'
	| 'integrations'
	| 'diagnostics'
	| 'experimental'
	| 'advanced';

/** Identifier for a section of a repository's settings surface. */
type RepoSettingsSection =
	| 'environment'
	| 'git'
	| 'scripts'
	| 'actions'
	| 'misc';

const APP_SECTIONS = new Set<AppSettingsSection>([
	'general',
	'models',
	'providers',
	'environment',
	'git',
	'appearance',
	'integrations',
	'diagnostics',
	'experimental',
	'advanced',
]);

const REPO_SECTIONS = new Set<RepoSettingsSection>([
	'environment',
	'git',
	'scripts',
	'actions',
	'misc',
]);

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

/** Parse an ensemblr:// URL into a typed deep link. */
export function parseDeepLink(rawUrl: string): DeepLink {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { kind: 'invalid', reason: 'malformed-url' };
	}

	if (url.protocol !== 'ensemblr:') {
		return { kind: 'invalid', reason: 'unsupported-protocol' };
	}

	// `new URL("ensemblr://foo/bar")` puts `foo` in hostname and `/bar` in pathname.
	const head = url.hostname.toLowerCase();
	const segments = url.pathname.split('/').flatMap((s) => {
		const trimmed = decodeURIComponent(s).trim();
		return trimmed ? [trimmed] : [];
	});

	switch (head) {
		case 'workbench':
			return segments.length === 0
				? { kind: 'workbench' }
				: { kind: 'invalid', reason: 'unexpected-segments' };
		case 'repo':
			return parseRepo(segments);
		case 'workspace':
			return parseWorkspace(segments);
		case 'linear':
			return parseLinear(segments);
		case 'settings':
			return parseSettings(segments);
		case 'review':
			return parseReview(segments);
		default:
			return { kind: 'invalid', reason: 'unknown-target' };
	}
}

/**
 * Parse `repo/...` segments into a repo or repo-settings deep link, validating the repository id and optional settings section.
 * @param segments - Path segments following the `repo` host
 * @returns The parsed repo deep link, or an invalid result when validation fails
 */
function parseRepo(segments: string[]): DeepLink {
	const [repositoryId, settingsLiteral, section] = segments;
	if (!repositoryId || !SAFE_ID_PATTERN.test(repositoryId)) {
		return { kind: 'invalid', reason: 'invalid-repo-id' };
	}
	if (!settingsLiteral) {
		return { kind: 'repo', repositoryId };
	}
	if (settingsLiteral !== 'settings' || !section) {
		return { kind: 'invalid', reason: 'unexpected-segments' };
	}
	if (!REPO_SECTIONS.has(section as RepoSettingsSection)) {
		return { kind: 'invalid', reason: 'unknown-repo-section' };
	}
	return {
		kind: 'repo-settings',
		repositoryId,
		section: section as RepoSettingsSection,
	};
}

/**
 * Parse `workspace/...` segments into a workspace or workspace-chat deep link, validating the repository, workspace, and optional chat ids.
 * @param segments - Path segments following the `workspace` host
 * @returns The parsed workspace deep link, or an invalid result when validation fails
 */
function parseWorkspace(segments: string[]): DeepLink {
	const [repositoryId, workspaceId, chatLiteral, chatId] = segments;
	if (
		!repositoryId ||
		!SAFE_ID_PATTERN.test(repositoryId) ||
		!workspaceId ||
		!SAFE_ID_PATTERN.test(workspaceId)
	) {
		return { kind: 'invalid', reason: 'invalid-workspace-id' };
	}
	if (!chatLiteral) {
		return { kind: 'workspace', repositoryId, workspaceId };
	}
	if (chatLiteral !== 'chat' || !chatId || !SAFE_ID_PATTERN.test(chatId)) {
		return { kind: 'invalid', reason: 'unexpected-segments' };
	}
	return {
		chatId,
		kind: 'workspace-chat',
		repositoryId,
		workspaceId,
	};
}

/**
 * Parse `linear/<issueId>` segments into a Linear-issue deep link, requiring a `TEAM-123`-shaped id.
 * @param segments - Path segments following the `linear` host
 * @returns The parsed linear-issue deep link, or an invalid result when the id is malformed
 */
function parseLinear(segments: string[]): DeepLink {
	const [issueId] = segments;
	if (!issueId || !/^[A-Za-z]+-\d+$/.test(issueId)) {
		return { kind: 'invalid', reason: 'invalid-linear-issue' };
	}
	return { kind: 'linear-issue', issueId };
}

/**
 * Parse `settings/<section>` segments into an app-settings deep link, defaulting to the `general` section when none is given.
 * @param segments - Path segments following the `settings` host
 * @returns The parsed settings deep link, or an invalid result for an unknown section
 */
function parseSettings(segments: string[]): DeepLink {
	const [section] = segments;
	if (!section) {
		return { kind: 'settings', section: 'general' };
	}
	if (!APP_SECTIONS.has(section as AppSettingsSection)) {
		return { kind: 'invalid', reason: 'unknown-settings-section' };
	}
	return { kind: 'settings', section: section as AppSettingsSection };
}

/**
 * Parse `review/<workspaceId>` segments into a review deep link, validating the workspace id.
 * @param segments - Path segments following the `review` host
 * @returns The parsed review deep link, or an invalid result when the id is malformed
 */
function parseReview(segments: string[]): DeepLink {
	const [workspaceId] = segments;
	if (!workspaceId || !SAFE_ID_PATTERN.test(workspaceId)) {
		return { kind: 'invalid', reason: 'invalid-workspace-id' };
	}
	return { kind: 'review', workspaceId };
}

/**
 * Whitelist for external URLs we allow renderer code to open via shell.
 * Anything not matching returns null and the caller should surface a
 * permission-denied error instead of opening.
 */
const ALLOWED_EXTERNAL_HOSTS = [
	'github.com',
	'gist.github.com',
	'linear.app',
	'docs.linear.app',
	'api.github.com',
];

/**
 * Whether a raw URL is safe for the renderer to open externally: http(s) only, plus localhost or a whitelisted host.
 * @param rawUrl - The URL string to validate
 * @returns True when the URL is permitted to open externally
 */
export function isAllowedExternalUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return false;
		}
		const host = url.hostname.toLowerCase();
		if (host === 'localhost' || host === '127.0.0.1') {
			return true;
		}
		return ALLOWED_EXTERNAL_HOSTS.some(
			(allowed) => host === allowed || host.endsWith(`.${allowed}`),
		);
	} catch {
		return false;
	}
}
