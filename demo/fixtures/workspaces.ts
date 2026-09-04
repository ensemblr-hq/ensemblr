import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationWorkspace,
	WorkspacePrPresentation,
} from '@/shared/ipc/contracts/repository-navigation';
import type { WorkspaceGitFileWire } from '@/shared/ipc/contracts/workspace-git';

/**
 * The frozen instant every scenario shares, so shots taken from different
 * scenarios agree with each other about what time it is.
 */
export const DEMO_CLOCK = '2026-09-04T11:20:00.000Z';

/** Workspace paths, exported so a scenario keys its git status off the same string. */
export const WORKSPACE_PATHS = {
	attachmentChips: '~/Code/workspaces/ensemblr/attachment-chips',
	auditLog: '~/Code/workspaces/atlas-api/audit-log',
	cursorPagination: '~/Code/workspaces/atlas-api/cursor-pagination',
	diffVirtualization: '~/Code/workspaces/ensemblr/diff-virtualization',
	idempotencyKeys: '~/Code/workspaces/atlas-api/idempotency-keys',
	menuAccelerators: '~/Code/workspaces/ensemblr/menu-accelerators',
	rateLimit: '~/Code/workspaces/atlas-api/rate-limit',
	releaseNotes: '~/Code/workspaces/ensemblr/release-notes',
	secretStorage: '~/Code/workspaces/ensemblr/secret-storage',
	quitGuard: '~/Code/workspaces/ensemblr/quit-guard',
	terminalWebgl: '~/Code/workspaces/ensemblr/terminal-webgl',
	trayIcon: '~/Code/workspaces/ensemblr/tray-icon',
	webhookRetries: '~/Code/workspaces/atlas-api/webhook-retries',
} as const;

/**
 * Builds one workspace row.
 * @param repositoryId - Repository the workspace belongs to.
 * @param options - The fields that differ between workspaces.
 * @returns The row the sidebar, the board, and every route resolve from.
 */
function workspace(
	repositoryId: string,
	options: {
		branchName: string;
		id: string;
		name: string;
		path: string;
		pullRequest?: WorkspacePrPresentation;
		slug: string;
	},
): RepositoryWorkspaceNavigationWorkspace {
	return {
		archivedAt: null,
		baseBranch: 'main',
		branchName: options.branchName,
		createdAt: DEMO_CLOCK,
		id: options.id,
		metadata: {},
		name: options.name,
		path: options.path,
		...(options.pullRequest ? { pullRequest: options.pullRequest } : {}),
		repositoryId,
		slug: options.slug,
		updatedAt: DEMO_CLOCK,
	};
}

/**
 * The repository and workspace tree every scenario renders its sidebar and board
 * from. Two repositories, thirteen workspaces — enough that the board fills all
 * five columns and the sidebar scrolls, which is what the five-workspace tree
 * this replaced could not do: three of the board's columns held one card.
 *
 * A desktop app and a REST API, so the work reads as two different kinds of
 * change rather than thirteen variations on one.
 */
export const DEMO_REPOSITORIES: readonly RepositoryWorkspaceNavigationRepository[] =
	[
		{
			createdAt: DEMO_CLOCK,
			defaultBranch: 'main',
			id: 'repo-ensemblr',
			metadata: {},
			name: 'ensemblr',
			path: '~/Code/ensemblr',
			slug: 'ensemblr',
			updatedAt: DEMO_CLOCK,
			workspaces: [
				workspace('repo-ensemblr', {
					branchName: 'release-notes-in-updates-panel',
					id: 'ws-release-notes',
					name: 'Release notes in updates panel',
					path: WORKSPACE_PATHS.releaseNotes,
					pullRequest: { number: 438, status: 'checking' },
					slug: 'release-notes',
				}),
				workspace('repo-ensemblr', {
					branchName: 'linux-tray-icon',
					id: 'ws-tray-icon',
					name: 'Linux tray icon',
					path: WORKSPACE_PATHS.trayIcon,
					pullRequest: { number: 436, status: 'ready' },
					slug: 'tray-icon',
				}),
				workspace('repo-ensemblr', {
					branchName: 'composer-attachment-chips',
					id: 'ws-attachment-chips',
					name: 'Composer attachment chips',
					path: WORKSPACE_PATHS.attachmentChips,
					slug: 'attachment-chips',
				}),
				workspace('repo-ensemblr', {
					branchName: 'diff-viewer-virtualization',
					id: 'ws-diff-virtualization',
					name: 'Virtualize the diff viewer',
					path: WORKSPACE_PATHS.diffVirtualization,
					pullRequest: { number: 441, status: 'checking' },
					slug: 'diff-virtualization',
				}),
				workspace('repo-ensemblr', {
					branchName: 'terminal-webgl-renderer',
					id: 'ws-terminal-webgl',
					name: 'WebGL terminal renderer',
					path: WORKSPACE_PATHS.terminalWebgl,
					pullRequest: { number: 429, status: 'merged' },
					slug: 'terminal-webgl',
				}),
				workspace('repo-ensemblr', {
					branchName: 'linux-secret-storage',
					id: 'ws-secret-storage',
					name: 'Secret storage on Linux',
					path: WORKSPACE_PATHS.secretStorage,
					slug: 'secret-storage',
				}),
				workspace('repo-ensemblr', {
					branchName: 'quit-guard-running-agents',
					id: 'ws-quit-guard',
					name: 'Quit guard for running agents',
					path: WORKSPACE_PATHS.quitGuard,
					slug: 'quit-guard',
				}),
				workspace('repo-ensemblr', {
					branchName: 'native-menu-accelerators',
					id: 'ws-menu-accelerators',
					name: 'Native menu accelerators',
					path: WORKSPACE_PATHS.menuAccelerators,
					pullRequest: { number: 424, status: 'closed' },
					slug: 'menu-accelerators',
				}),
			],
		},
		{
			createdAt: DEMO_CLOCK,
			defaultBranch: 'main',
			id: 'repo-atlas',
			metadata: {},
			name: 'atlas-api',
			path: '~/Code/atlas-api',
			slug: 'atlas-api',
			updatedAt: DEMO_CLOCK,
			workspaces: [
				workspace('repo-atlas', {
					branchName: 'rate-limit-headers',
					id: 'ws-rate-limit',
					name: 'Rate limit headers',
					path: WORKSPACE_PATHS.rateLimit,
					pullRequest: { number: 91, status: 'blocked' },
					slug: 'rate-limit',
				}),
				workspace('repo-atlas', {
					branchName: 'webhook-retry-backoff',
					id: 'ws-webhook-retries',
					name: 'Webhook retry backoff',
					path: WORKSPACE_PATHS.webhookRetries,
					slug: 'webhook-retries',
				}),
				workspace('repo-atlas', {
					branchName: 'cursor-pagination',
					id: 'ws-cursor-pagination',
					name: 'Cursor pagination for list endpoints',
					path: WORKSPACE_PATHS.cursorPagination,
					pullRequest: { number: 94, status: 'checking' },
					slug: 'cursor-pagination',
				}),
				workspace('repo-atlas', {
					branchName: 'idempotency-keys',
					id: 'ws-idempotency-keys',
					name: 'Idempotency keys on writes',
					path: WORKSPACE_PATHS.idempotencyKeys,
					pullRequest: { number: 96, status: 'merged' },
					slug: 'idempotency-keys',
				}),
				workspace('repo-atlas', {
					branchName: 'audit-log-admin-actions',
					id: 'ws-audit-log',
					name: 'Audit log for admin actions',
					path: WORKSPACE_PATHS.auditLog,
					slug: 'audit-log',
				}),
			],
		},
	];

/**
 * Board column per workspace, shared by every scenario that renders the board so
 * the dashboard reads the same in each. Spread deliberately: the board's own
 * shot is about its columns, and one holding a single card sells a product
 * nobody is using.
 *
 * Backlog is missing on purpose and cannot be used — it is the board's
 * issues-only column, and `toAssignableBoardStatus` rewrites a workspace filed
 * there to In progress, so naming it here would silently pile four cards into
 * one column. The Linear issues fill Backlog instead.
 */
export const DEMO_BOARD_STATUSES: Readonly<Record<string, string>> = {
	'ws-attachment-chips': 'in-progress',
	'ws-audit-log': 'done',
	'ws-cursor-pagination': 'in-review',
	'ws-diff-virtualization': 'in-review',
	'ws-idempotency-keys': 'done',
	'ws-menu-accelerators': 'canceled',
	'ws-quit-guard': 'in-progress',
	'ws-rate-limit': 'in-review',
	'ws-release-notes': 'in-review',
	'ws-secret-storage': 'in-progress',
	'ws-terminal-webgl': 'done',
	'ws-tray-icon': 'done',
	'ws-webhook-retries': 'in-progress',
};

/** Changed files per workspace path, shared so every shot agrees on the counts. */
export const DEMO_GIT_FILES: Readonly<
	Record<string, readonly WorkspaceGitFileWire[]>
> = {
	[WORKSPACE_PATHS.attachmentChips]: [
		{
			additions: 210,
			deletions: 44,
			path: 'src/renderer/components/chat-attachment-chip.tsx',
			status: 'modified',
		},
		{
			additions: 96,
			deletions: 0,
			path: 'src/renderer/lib/agent-timeline/inline-attachment.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.rateLimit]: [
		{
			additions: 88,
			deletions: 12,
			path: 'src/middleware/rate-limit.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.releaseNotes]: [
		{
			additions: 1,
			deletions: 0,
			path: 'src/main/updates/update-service.ts',
			status: 'modified',
		},
		{
			additions: 34,
			deletions: 2,
			path: 'src/renderer/components/settings/updates-panel.tsx',
			status: 'modified',
		},
		{
			additions: 61,
			deletions: 0,
			path: 'tests/main/update-service.test.ts',
			status: 'added',
		},
		{
			additions: 4,
			deletions: 0,
			path: 'src/renderer/lib/i18n/locales/ru/settings.json',
			status: 'modified',
		},
		{
			additions: 4,
			deletions: 0,
			path: 'src/renderer/lib/i18n/locales/el/settings.json',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.trayIcon]: [
		{
			additions: 47,
			deletions: 3,
			path: 'src/main/app/linux-desktop-identity.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.webhookRetries]: [
		{
			additions: 132,
			deletions: 18,
			path: 'src/jobs/webhook-dispatch.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.auditLog]: [
		{
			additions: 143,
			deletions: 0,
			path: 'src/audit/audit-log.ts',
			status: 'added',
		},
		{
			additions: 26,
			deletions: 4,
			path: 'src/routes/admin.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.cursorPagination]: [
		{
			additions: 204,
			deletions: 91,
			path: 'src/routes/list-endpoints.ts',
			status: 'modified',
		},
		{
			additions: 77,
			deletions: 0,
			path: 'src/pagination/cursor.ts',
			status: 'added',
		},
		{
			additions: 118,
			deletions: 6,
			path: 'tests/pagination/cursor.test.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.diffVirtualization]: [
		{
			additions: 312,
			deletions: 87,
			path: 'src/renderer/components/workbench-shell/diff/diff-viewer.tsx',
			status: 'modified',
		},
		{
			additions: 64,
			deletions: 0,
			path: 'src/renderer/hooks/workbench-shell/diff/use-virtual-hunks.ts',
			status: 'added',
		},
	],
	[WORKSPACE_PATHS.idempotencyKeys]: [
		{
			additions: 96,
			deletions: 11,
			path: 'src/middleware/idempotency.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.menuAccelerators]: [
		{
			additions: 58,
			deletions: 22,
			path: 'src/main/menu/application-menu.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.quitGuard]: [
		{
			additions: 74,
			deletions: 0,
			path: 'src/main/app/quit-guard.ts',
			status: 'added',
		},
		{
			additions: 12,
			deletions: 1,
			path: 'src/main/app/window-state.ts',
			status: 'modified',
		},
	],
	[WORKSPACE_PATHS.secretStorage]: [
		{
			additions: 165,
			deletions: 38,
			path: 'src/main/secrets/safe-storage.ts',
			status: 'modified',
		},
		{
			additions: 41,
			deletions: 0,
			path: 'src/main/secrets/keyring-probe.ts',
			status: 'added',
		},
	],
	[WORKSPACE_PATHS.terminalWebgl]: [
		{
			additions: 129,
			deletions: 16,
			path: 'src/renderer/lib/terminal/xterm-adapter.ts',
			status: 'modified',
		},
		{
			additions: 83,
			deletions: 0,
			path: 'tests/renderer/terminal-webgl-renderer.test.ts',
			status: 'added',
		},
	],
};

/** File tree the review panel's Files tab renders. */
export const DEMO_WORKSPACE_FILES = [
	{ kind: 'directory' as const, name: 'src', path: 'src' },
	{ kind: 'directory' as const, name: 'main', path: 'src/main' },
	{ kind: 'directory' as const, name: 'updates', path: 'src/main/updates' },
	{
		kind: 'file' as const,
		name: 'update-service.ts',
		path: 'src/main/updates/update-service.ts',
	},
	{
		kind: 'file' as const,
		name: 'updater-port.ts',
		path: 'src/main/updates/updater-port.ts',
	},
	{ kind: 'directory' as const, name: 'renderer', path: 'src/renderer' },
	{ kind: 'directory' as const, name: 'tests', path: 'tests' },
	{ kind: 'file' as const, name: 'README.md', path: 'README.md' },
	{ kind: 'file' as const, name: 'package.json', path: 'package.json' },
];
