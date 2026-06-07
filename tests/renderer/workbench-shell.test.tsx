import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	NavigationProvider,
	SetupDiagnosticsProvider,
} from '../../src/renderer/components/workbench-shell/contexts';
import { WorkspaceConversationContent } from '../../src/renderer/components/workbench-shell/conversation-panel';
import { WorkbenchFrame } from '../../src/renderer/components/workbench-shell/frame';
import { WorkspaceWorkbenchContent } from '../../src/renderer/components/workbench-shell/workspace-content';
import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	DEFAULT_TERMINAL_DOCK_TAB_ID,
	getComposerState,
	normalizeWorkbenchSearch,
} from '../../src/renderer/lib/workbench';
import {
	findSession,
	getDefaultProject,
	getDefaultWorkspace,
	shellFixtureProjects,
} from '../../src/renderer/fixtures/workbench';
import type {
	DockTabId,
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type { WorkbenchDockActions } from '../../src/renderer/types/workbench-shell';
import type {
	SetupCheckGroupId,
	SetupCheckId,
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupDiagnosticsSnapshot,
} from '../../src/shared/ipc';

const NOW = '2026-06-05T00:00:00.000Z';
const GROUPS: Record<SetupCheckId, SetupCheckGroupId> = {
	config: 'core',
	'environment-variables': 'core',
	'gh-auth': 'github',
	'gh-cli': 'github',
	'git-executable': 'github',
	'linear-oauth': 'linear',
	'managed-directories': 'storage',
	'pi-agent-directory': 'pi',
	'pi-executable': 'pi',
	'pi-provider-model': 'pi',
	'pi-rpc': 'pi',
	'root-directory': 'storage',
	'shell-process-launch': 'core',
	'sqlite-database': 'storage',
};

const DOCK_ACTIONS: WorkbenchDockActions = {
	onNewTerminal: () => undefined,
	onOpenRunPort: () => undefined,
	onOpenSetupScripts: () => undefined,
	onRunScript: () => undefined,
	onRunSetupScript: () => undefined,
	onStopRunScript: () => undefined,
};

const EMPTY_ROUTE_SEARCH = (): WorkbenchRouteSearch => ({});

function renderWorkbench(
	snapshot: SetupDiagnosticsSnapshot | null,
	workspaceOverride?: WorkspaceShellModel,
	activeReviewTab = DEFAULT_REVIEW_TAB,
	activeDockTab: DockTabId = DEFAULT_DOCK_TAB,
	projectsOverride: ProjectShellModel[] = shellFixtureProjects,
) {
	const activeWorkspace = workspaceOverride ?? getDefaultWorkspace();
	const activeProject =
		projectsOverride.find((project) =>
			project.workspaces.some(
				(workspace) => workspace.id === activeWorkspace.id,
			),
		) ?? getDefaultProject();
	const activeSession = findSession(activeWorkspace);

	return renderToStaticMarkup(
		<NavigationProvider
			value={{ renderStaticLink: undefined, renderWorkspaceLink: undefined }}
		>
			<SetupDiagnosticsProvider
				value={{
					state: {
						setupDiagnostics: snapshot,
						setupDiagnosticsError: null,
						isSetupDiagnosticsRetrying: false,
					},
					actions: { onSetupDiagnosticsRetry: () => undefined },
				}}
			>
				<WorkbenchFrame
					activeProject={activeProject}
					activeView='workspace'
					activeWorkspace={activeWorkspace}
					health={{
						detail: 'Renderer query fixture',
						label: 'IPC online',
						state: 'online',
					}}
					onStaticNavigationSelect={() => undefined}
					onWorkspaceSelect={() => undefined}
					projects={projectsOverride}
					resolveWorkspaceRouteSearch={EMPTY_ROUTE_SEARCH}
				>
					<WorkspaceWorkbenchContent
						activeProject={activeProject}
						activeReviewTab={activeReviewTab}
						activeSession={activeSession}
						activeWorkspace={activeWorkspace}
						composer={getComposerState({
							activeSession,
							setupDiagnostics: snapshot,
							setupError: null,
						})}
						dockActions={DOCK_ACTIONS}
						dockTabId={activeDockTab}
						onDockTabChange={() => undefined}
						onReviewTabChange={() => undefined}
						onSessionTabChange={() => undefined}
						MainContent={(mainContent) => (
							<WorkspaceConversationContent {...mainContent} />
						)}
					/>
				</WorkbenchFrame>
			</SetupDiagnosticsProvider>
		</NavigationProvider>,
	);
}

test('renders the Conductor-style workbench shell regions', () => {
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		undefined,
		'checks',
	);

	expect(markup).toContain('Dashboard');
	expect(markup).toContain('History');
	expect(markup).toContain('Help');
	expect(markup).toContain('Repositories');
	expect(markup).toContain('Open repository creation menu');
	expect(markup).toContain('Collapse repository ensemble');
	expect(markup).toContain('data-slot="context-menu-trigger"');
	expect(markup).toContain('Reorder repository ensemble');
	expect(markup).toContain(
		'data-action-placeholder="workspace-archive-confirmation"',
	);
	expect(markup).toContain('2 repos');
	expect(markup).toContain('5 workspaces');
	expect(markup).toContain('Open workspace Conductor shell rework');
	expect(markup).toContain('Archive workspace Conductor shell rework');
	expect(markup).toContain('data-permission-boundary="confirmation-required"');
	expect(markup).toContain('data-slot="reorder-list-group"');
	expect(markup).toContain('data-slot="reorder-list-item"');
	expect(markup).toContain('data-workspace-sidebar-state="pr-working"');
	expect(markup).toContain('data-workspace-sidebar-state="pr-checking"');
	expect(markup).toContain('data-workspace-sidebar-state="workspace-working"');
	expect(markup).toContain('data-workspace-sidebar-state="pr-ready"');
	expect(markup).toContain('Conductor shell rework');
	expect(markup).toContain('Review shell');
	expect(markup).toContain('Mock agent chat');
	expect(markup).toContain('Chat mock in progress');
	expect(markup).toContain('Renderer tests');
	expect(markup).toContain('Close Review shell tab');
	expect(markup).toContain('Close Setup notes tab');
	expect(markup).toContain('Open closed chat tabs');
	expect(markup).toContain('psoldunov avatar');
	expect(markup).toContain('lucide-folder-git-2');
	expect(markup).toContain('All files');
	expect(markup).toContain('Changes');
	expect(markup).toContain('Checks');
	expect(markup).toContain('Setup');
	expect(markup).toContain('Run');
	expect(markup).toContain('Terminal');
	expect(markup).toContain('Collapse terminal area');
	expect(markup).toContain('New terminal');
	expect(markup).toContain('Open :5173');
	expect(markup).toContain('Stop');
	expect(markup).not.toContain('Rerun');
	expect(markup).toContain('#13');
	expect(markup).toContain('Working...');
	expect(markup).toContain('Pull request activity in progress');
	expect(markup).toContain('THE-102 Rework workbench shell');
	expect(markup).toContain('Add all to chat');
	expect(markup).toContain('Open app settings');
	expect(markup).toContain('Open current workspace in VS Code');
	expect(markup).toContain('Open current workspace app options');
	expect(markup).toContain('Ask Pi to continue review shell');
	expect(markup).toContain('Requires confirmation');
	expect(markup).not.toContain('Open pull request menu');
	expect(markup).not.toContain('Open workspace menu');
	expect(markup).not.toContain('Changed files');
	expect(markup).not.toContain('Review state');
});

test('does not mark a workspace active on static workbench routes', () => {
	const activeWorkspace = getDefaultWorkspace();
	const activeProject = getDefaultProject();
	const markup = renderToStaticMarkup(
		<NavigationProvider
			value={{ renderStaticLink: undefined, renderWorkspaceLink: undefined }}
		>
			<WorkbenchFrame
				activeProject={activeProject}
				activeView='dashboard'
				activeWorkspace={activeWorkspace}
				health={{
					detail: 'Renderer query fixture',
					label: 'IPC online',
					state: 'online',
				}}
				onStaticNavigationSelect={() => undefined}
				onWorkspaceSelect={() => undefined}
				projects={shellFixtureProjects}
				resolveWorkspaceRouteSearch={EMPTY_ROUTE_SEARCH}
			>
				<div />
			</WorkbenchFrame>
		</NavigationProvider>,
	);

	expect(markup).toContain('Dashboard');
	expect(markup).toContain('Conductor shell rework');
	expect(markup.match(/data-active="true"/g)).toHaveLength(1);
});

test('models installed workspace open targets for the header launcher', () => {
	const workspace = getDefaultWorkspace();
	const openTargets = workspace.openTargets
		.filter((target) => target.installed || target.kind === 'utility')
		.map((target) => target.label);

	expect(openTargets).toEqual([
		'Finder',
		'VS Code',
		'Zed',
		'Xcode',
		'Ghostty',
		'Warp',
		'Terminal',
		'GitHub Desktop',
		'Copy path',
	]);
	expect(workspace.openTargets.find((target) => target.isPrimary)?.label).toBe(
		'VS Code',
	);
});

test('models fixed script output tabs separately from interactive terminals', () => {
	const [setupTab, runTab, terminalTab] = getDefaultWorkspace().dockTabs;

	expect(setupTab).toMatchObject({
		id: 'setup',
		kind: 'setup-script',
		label: 'Setup',
	});
	expect(runTab).toMatchObject({
		id: 'run',
		kind: 'run-script',
		label: 'Run',
	});
	expect(terminalTab).toMatchObject({
		id: DEFAULT_TERMINAL_DOCK_TAB_ID,
		isDefault: true,
		kind: 'terminal',
		label: 'Terminal',
		sessionId: 'terminal-default',
	});
});

test('normalizes dock route state for terminal session tabs', () => {
	expect(normalizeWorkbenchSearch({}).dock).toBeUndefined();
	expect(normalizeWorkbenchSearch({}).review).toBeUndefined();
	expect(normalizeWorkbenchSearch({ dock: 'terminal' }).dock).toBe(
		DEFAULT_TERMINAL_DOCK_TAB_ID,
	);
	expect(normalizeWorkbenchSearch({ dock: 'terminal:logs' }).dock).toBe(
		'terminal:logs',
	);
	expect(normalizeWorkbenchSearch({ dock: 'terminal:' }).dock).toBe(
		DEFAULT_DOCK_TAB,
	);
});

test('renders additional user terminal tabs as independent interactive sessions', () => {
	const activeWorkspace: WorkspaceShellModel = {
		...getDefaultWorkspace(),
		dockTabs: [
			...getDefaultWorkspace().dockTabs,
			{
				id: 'terminal:logs',
				kind: 'terminal',
				label: 'Terminal 2',
				lines: ['$ tail -f app.log', 'ready'],
				sessionId: 'terminal-logs',
				status: 'running',
			},
		],
	};
	const snapshot = createSnapshot(
		[
			createCheck({ id: 'config', title: 'Declarative config' }),
			createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
		],
		'ready',
	);
	const markup = renderWorkbench(
		snapshot,
		activeWorkspace,
		'checks',
		'terminal:logs',
	);
	const setupMarkup = renderWorkbench(
		snapshot,
		activeWorkspace,
		'checks',
		DEFAULT_DOCK_TAB,
	);

	expect(markup).toContain('data-dock-tab-kind="setup-script"');
	expect(markup).toContain('data-dock-tab-kind="run-script"');
	expect(markup).toContain('data-dock-tab-kind="terminal"');
	expect(markup).toContain('Terminal 2');
	expect(markup).toContain('data-terminal-session-id="terminal-logs"');
	expect(markup).toContain('data-terminal-surface="interactive"');
	expect(setupMarkup).toContain(
		'data-terminal-surface="readonly-script-output"',
	);
});

test('marks setup notes tab as active agent activity', () => {
	const setupNotesSession = getDefaultWorkspace().sessions.find(
		(session) => session.id === 'setup-thread',
	);

	expect(setupNotesSession?.status).toBe('working');
});

test('models project owner avatars with repo-icon fallback', () => {
	const [ensembleProject, agentLabProject] = shellFixtureProjects;

	expect(ensembleProject.owner).toEqual({
		avatarUrl: 'https://github.com/psoldunov.png',
		name: 'psoldunov',
	});
	expect(agentLabProject.owner).toEqual({
		name: 'agent-lab',
	});
});

test('does not show a close control when only one chat tab remains', () => {
	const activeWorkspace = shellFixtureProjects[1].workspaces[0];
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
	);

	expect(markup).toContain('Checks pass');
	expect(markup).toContain('lucide-loader-circle');
	expect(markup).not.toContain('Close Checks pass tab');
});

test('renders merge-ready pull request state in the right header', () => {
	const activeWorkspace: WorkspaceShellModel = {
		...getDefaultWorkspace(),
		checks: {
			...getDefaultWorkspace().checks,
			status: 'blocked',
		},
		status: 'working',
		pullRequest: {
			...getDefaultWorkspace().pullRequest,
			description: ['All required checks passed.'],
			detail: 'All required checks passed.',
			gitStatus: {
				actionLabel: 'Merge',
				label: 'Ready to merge',
				status: 'ready',
			},
			label: 'Ready to merge',
			number: 29,
			previewDeployment: {
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://ensemble-ready.vercel.app',
			},
			status: 'ready-to-merge',
			title: 'Ready fixture',
			url: 'https://github.com/psoldunov/ensemble/pull/29',
		},
	};
	const activeProject: ProjectShellModel = {
		...getDefaultProject(),
		workspaces: [activeWorkspace],
	};
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
		DEFAULT_DOCK_TAB,
		[activeProject],
	);

	expect(markup).toContain('#29');
	expect(markup).toContain(
		'href="https://github.com/psoldunov/ensemble/pull/29"',
	);
	expect(markup).toContain('Ready to merge');
	expect(markup).toContain('data-workspace-sidebar-state="pr-ready"');
	expect(markup).not.toContain(
		'data-workspace-sidebar-state="workspace-blocked"',
	);
	expect(markup).toContain('data-checks-panel-state="pr-ready"');
	expect(markup).toContain('Preview');
	expect(markup).toContain('Open Vercel preview deployment');
	expect(markup).toContain('href="https://ensemble-ready.vercel.app"');
	expect(markup).toContain('Deployments');
	expect(markup).toContain('Open scan check');
	expect(markup).toContain(
		'href="https://github.com/psoldunov/ensemble/actions/runs/102"',
	);
	expect(markup).toContain('All required checks passed.');
	expect(markup).toContain('Merge');
	expect(markup).toContain('Requires confirmation');
	expect(markup).toContain('data-permission-boundary="confirmation-required"');
	expect(markup).not.toContain('Create PR');
});

test('renders an open idle pull request without working affordances', () => {
	const activeWorkspace: WorkspaceShellModel = {
		...getDefaultWorkspace(),
		checks: {
			...getDefaultWorkspace().checks,
			status: 'blocked',
		},
		status: 'working',
		pullRequest: {
			...getDefaultWorkspace().pullRequest,
			checks: [],
			comments: [],
			description: [],
			detail: 'Pull request is open.',
			gitStatus: {
				label: 'Open',
				status: 'open',
			},
			label: 'Open PR fixture',
			number: 31,
			status: 'idle',
			title: 'Open fixture',
		},
	};
	const activeProject: ProjectShellModel = {
		...getDefaultProject(),
		workspaces: [activeWorkspace],
	};
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
		DEFAULT_DOCK_TAB,
		[activeProject],
	);

	expect(markup).toContain('#31');
	expect(markup).toContain('Open PR fixture');
	expect(markup).toContain('data-workspace-sidebar-state="pr-open"');
	expect(markup).not.toContain(
		'data-workspace-sidebar-state="workspace-blocked"',
	);
	expect(markup).toContain('data-checks-panel-state="pr-open"');
	expect(markup).toContain('Pull request is open.');
	expect(markup).toContain('No checks reported yet');
	expect(markup).toContain('No description provided');
	expect(markup).toContain('Open pull request menu');
	expect(markup).not.toContain('Working...');
	expect(markup).not.toContain('Pull request activity in progress');
	expect(markup).not.toContain('Create PR');
});

test('renders a blocked pull request header with danger state actions', () => {
	const activeWorkspace: WorkspaceShellModel = {
		...getDefaultWorkspace(),
		pullRequest: {
			...getDefaultWorkspace().pullRequest,
			gitStatus: {
				label: 'Checks failed',
				status: 'blocked',
			},
			label: 'Checks failed',
			number: 32,
			status: 'blocked',
			title: 'Blocked fixture',
		},
	};
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
	);

	expect(markup).toContain('#32');
	expect(markup).toContain('Checks failed');
	expect(markup).toContain('data-pr-tone="blocked"');
	expect(markup).toContain('Open pull request menu');
	expect(markup).not.toContain('Pull request activity in progress');
	expect(markup).not.toContain('Create PR');
});

test('shows review action and changes menu only on changes tab', () => {
	const snapshot = createSnapshot(
		[
			createCheck({ id: 'config', title: 'Declarative config' }),
			createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
		],
		'ready',
	);
	const changesMarkup = renderWorkbench(snapshot, undefined, 'changes');
	const checksMarkup = renderWorkbench(snapshot, undefined, 'checks');

	expect(changesMarkup).toContain('review-panel-action-label">Review</span>');
	expect(changesMarkup).toContain('Show changes as folders');
	expect(changesMarkup).toContain(
		'Open src/renderer/components/workbench-shell.tsx diff',
	);
	expect(changesMarkup).toContain('Open changes menu');
	expect(checksMarkup).not.toContain(
		'review-panel-action-label">Review</span>',
	);
	expect(checksMarkup).not.toContain('Show changes as folders');
	expect(checksMarkup).not.toContain('Show changes as list');
	expect(checksMarkup).not.toContain('Open changes menu');
});

test('renders all files tab with repository file fixtures', () => {
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		undefined,
		'files',
	);

	expect(markup).toContain('.agents');
	expect(markup).toContain('node_modules');
	expect(markup).toContain('AGENTS.md');
	expect(markup).toContain('biome.json');
	expect(markup).toContain('forge.config.ts');
	expect(markup).toContain('Open .agents directory');
	expect(markup).toContain('Open AGENTS.md preview');
	expect(markup).toContain('Search files');
	expect(markup).toContain('type="button"');
	expect(markup).not.toContain('+220');
	expect(markup).not.toContain('-34');
});

test('renders setup-not-run dock action and empty state', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace) => workspace.id === 'linear-issue-flow',
	);

	if (!activeWorkspace) {
		throw new Error('Linear issue flow fixture was not found.');
	}

	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
		'setup',
	);

	expect(markup).toContain('Run setup script');
	expect(markup).toContain('Setup script has not run');
	expect(markup).not.toContain('Rerun');
});

test('renders missing setup and run script empty states', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace) => workspace.id === 'normal-right-header',
	);

	if (!activeWorkspace) {
		throw new Error('Normal right header fixture was not found.');
	}

	const setupMarkup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
		'setup',
	);
	const runMarkup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
		'run',
	);

	expect(setupMarkup).toContain('Setup Scripts');
	expect(setupMarkup).toContain('No setup script configured');
	expect(runMarkup).toContain('Setup Scripts');
	expect(runMarkup).toContain('No run script configured');
	expect(runMarkup).not.toContain('Stop');
});

test('renders run action when dev server is stopped', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace) => workspace.id === 'changed-right-header',
	);

	if (!activeWorkspace) {
		throw new Error('Changed right header fixture was not found.');
	}

	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
		'run',
	);

	expect(markup).toContain('Run');
	expect(markup).toContain('Run script has not started');
	expect(markup).not.toContain('Open :');
	expect(markup).not.toContain('Stop');
});

test('renders no pull request empty state in the checks tab', () => {
	const activeWorkspace: WorkspaceShellModel = {
		...getDefaultWorkspace(),
		changeSummary: {
			additions: 0,
			deletions: 0,
			files: 0,
		},
		pullRequest: {
			...getDefaultWorkspace().pullRequest,
			comments: [],
			description: [],
			detail: 'No pull request yet.',
			gitStatus: {
				label: 'No PR open',
				status: 'open',
			},
			label: 'No PR',
			number: undefined,
			status: 'idle',
			title: '',
			todos: [],
		},
	};
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
	);

	expect(markup).toContain('data-checks-panel-state="empty"');
	expect(markup).toContain('No local changes to review.');
	expect(markup).toContain('No PR open');
	expect(markup).not.toContain('PR title');
	expect(markup).not.toContain('PR description');
	expect(markup).not.toContain('Create PR');
	expect(markup).not.toContain('Open create pull request options');
	expect(markup).not.toContain('Commit and push');
});

test('renders create pull request action when changed workspace has no pull request', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace) => workspace.id === 'changed-right-header',
	);

	if (!activeWorkspace) {
		throw new Error('Changed right header fixture was not found.');
	}

	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
	);

	expect(markup).toContain('Changed right header');
	expect(markup).toContain('Create PR');
	expect(markup).toContain('Open create pull request options');
	expect(markup).not.toContain('Working...');
	expect(markup).not.toContain('Pull request activity in progress');
});

test('renders uncommitted no pull request state in the checks tab', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace) => workspace.id === 'changed-right-header',
	);

	if (!activeWorkspace) {
		throw new Error('Changed right header fixture was not found.');
	}

	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
		'checks',
	);

	expect(markup).toContain('data-checks-panel-state="uncommitted"');
	expect(markup).toContain('1 uncommitted change ready for PR setup.');
	expect(markup).toContain('No PR open');
	expect(markup).toContain('Create PR');
	expect(markup).toContain('Open create pull request options');
	expect(markup).toContain('Commit and push');
	expect(markup).not.toContain('PR title');
	expect(markup).not.toContain('PR description');
});

test('renders plain working header fixture without pull request number', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace) => workspace.id === 'normal-right-header',
	);

	if (!activeWorkspace) {
		throw new Error('Normal right header fixture was not found.');
	}

	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({ id: 'config', title: 'Declarative config' }),
				createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
			],
			'ready',
		),
		activeWorkspace,
	);

	expect(markup).toContain('Normal right header');
	expect(markup).not.toContain('Working...');
	expect(markup).not.toContain('Pull request activity in progress');
	expect(markup).not.toContain('Create PR');
	expect(markup).not.toContain('#13');
	expect(markup).not.toContain('Open pull request menu');
});

test('keeps blocked setup inside the workbench and disables the composer', () => {
	const markup = renderWorkbench(
		createSnapshot(
			[
				createCheck({
					detail: 'Install git or Xcode Command Line Tools before retrying.',
					id: 'git-executable',
					status: 'failure',
					title: 'Git executable',
				}),
			],
			'blocked',
		),
	);

	expect(markup).toContain('Setup keeps the shell in place');
	expect(markup).toContain('Fix setup blockers before sending a prompt.');
	expect(markup).toContain('disabled');
	expect(markup).toContain('bun install');
	expect(markup).toContain('Core workflows are blocked');
	expect(markup).toContain('Git executable');
	expect(markup).toContain('Retry checks');
	expect(markup).toContain('Open :5173');
});

function createCheck({
	blocking = true,
	detail,
	id,
	status = 'success',
	title,
}: {
	blocking?: boolean;
	detail?: string;
	id: SetupCheckId;
	status?: SetupCheckStatus;
	title?: string;
}): SetupCheckSnapshot {
	return {
		blocking,
		description: `${id} description`,
		detail: detail ?? `${id} detail`,
		group: GROUPS[id],
		id,
		logs: [],
		remediationActions: [
			{
				id: `retry-${id}`,
				kind: 'retry',
				label: 'Retry check',
			},
		],
		status,
		title: title ?? id,
		updatedAt: NOW,
	};
}

function createSnapshot(
	checks: SetupCheckSnapshot[],
	status: SetupDiagnosticsSnapshot['status'],
): SetupDiagnosticsSnapshot {
	const requiredChecks = checks.filter((check) => check.blocking);
	const blockedChecks = requiredChecks.filter(
		(check) => check.status !== 'success' && check.status !== 'warning',
	);

	return {
		blockedCount: blockedChecks.length,
		checks,
		generatedAt: NOW,
		optionalCount: checks.length - requiredChecks.length,
		requiredCount: requiredChecks.length,
		status,
		successCount: checks.filter((check) => check.status === 'success').length,
		warningCount: checks.filter((check) => check.status === 'warning').length,
	};
}
