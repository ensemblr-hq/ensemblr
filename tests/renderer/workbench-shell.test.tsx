import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import { WorkspaceConversationContent } from '../../src/renderer/components/workbench-shell/conversation-panel';
import { WorkbenchFrame } from '../../src/renderer/components/workbench-shell/frame';
import {
	NavigationProvider,
	SetupDiagnosticsProvider,
} from '../../src/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceWorkbenchContent } from '../../src/renderer/components/workbench-shell/workspace-content';
import {
	findSession,
	getDefaultProject,
	getDefaultWorkspace,
	shellFixtureProjects,
} from '../../src/renderer/fixtures/workbench';
import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	getComposerState,
	normalizeWorkbenchSearch,
} from '../../src/renderer/lib/workbench';
import type {
	DockTabId,
	ProjectShellModel,
	SessionTabModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type {
	SessionTabActions,
	SessionTabState,
	WorkbenchDockActions,
} from '../../src/renderer/types/workbench-shell';
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
	onAskAgentSetupScript: () => undefined,
	onCloseTerminal: () => undefined,
	onNewTerminal: () => undefined,
	onOpenRunPort: () => undefined,
	onOpenSetupScripts: () => undefined,
	onRunScript: () => undefined,
	onRunSetupScript: () => undefined,
	onStopRunScript: () => undefined,
	onStopSetupScript: () => undefined,
};

const EMPTY_ROUTE_SEARCH = (): WorkbenchRouteSearch => ({});

/**
 * Minimal open-target snapshot used to seed the React Query cache so the
 * workbench header's "Open in…" menu renders during static markup tests.
 * Mirrors the shape produced by the main process detection pipeline.
 */
const OPEN_TARGETS_FIXTURE = [
	{
		behavior: 'reveal-in-finder',
		iconName: 'lucide:folder',
		id: 'finder',
		installed: true,
		kind: 'file-manager',
		label: 'Finder',
		numberShortcutLabel: '1',
	},
	{
		behavior: 'launch-app',
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
		behavior: 'copy-path',
		iconName: 'lucide:copy',
		id: 'copy-path',
		installed: true,
		kind: 'utility',
		label: 'Copy path',
		numberShortcutLabel: '3',
		shortcutLabel: '⌘⇧C',
	},
] as const;

/** Mirrors the hook's no-data fallback: placeholder sessions, no history. */
function stubSessionNavigation(
	activeSession: SessionTabModel,
	activeWorkspace: WorkspaceShellModel,
): SessionTabState & SessionTabActions {
	return {
		closedSessions: [],
		closeSessionTab: () => undefined,
		closeSessionTabAsync: () => Promise.resolve({ replacementChatTabId: null }),
		effectiveActiveSession: activeSession,
		openCommentPreviewTab: () => Promise.resolve(null),
		openFilePreviewTab: () => Promise.resolve(null),
		openSessionTab: () => Promise.resolve(null),
		openTurnDiffTab: () => Promise.resolve(null),
		openWorkspaceFileDiffTab: () => Promise.resolve(null),
		reorderSessionTabs: () => undefined,
		restoreSessionTab: () => undefined,
		sessionTabs: activeWorkspace.sessions,
	};
}

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
				(workspace: WorkspaceShellModel) => workspace.id === activeWorkspace.id,
			),
		) ?? getDefaultProject();
	const activeSession = findSession(activeWorkspace);

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	queryClient.setQueryData(ensemblrQueryKeys.workspaceOpenTargets(), {
		targets: OPEN_TARGETS_FIXTURE,
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
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
						addProjectMenu={{ actions: [], recents: [] }}
						health={{
							detail: 'Renderer query fixture',
							label: 'IPC online',
							state: 'online',
						}}
						onAddProject={() => undefined}
						onOpenRecentProject={() => undefined}
						onStaticNavigationSelect={() => undefined}
						onWorkspaceSelect={() => undefined}
						projects={projectsOverride}
						resolveWorkspaceRouteSearch={EMPTY_ROUTE_SEARCH}
					>
						<WorkspaceWorkbenchContent
							activeProject={activeProject}
							activeReviewTab={activeReviewTab}
							activeWorkspace={activeWorkspace}
							composer={getComposerState({
								activePiSessionId: null,
								activeSession,
								availableModels: [],
								availableThinkingLevels: [],
								isStreaming: false,
								modelId: 'gpt-5.5',
								onModelChange: () => undefined,
								onStop: () => undefined,
								onSubmit: () => undefined,
								onThinkingChange: () => undefined,
								setupDiagnostics: snapshot,
								setupError: null,
								thinkingLevel: 'high',
							})}
							dockActions={DOCK_ACTIONS}
							dockTabId={activeDockTab}
							onDockTabChange={() => undefined}
							onReviewTabChange={() => undefined}
							onSessionTabChange={() => undefined}
							sessionNavigation={stubSessionNavigation(
								activeSession,
								activeWorkspace,
							)}
							MainContent={(mainContent) => (
								<WorkspaceConversationContent {...mainContent} />
							)}
						/>
					</WorkbenchFrame>
				</SetupDiagnosticsProvider>
			</NavigationProvider>
		</QueryClientProvider>,
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
	expect(markup).toContain('Collapse repository ensemblr');
	expect(markup).toContain('data-slot="context-menu-trigger"');
	expect(markup).toContain('Reorder repository ensemblr');
	expect(markup).not.toContain('2 repos');
	expect(markup).not.toContain('5 workspaces');
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
	// THE-130: the mock chat fixture is gone. With no active Pi session in
	// the fixture, the chat surface renders the new-chat empty state.
	expect(markup).toContain('New chat empty state');
	expect(markup).not.toContain('Mock agent chat');
	expect(markup).not.toContain('Chat mock in progress');
	expect(markup).not.toContain('Renderer tests');
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
	// No default terminal tab: the dock starts with only Setup/Run + the `+`.
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
	// Reworked comment rows expose hover actions; "Hide comment" is unique to the
	// new row, so its presence proves the rebuilt Comments section rendered.
	expect(markup).toContain('Hide comment');
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
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const markup = renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<NavigationProvider
				value={{ renderStaticLink: undefined, renderWorkspaceLink: undefined }}
			>
				<WorkbenchFrame
					activeProject={activeProject}
					activeView='dashboard'
					activeWorkspace={activeWorkspace}
					addProjectMenu={{ actions: [], recents: [] }}
					health={{
						detail: 'Renderer query fixture',
						label: 'IPC online',
						state: 'online',
					}}
					onAddProject={() => undefined}
					onOpenRecentProject={() => undefined}
					onStaticNavigationSelect={() => undefined}
					onWorkspaceSelect={() => undefined}
					projects={shellFixtureProjects}
					resolveWorkspaceRouteSearch={EMPTY_ROUTE_SEARCH}
				>
					<div />
				</WorkbenchFrame>
			</NavigationProvider>
		</QueryClientProvider>,
	);

	expect(markup).toContain('Dashboard');
	expect(markup).toContain('Conductor shell rework');
	expect(markup.match(/data-active="true"/g)).toHaveLength(1);
});

test('models fixed script output tabs and no default terminal tab', () => {
	const dockTabs = getDefaultWorkspace().dockTabs;

	expect(dockTabs).toHaveLength(2);
	expect(dockTabs[0]).toMatchObject({
		id: 'setup',
		kind: 'setup-script',
		label: 'Setup',
	});
	expect(dockTabs[1]).toMatchObject({
		id: 'run',
		kind: 'run-script',
		label: 'Run',
	});
	expect(
		dockTabs.some(
			(tab: WorkspaceShellModel['dockTabs'][number]) => tab.kind === 'terminal',
		),
	).toBe(false);
});

test('normalizes dock route state for terminal session tabs', () => {
	expect(normalizeWorkbenchSearch({}).dock).toBeUndefined();
	expect(normalizeWorkbenchSearch({}).review).toBeUndefined();
	// A bare `terminal` value no longer maps to a default tab.
	expect(normalizeWorkbenchSearch({ dock: 'terminal' }).dock).toBe(
		DEFAULT_DOCK_TAB,
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
				sessionStatus: 'running',
				status: 'running',
				terminalId: 'terminal-logs',
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
	// Live terminal tabs expose a chat-tab-style close control when more than
	// one terminal tab exists; setup/run never do.
	expect(markup).toContain('Close Terminal 2 tab');
	expect(markup).not.toContain('Close Setup tab');
	expect(markup).not.toContain('Close Run tab');
	expect(setupMarkup).toContain('Close Terminal 2 tab');
});

test('marks setup notes tab as active agent activity', () => {
	const setupNotesSession = getDefaultWorkspace().sessions.find(
		(session: SessionTabModel) => session.id === 'setup-thread',
	);

	expect(setupNotesSession?.status).toBe('working');
});

test('models project owner avatars with repo-icon fallback', () => {
	const [ensemblrProject, agentLabProject] = shellFixtureProjects;

	expect(ensemblrProject.owner).toEqual({
		avatarUrl: 'https://github.com/psoldunov.png',
		name: 'psoldunov',
	});
	expect(agentLabProject.owner).toEqual({
		name: 'agent-lab',
	});
});

test('hides the close control when only one chat tab is visible', () => {
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
	// The min-one-tab invariant is visible in the renderer: no X appears for
	// the final remaining chat tab.
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
				url: 'https://ensemblr-ready.vercel.app',
			},
			status: 'ready-to-merge',
			title: 'Ready fixture',
			url: 'https://github.com/psoldunov/ensemblr/pull/29',
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
		'href="https://github.com/psoldunov/ensemblr/pull/29"',
	);
	expect(markup).toContain('Ready to merge');
	expect(markup).toContain('data-workspace-sidebar-state="pr-ready"');
	expect(markup).not.toContain(
		'data-workspace-sidebar-state="workspace-blocked"',
	);
	expect(markup).toContain('data-checks-panel-state="pr-ready"');
	// The Checks and Deployments sections were removed from the Checks panel;
	// their data no longer renders there (the preview-deploy link lives on in the
	// right-sidebar PR header, which is out of scope for this rework).
	expect(markup).not.toContain('Deployments');
	expect(markup).not.toContain('Open scan check');
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
	// The status banner is gone; PR title/description are editable inputs that
	// seed from the open PR (title here, empty description shows its placeholder).
	expect(markup).toContain('PR title');
	expect(markup).toContain('PR description');
	expect(markup).toContain('Open fixture');
	expect(markup).toContain('Open pull request menu');
	expect(markup).not.toContain('Working...');
	expect(markup).not.toContain('Pull request activity in progress');
	expect(markup).not.toContain('Create PR');
});

test('hides the git status section on a merged or closed pull request', () => {
	const snapshot = createSnapshot(
		[
			createCheck({ id: 'config', title: 'Declarative config' }),
			createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
		],
		'ready',
	);
	const withState = (
		state?: 'closed' | 'merged' | 'open',
	): WorkspaceShellModel => {
		const base = getDefaultWorkspace();
		return {
			...base,
			pullRequest: {
				...base.pullRequest,
				gitStatus: { label: 'Up to date with remote', status: 'open' },
				...(state ? { state } : {}),
			},
		};
	};

	const openMarkup = renderWorkbench(snapshot, withState('open'), 'checks');
	const mergedMarkup = renderWorkbench(snapshot, withState('merged'), 'checks');
	const closedMarkup = renderWorkbench(snapshot, withState('closed'), 'checks');

	// Open PRs keep the git status row; merged/closed PRs drop the whole section.
	expect(openMarkup).toContain('Up to date with remote');
	expect(mergedMarkup).not.toContain('Up to date with remote');
	expect(closedMarkup).not.toContain('Up to date with remote');
	// Comments stay available regardless of merge state.
	expect(mergedMarkup).toContain('Comments');
	expect(closedMarkup).toContain('Comments');
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
	// Directories are collapsible toggles ("Expand/Collapse <path>"); files open
	// a preview. (`.agents` starts collapsed.)
	expect(markup).toContain('Expand .agents');
	expect(markup).toContain('Open AGENTS.md preview');
	expect(markup).toContain('Search files');
	expect(markup).toContain('type="button"');
	expect(markup).not.toContain('+220');
	expect(markup).not.toContain('-34');
});

test('renders setup-not-run dock action and empty state', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace: WorkspaceShellModel) => workspace.id === 'linear-issue-flow',
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

	expect(markup).toContain('Run setup');
	expect(markup).toContain('No setup script output');
	expect(markup).not.toContain('Rerun');
});

test('renders missing setup and run script empty states', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace: WorkspaceShellModel) => workspace.id === 'normal-right-header',
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

	expect(setupMarkup).toContain('Add setup script');
	expect(setupMarkup).toContain('Ask agent');
	expect(setupMarkup).toContain('Add manually');
	expect(runMarkup).toContain('Setup Scripts');
	expect(runMarkup).toContain('No run script configured');
	expect(runMarkup).not.toContain('Stop');
});

test('renders run action when dev server is stopped', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace: WorkspaceShellModel) => workspace.id === 'changed-right-header',
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
	expect(markup).toContain('Start Run');
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
	expect(markup).toContain('No PR open');
	// PR title/description inputs replace the old status banner in every state.
	expect(markup).toContain('PR title');
	expect(markup).toContain('PR description');
	expect(markup).not.toContain('Create PR');
	expect(markup).not.toContain('Open create pull request options');
	expect(markup).not.toContain('Commit and push');
});

test('renders create pull request action when changed workspace has no pull request', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace: WorkspaceShellModel) => workspace.id === 'changed-right-header',
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
		(workspace: WorkspaceShellModel) => workspace.id === 'changed-right-header',
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
	expect(markup).toContain('1 uncommitted change');
	expect(markup).toContain('No PR open');
	expect(markup).toContain('Create PR');
	expect(markup).toContain('Open create pull request options');
	expect(markup).toContain('Commit and push');
	expect(markup).toContain('PR title');
	expect(markup).toContain('PR description');
});

test('renders plain working header fixture without pull request number', () => {
	const activeWorkspace = shellFixtureProjects[0].workspaces.find(
		(workspace: WorkspaceShellModel) => workspace.id === 'normal-right-header',
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

	// THE-130: the chat tab no longer hosts diagnostic UI. Blocked-setup
	// status lives in the sidebar footer (with a link to /settings/diagnostics)
	// and the composer disables silently — no panel inside the chat scroll.
	expect(markup).not.toContain('Setup keeps the shell in place');
	expect(markup).not.toContain('SetupDiagnosticsPanel');
	expect(markup).toContain('Fix setup blockers before sending a prompt.');
	expect(markup).toContain('disabled');
	// Developer Mode hides the sidebar diagnostics footer by default.
	expect(markup).not.toContain('data-sidebar-setup-status="blocked"');
	expect(markup).not.toContain('#/settings/diagnostics');
	// Workbench scaffolding still renders.
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
