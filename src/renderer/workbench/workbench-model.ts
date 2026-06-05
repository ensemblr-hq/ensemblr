import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export type ReviewPanelTab = 'changes' | 'checks' | 'files';

export type DockTabId = 'run' | 'setup' | 'terminal';

export type WorkspaceStatus = 'idle' | 'needs-setup' | 'review' | 'working';

export type PullRequestShellStatus =
	| 'agent-working'
	| 'blocked'
	| 'checking'
	| 'idle'
	| 'ready-to-merge';

export type PullRequestCheckStatus = 'blocked' | 'pending' | 'ready';

export interface PullRequestCheckSummary {
	durationLabel?: string;
	id: string;
	label: string;
	provider: 'github' | 'local' | 'vercel';
	status: PullRequestCheckStatus;
}

export interface PullRequestCommentSummary {
	detail: string;
	id: string;
	provider: 'github-actions' | 'linear';
}

export interface PullRequestTodoSummary {
	id: string;
	label: string;
}

export interface PullRequestGitStatusSummary {
	actionLabel?: string;
	label: string;
	status: PullRequestCheckStatus | 'open';
}

export interface SessionTabModel {
	id: string;
	label: string;
	status: 'blocked' | 'idle' | 'working';
	summary: string;
	updatedLabel: string;
}

export interface ReviewFileSummary {
	additions: number;
	deletions: number;
	id: string;
	path: string;
	status: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked';
}

export interface WorkspaceFileSummary {
	id: string;
	kind: 'directory' | 'file';
	name: string;
	path: string;
}

export interface DockTabModel {
	id: DockTabId;
	label: string;
	status: 'idle' | 'ready' | 'running' | 'warning';
}

export interface WorkspaceScriptSummary {
	command?: string;
	lines: string[];
	port?: number;
	status: 'missing' | 'not-run' | 'running' | 'stopped' | 'succeeded';
}

export type WorkspaceOpenTargetKind =
	| 'editor'
	| 'file-manager'
	| 'source-control'
	| 'terminal'
	| 'utility';

export interface WorkspaceOpenTarget {
	iconName: string;
	id: string;
	installed: boolean;
	isPrimary?: boolean;
	kind: WorkspaceOpenTargetKind;
	label: string;
	numberShortcutLabel: string;
	shortcutLabel?: string;
}

export interface ComposerShellState {
	disabled: boolean;
	disabledReason: string | null;
	modelLabel: string;
	placeholder: string;
	thinkingLabel: string;
}

export interface WorkspaceShellModel {
	branchName: string;
	changeSummary: {
		additions: number;
		deletions: number;
		files: number;
	};
	checks: {
		detail: string;
		label: string;
		status: 'blocked' | 'pending' | 'ready';
	};
	dockTabs: DockTabModel[];
	id: string;
	name: string;
	openTargets: WorkspaceOpenTarget[];
	pathLabel: string;
	projectId: string;
	pullRequest: {
		checks: PullRequestCheckSummary[];
		comments: PullRequestCommentSummary[];
		description: string[];
		detail: string;
		gitStatus: PullRequestGitStatusSummary;
		label: string;
		number?: number;
		status: PullRequestShellStatus;
		title: string;
		todos: PullRequestTodoSummary[];
		url?: string;
	};
	reviewFiles: ReviewFileSummary[];
	scripts: {
		run: WorkspaceScriptSummary;
		setup: WorkspaceScriptSummary;
	};
	sessions: SessionTabModel[];
	sourceSummary: string;
	status: WorkspaceStatus;
	workspaceFiles: WorkspaceFileSummary[];
}

export interface ProjectShellModel {
	id: string;
	name: string;
	owner: {
		avatarUrl?: string;
		name: string;
	};
	pathLabel: string;
	workspaces: WorkspaceShellModel[];
}

export interface WorkbenchRouteSearch {
	chat?: string;
	dock?: DockTabId;
	review?: ReviewPanelTab;
}

export const DEFAULT_REVIEW_TAB: ReviewPanelTab = 'changes';
export const DEFAULT_DOCK_TAB: DockTabId = 'setup';

const defaultWorkspaceOpenTargets: WorkspaceOpenTarget[] = [
	{
		iconName: 'lucide:folder',
		id: 'finder',
		installed: true,
		kind: 'file-manager',
		label: 'Finder',
		numberShortcutLabel: '1',
	},
	{
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode',
		installed: true,
		isPrimary: true,
		kind: 'editor',
		label: 'VS Code',
		numberShortcutLabel: '2',
		shortcutLabel: '⌘O',
	},
	{
		iconName: 'lucide:file-code',
		id: 'zed',
		installed: true,
		kind: 'editor',
		label: 'Zed',
		numberShortcutLabel: '3',
	},
	{
		iconName: 'lucide:wrench',
		id: 'xcode',
		installed: true,
		kind: 'editor',
		label: 'Xcode',
		numberShortcutLabel: '4',
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'ghostty',
		installed: true,
		kind: 'terminal',
		label: 'Ghostty',
		numberShortcutLabel: '5',
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'warp',
		installed: true,
		kind: 'terminal',
		label: 'Warp',
		numberShortcutLabel: '6',
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'terminal',
		installed: true,
		kind: 'terminal',
		label: 'Terminal',
		numberShortcutLabel: '7',
	},
	{
		iconName: 'vscode-icons:folder-type-github',
		id: 'github-desktop',
		installed: true,
		kind: 'source-control',
		label: 'GitHub Desktop',
		numberShortcutLabel: '8',
	},
	{
		iconName: 'lucide:copy',
		id: 'copy-path',
		installed: true,
		kind: 'utility',
		label: 'Copy path',
		numberShortcutLabel: '9',
		shortcutLabel: '⌘⇧C',
	},
];

const piductorWorkspaceFiles: WorkspaceFileSummary[] = [
	{ id: 'dir-agents', kind: 'directory', name: '.agents', path: '.agents' },
	{ id: 'dir-claude', kind: 'directory', name: '.claude', path: '.claude' },
	{ id: 'dir-codex', kind: 'directory', name: '.codex', path: '.codex' },
	{ id: 'dir-context', kind: 'directory', name: '.context', path: '.context' },
	{ id: 'dir-github', kind: 'directory', name: '.github', path: '.github' },
	{ id: 'dir-vite', kind: 'directory', name: '.vite', path: '.vite' },
	{ id: 'dir-docs', kind: 'directory', name: 'docs', path: 'docs' },
	{
		id: 'dir-node-modules',
		kind: 'directory',
		name: 'node_modules',
		path: 'node_modules',
	},
	{ id: 'dir-out', kind: 'directory', name: 'out', path: 'out' },
	{ id: 'dir-scripts', kind: 'directory', name: 'scripts', path: 'scripts' },
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'dir-tests', kind: 'directory', name: 'tests', path: 'tests' },
	{ id: 'file-git', kind: 'file', name: '.git', path: '.git' },
	{
		id: 'file-gitignore',
		kind: 'file',
		name: '.gitignore',
		path: '.gitignore',
	},
	{
		id: 'file-gitkeep',
		kind: 'file',
		name: '.gitkeep',
		path: '.gitkeep',
	},
	{ id: 'file-agents', kind: 'file', name: 'AGENTS.md', path: 'AGENTS.md' },
	{ id: 'file-biome', kind: 'file', name: 'biome.json', path: 'biome.json' },
	{ id: 'file-bun-lock', kind: 'file', name: 'bun.lock', path: 'bun.lock' },
	{
		id: 'file-components',
		kind: 'file',
		name: 'components.json',
		path: 'components.json',
	},
	{
		id: 'file-conductor',
		kind: 'file',
		name: 'conductor.json',
		path: 'conductor.json',
	},
	{ id: 'file-context', kind: 'file', name: 'CONTEXT.md', path: 'CONTEXT.md' },
	{
		id: 'file-forge-config',
		kind: 'file',
		name: 'forge.config.ts',
		path: 'forge.config.ts',
	},
	{
		id: 'file-package',
		kind: 'file',
		name: 'package.json',
		path: 'package.json',
	},
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
];

const agentLabWorkspaceFiles: WorkspaceFileSummary[] = [
	{ id: 'dir-docs', kind: 'directory', name: 'docs', path: 'docs' },
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'dir-tests', kind: 'directory', name: 'tests', path: 'tests' },
	{
		id: 'file-package',
		kind: 'file',
		name: 'package.json',
		path: 'package.json',
	},
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
];

const runningDevScripts = {
	run: {
		command: 'bun run dev',
		lines: [
			'$ bun run dev',
			'VITE v5.4.21 ready in 418 ms',
			'Local: http://localhost:5173/',
			'Press h + enter to show help',
		],
		port: 5173,
		status: 'running',
	},
	setup: {
		command: 'bun install',
		lines: [
			'$ bun install',
			'Resolved, downloaded and extracted [9]',
			'Saved lockfile',
			'Done in 1.2s',
		],
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

const setupPendingScripts = {
	run: {
		command: 'bun run dev',
		lines: [],
		status: 'stopped',
	},
	setup: {
		command: 'bun install',
		lines: [],
		status: 'not-run',
	},
} satisfies WorkspaceShellModel['scripts'];

const stoppedRunScripts = {
	run: {
		command: 'bun run dev',
		lines: ['$ bun run dev', 'Run script has not started for this workspace.'],
		status: 'stopped',
	},
	setup: {
		command: 'bun install',
		lines: ['$ bun install', 'Dependencies are already up to date.'],
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

const missingScripts = {
	run: {
		lines: [],
		status: 'missing',
	},
	setup: {
		lines: [],
		status: 'missing',
	},
} satisfies WorkspaceShellModel['scripts'];

export const shellFixtureProjects: ProjectShellModel[] = [
	{
		id: 'piductor',
		name: 'piductor',
		owner: {
			avatarUrl: 'https://github.com/psoldunov.png',
			name: 'psoldunov',
		},
		pathLabel: '~/Piductor/repos/piductor',
		workspaces: [
			{
				branchName: 'san-antonio',
				changeSummary: {
					additions: 628,
					deletions: 31,
					files: 21,
				},
				checks: {
					detail:
						'No pull request yet. Local shell checks are the only active blockers.',
					label: 'No PR',
					status: 'pending',
				},
				dockTabs: [
					{ id: 'setup', label: 'Setup', status: 'warning' },
					{ id: 'run', label: 'Run', status: 'idle' },
					{ id: 'terminal', label: 'Terminal', status: 'idle' },
				],
				id: 'san-antonio',
				name: 'Conductor shell rework',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Piductor/workspaces/piductor/san-antonio',
				projectId: 'piductor',
				pullRequest: {
					checks: [
						{
							durationLabel: '33s',
							id: 'scan',
							label: 'scan',
							provider: 'github',
							status: 'ready',
						},
					],
					comments: [
						{
							detail: '<!-- linear-linkback --> <details> <summary><a hre...',
							id: 'linear-linkback',
							provider: 'linear',
						},
						{
							detail: '<!-- react-doctor:summary --> **React Doctor** fo...',
							id: 'react-doctor-summary',
							provider: 'github-actions',
						},
						{
							detail: 'src/renderer/router.tsx:69',
							id: 'router-comment',
							provider: 'github-actions',
						},
					],
					description: [
						'Reworks the scaffolded renderer into a fixture-backed Conductor-style workbench shell with project/workspace sidebar, chat tabs, center timeline/composer, right review/checks panel, PR-state header, and setup/run/terminal dock.',
						'Adds TanStack Router/Query for renderer navigation and preload-backed snapshots, replacing Jotai route state and removing the old scaffold/demo surfaces.',
						'Updates product docs so future repository, terminal, file, diff, checks, and settings tickets wire live data into existing shell regions instead of creating them.',
						'Validation: `bun run check`, `bun run typecheck`, `bun run test:renderer`.',
					],
					detail: 'The agent is updating this workspace.',
					gitStatus: {
						actionLabel: 'Merge',
						label: 'Ready to merge',
						status: 'ready',
					},
					label: 'Working...',
					number: 13,
					status: 'agent-working',
					title: 'THE-102 Rework workbench shell',
					todos: [],
				},
				reviewFiles: [
					{
						additions: 220,
						deletions: 34,
						id: 'renderer-app',
						path: 'src/renderer/App.tsx',
						status: 'modified',
					},
					{
						additions: 280,
						deletions: 0,
						id: 'workbench-shell',
						path: 'src/components/workbench-shell.tsx',
						status: 'added',
					},
					{
						additions: 96,
						deletions: 0,
						id: 'workbench-model',
						path: 'src/renderer/workbench/workbench-model.ts',
						status: 'added',
					},
					{
						additions: 34,
						deletions: 8,
						id: 'main',
						path: 'src/renderer/main.tsx',
						status: 'modified',
					},
				],
				scripts: runningDevScripts,
				sessions: [
					{
						id: 'review-shell',
						label: 'Review shell',
						status: 'idle',
						summary:
							'Fixture session showing the Conductor-style pane hierarchy before Pi RPC is wired.',
						updatedLabel: '2m ago',
					},
					{
						id: 'setup-thread',
						label: 'Setup notes',
						status: 'working',
						summary:
							'Setup diagnostics remain visible in the dock instead of taking over the route.',
						updatedLabel: '12m ago',
					},
				],
				sourceSummary: 'branched from master with copied local context',
				status: 'needs-setup',
				workspaceFiles: piductorWorkspaceFiles,
			},
			{
				branchName: 'linear-issue-flow',
				changeSummary: {
					additions: 144,
					deletions: 12,
					files: 5,
				},
				checks: {
					detail: 'Fixture workspace reserved for future Linear issue wiring.',
					label: 'Draft',
					status: 'pending',
				},
				dockTabs: [
					{ id: 'setup', label: 'Setup', status: 'ready' },
					{ id: 'run', label: 'Run', status: 'idle' },
					{ id: 'terminal', label: 'Terminal', status: 'idle' },
				],
				id: 'linear-issue-flow',
				name: 'Linear issue flow',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Piductor/workspaces/piductor/linear-issue-flow',
				projectId: 'piductor',
				pullRequest: {
					checks: [
						{
							durationLabel: 'running',
							id: 'build',
							label: 'build',
							provider: 'github',
							status: 'pending',
						},
					],
					comments: [],
					description: [
						'Fixture workspace reserved for the PR creation and check-polling flow.',
					],
					detail: '1 check pending...',
					gitStatus: {
						label: '1 check pending...',
						status: 'pending',
					},
					label: '1 check pending...',
					number: 18,
					status: 'checking',
					title: 'THE-118 Wire Linear issue flow',
					todos: [],
				},
				reviewFiles: [],
				scripts: setupPendingScripts,
				sessions: [
					{
						id: 'issue-kickoff',
						label: 'Issue kickoff',
						status: 'idle',
						summary: 'Future Pi session seeded from Linear metadata.',
						updatedLabel: '1h ago',
					},
				],
				sourceSummary: 'fixture workspace from future issue picker',
				status: 'idle',
				workspaceFiles: piductorWorkspaceFiles,
			},
			{
				branchName: 'normal-right-header',
				changeSummary: {
					additions: 0,
					deletions: 0,
					files: 0,
				},
				checks: {
					detail:
						'Fixture workspace for the plain working header without a pull request number.',
					label: 'Working',
					status: 'pending',
				},
				dockTabs: [
					{ id: 'setup', label: 'Setup', status: 'ready' },
					{ id: 'run', label: 'Run', status: 'idle' },
					{ id: 'terminal', label: 'Terminal', status: 'idle' },
				],
				id: 'normal-right-header',
				name: 'Normal right header',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Piductor/workspaces/piductor/normal-right-header',
				projectId: 'piductor',
				pullRequest: {
					checks: [],
					comments: [],
					description: [],
					detail: 'The agent is working before a PR exists.',
					gitStatus: {
						label: 'No PR open',
						status: 'open',
					},
					label: 'Working...',
					status: 'agent-working',
					title: '',
					todos: [],
				},
				reviewFiles: [],
				scripts: missingScripts,
				sessions: [
					{
						id: 'plain-header',
						label: 'Plain header',
						status: 'working',
						summary:
							'Fixture showing the normal right sidebar top heading without PR metadata.',
						updatedLabel: 'now',
					},
				],
				sourceSummary: 'fixture branch for the normal right sidebar header',
				status: 'working',
				workspaceFiles: piductorWorkspaceFiles,
			},
			{
				branchName: 'changed-right-header',
				changeSummary: {
					additions: 18,
					deletions: 3,
					files: 1,
				},
				checks: {
					detail:
						'Fixture workspace for the changed header before a pull request exists.',
					label: 'Changed',
					status: 'pending',
				},
				dockTabs: [
					{ id: 'setup', label: 'Setup', status: 'ready' },
					{ id: 'run', label: 'Run', status: 'idle' },
					{ id: 'terminal', label: 'Terminal', status: 'idle' },
				],
				id: 'changed-right-header',
				name: 'Changed right header',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Piductor/workspaces/piductor/changed-right-header',
				projectId: 'piductor',
				pullRequest: {
					checks: [],
					comments: [],
					description: [],
					detail: 'Local changes are ready for pull request creation.',
					gitStatus: {
						label: 'No PR open',
						status: 'open',
					},
					label: 'No PR',
					status: 'agent-working',
					title: '',
					todos: [],
				},
				reviewFiles: [
					{
						additions: 18,
						deletions: 3,
						id: 'right-sidebar-header',
						path: 'src/components/workbench-shell.tsx',
						status: 'modified',
					},
				],
				scripts: stoppedRunScripts,
				sessions: [
					{
						id: 'changed-header',
						label: 'Changed header',
						status: 'working',
						summary:
							'Fixture showing Create PR in the top header when local changes exist.',
						updatedLabel: 'now',
					},
				],
				sourceSummary: 'fixture branch for the changed right sidebar header',
				status: 'working',
				workspaceFiles: piductorWorkspaceFiles,
			},
		],
	},
	{
		id: 'agent-lab',
		name: 'agent-lab',
		owner: {
			name: 'agent-lab',
		},
		pathLabel: '~/Piductor/repos/agent-lab',
		workspaces: [
			{
				branchName: 'review-checks',
				changeSummary: {
					additions: 58,
					deletions: 7,
					files: 47,
				},
				checks: {
					detail: 'Ready-state fixture for future GitHub checks panel work.',
					label: 'Ready',
					status: 'ready',
				},
				dockTabs: [
					{ id: 'setup', label: 'Setup', status: 'ready' },
					{ id: 'run', label: 'Run', status: 'running' },
					{ id: 'terminal', label: 'Terminal', status: 'idle' },
				],
				id: 'review-checks',
				name: 'Review checks',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Piductor/workspaces/agent-lab/review-checks',
				projectId: 'agent-lab',
				pullRequest: {
					checks: [
						{
							durationLabel: '41s',
							id: 'scan',
							label: 'scan',
							provider: 'github',
							status: 'ready',
						},
					],
					comments: [],
					description: [
						'Adds the ready-to-merge checks fixture used by the right review panel.',
					],
					detail: 'All required checks passed.',
					gitStatus: {
						actionLabel: 'Merge',
						label: 'Ready to merge',
						status: 'ready',
					},
					label: 'Ready to merge',
					number: 29,
					status: 'ready-to-merge',
					title: 'feat(payouts): monthly agency payout ledger',
					todos: [],
				},
				reviewFiles: [],
				scripts: runningDevScripts,
				sessions: [
					{
						id: 'checks-pass',
						label: 'Checks pass',
						status: 'working',
						summary: 'Fixture showing a running agent tab.',
						updatedLabel: 'now',
					},
				],
				sourceSummary: 'fixture branch for review panel shape',
				status: 'working',
				workspaceFiles: agentLabWorkspaceFiles,
			},
		],
	},
];

export function getDefaultProject(): ProjectShellModel {
	return shellFixtureProjects[0];
}

export function getDefaultWorkspace(): WorkspaceShellModel {
	return getDefaultProject().workspaces[0];
}

export function findProject(projectId?: string): ProjectShellModel {
	return (
		shellFixtureProjects.find((project) => project.id === projectId) ??
		getDefaultProject()
	);
}

export function findWorkspace(
	project: ProjectShellModel,
	workspaceId?: string,
): WorkspaceShellModel {
	return (
		project.workspaces.find((workspace) => workspace.id === workspaceId) ??
		project.workspaces[0] ??
		getDefaultWorkspace()
	);
}

export function findSession(
	workspace: WorkspaceShellModel,
	sessionId?: string,
): SessionTabModel {
	return (
		workspace.sessions.find((session) => session.id === sessionId) ??
		workspace.sessions[0]
	);
}

export function normalizeWorkbenchSearch(
	search: Record<string, unknown>,
): WorkbenchRouteSearch {
	return {
		chat: typeof search.chat === 'string' ? search.chat : undefined,
		dock: isDockTab(search.dock) ? search.dock : DEFAULT_DOCK_TAB,
		review: isReviewTab(search.review) ? search.review : DEFAULT_REVIEW_TAB,
	};
}

export function getComposerState({
	activeSession,
	setupDiagnostics,
	setupError,
}: {
	activeSession: SessionTabModel;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupError: string | null;
}): ComposerShellState {
	if (setupError) {
		return {
			disabled: true,
			disabledReason: setupError,
			modelLabel: 'Pi model pending',
			placeholder: 'Resolve setup diagnostics before starting a Pi turn.',
			thinkingLabel: 'Thinking pending',
		};
	}

	if (!setupDiagnostics) {
		return {
			disabled: true,
			disabledReason: 'Piductor is still checking setup readiness.',
			modelLabel: 'Pi model pending',
			placeholder: 'Setup checks are still loading.',
			thinkingLabel: 'Thinking pending',
		};
	}

	if (setupDiagnostics.status !== 'ready') {
		return {
			disabled: true,
			disabledReason: `${setupDiagnostics.blockedCount} required setup checks need attention.`,
			modelLabel: 'Pi model pending',
			placeholder: 'Fix setup blockers before sending a prompt.',
			thinkingLabel: 'Thinking pending',
		};
	}

	return {
		disabled: false,
		disabledReason: null,
		modelLabel: 'GPT-5.5 via Pi',
		placeholder: `Ask Pi to continue ${activeSession.label.toLowerCase()}`,
		thinkingLabel: 'High',
	};
}

function isReviewTab(value: unknown): value is ReviewPanelTab {
	return value === 'files' || value === 'changes' || value === 'checks';
}

function isDockTab(value: unknown): value is DockTabId {
	return value === 'setup' || value === 'run' || value === 'terminal';
}
