import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkbenchShell } from '../../src/components/workbench-shell';
import type { WorkspaceShellModel } from '../../src/renderer/workbench/workbench-model';
import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	findSession,
	getComposerState,
	getDefaultProject,
	getDefaultWorkspace,
	shellFixtureProjects,
} from '../../src/renderer/workbench/workbench-model';
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

function renderWorkbench(
	snapshot: SetupDiagnosticsSnapshot | null,
	workspaceOverride?: WorkspaceShellModel,
	activeReviewTab = DEFAULT_REVIEW_TAB,
	activeDockTab = DEFAULT_DOCK_TAB,
) {
	const activeProject = getDefaultProject();
	const activeWorkspace = workspaceOverride ?? getDefaultWorkspace();
	const activeSession = findSession(activeWorkspace);

	return renderToStaticMarkup(
		<WorkbenchShell
			activeProject={activeProject}
			activeReviewTab={activeReviewTab}
			activeSession={activeSession}
			activeView='workspace'
			activeWorkspace={activeWorkspace}
			composer={getComposerState({
				activeSession,
				setupDiagnostics: snapshot,
				setupError: null,
			})}
			dockTabId={activeDockTab}
			health={{
				detail: 'Renderer query fixture',
				label: 'IPC online',
				state: 'online',
			}}
			onDockTabChange={() => undefined}
			onHistorySelect={() => undefined}
			onReviewTabChange={() => undefined}
			onSessionTabChange={() => undefined}
			onSettingsSelect={() => undefined}
			onWorkspaceSelect={() => undefined}
			projects={shellFixtureProjects}
			setupDiagnostics={snapshot}
		/>,
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

	expect(markup).toContain('History');
	expect(markup).toContain('Projects');
	expect(markup).toContain('Open project creation menu');
	expect(markup).toContain('Collapse project ensemble');
	expect(markup).toContain('data-slot="context-menu-trigger"');
	expect(markup).toContain('Reorder project ensemble');
	expect(markup).toContain('Open workspace Conductor shell rework');
	expect(markup).toContain('Archive workspace Conductor shell rework');
	expect(markup).toContain('data-permission-boundary="confirmation-required"');
	expect(markup).toContain('data-slot="reorder-list-group"');
	expect(markup).toContain('data-slot="reorder-list-item"');
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
	expect(markup).not.toContain('Dashboard');
	expect(markup).not.toContain('Changed files');
	expect(markup).not.toContain('Review state');
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
			status: 'ready-to-merge',
			title: 'Ready fixture',
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

	expect(markup).toContain('#29');
	expect(markup).toContain('Ready to merge');
	expect(markup).toContain('All required checks passed.');
	expect(markup).toContain('Merge');
	expect(markup).toContain('Requires confirmation');
	expect(markup).toContain('data-permission-boundary="confirmation-required"');
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
		'Open src/components/workbench-shell.tsx diff',
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

	expect(markup).toContain('PR title');
	expect(markup).toContain('PR description');
	expect(markup).toContain('No PR open');
	expect(markup).toContain('Create PR');
	expect(markup).toContain('Open create pull request options');
	expect(markup).toContain('Commit and push');
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
	expect(markup).not.toContain('Core workflows blocked');
	expect(markup).not.toContain('Git executable');
	expect(markup).not.toContain('Retry checks');
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
