/**
 * Pure parser for `ensemble://` deep links. Production URL-scheme registration
 * happens at packaging time (per Linear ENS-066); the handler logic here is
 * exercised by unit tests and used at runtime once an external open arrives.
 *
 * Supported shapes:
 *   ensemble://workbench
 *   ensemble://repo/<repositoryId>
 *   ensemble://repo/<repositoryId>/settings/<section>
 *   ensemble://workspace/<repositoryId>/<workspaceId>
 *   ensemble://workspace/<repositoryId>/<workspaceId>/chat/<chatId>
 *   ensemble://linear/<issueId>
 *   ensemble://settings/<section>
 *   ensemble://review/<workspaceId>
 *
 * Inputs are aggressively validated; unsafe segments (path traversal, query
 * smuggling, embedded protocols) return `{ kind: 'invalid', reason }`.
 */

export type DeepLink =
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

export type AppSettingsSection =
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

export type RepoSettingsSection =
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

/** Parse an ensemble:// URL into a typed deep link. */
export function parseDeepLink(rawUrl: string): DeepLink {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { kind: 'invalid', reason: 'malformed-url' };
	}

	if (url.protocol !== 'ensemble:') {
		return { kind: 'invalid', reason: 'unsupported-protocol' };
	}

	// `new URL("ensemble://foo/bar")` puts `foo` in hostname and `/bar` in pathname.
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

function parseLinear(segments: string[]): DeepLink {
	const [issueId] = segments;
	if (!issueId || !/^[A-Za-z]+-\d+$/.test(issueId)) {
		return { kind: 'invalid', reason: 'invalid-linear-issue' };
	}
	return { kind: 'linear-issue', issueId };
}

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
