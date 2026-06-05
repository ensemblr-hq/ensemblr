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

export interface DockTabModel {
	id: DockTabId;
	label: string;
	status: 'idle' | 'ready' | 'running' | 'warning';
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
	pathLabel: string;
	projectId: string;
	pullRequest: {
		detail: string;
		label: string;
		status: PullRequestShellStatus;
	};
	reviewFiles: ReviewFileSummary[];
	sessions: SessionTabModel[];
	sourceSummary: string;
	status: WorkspaceStatus;
}

export interface ProjectShellModel {
	id: string;
	name: string;
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

export const shellFixtureProjects: ProjectShellModel[] = [
	{
		id: 'piductor',
		name: 'piductor',
		pathLabel: '~/Piductor/repos/piductor',
		workspaces: [
			{
				branchName: 'san-antonio',
				changeSummary: {
					additions: 628,
					deletions: 31,
					files: 12,
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
				pathLabel: '~/Piductor/workspaces/piductor/san-antonio',
				projectId: 'piductor',
				pullRequest: {
					detail:
						'No pull request yet. Create one when the workspace is ready.',
					label: 'No PR',
					status: 'idle',
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
						status: 'blocked',
						summary:
							'Setup diagnostics remain visible in the dock instead of taking over the route.',
						updatedLabel: '12m ago',
					},
				],
				sourceSummary: 'branched from master with copied local context',
				status: 'needs-setup',
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
				pathLabel: '~/Piductor/workspaces/piductor/linear-issue-flow',
				projectId: 'piductor',
				pullRequest: {
					detail: 'Local shell checks are running before PR creation.',
					label: 'Checks running',
					status: 'checking',
				},
				reviewFiles: [],
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
			},
		],
	},
	{
		id: 'agent-lab',
		name: 'agent-lab',
		pathLabel: '~/Piductor/repos/agent-lab',
		workspaces: [
			{
				branchName: 'review-checks',
				changeSummary: {
					additions: 58,
					deletions: 7,
					files: 3,
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
				pathLabel: '~/Piductor/workspaces/agent-lab/review-checks',
				projectId: 'agent-lab',
				pullRequest: {
					detail: 'The agent is reading and writing workspace files.',
					label: 'Agent working',
					status: 'agent-working',
				},
				reviewFiles: [],
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
