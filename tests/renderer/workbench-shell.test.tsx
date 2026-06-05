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
) {
	const activeProject = getDefaultProject();
	const activeWorkspace = workspaceOverride ?? getDefaultWorkspace();
	const activeSession = findSession(activeWorkspace);

	return renderToStaticMarkup(
		<WorkbenchShell
			activeProject={activeProject}
			activeReviewTab={DEFAULT_REVIEW_TAB}
			activeSession={activeSession}
			activeView='workspace'
			activeWorkspace={activeWorkspace}
			composer={getComposerState({
				activeSession,
				setupDiagnostics: snapshot,
				setupError: null,
			})}
			dockTabId={DEFAULT_DOCK_TAB}
			health={{
				detail: 'Renderer query fixture',
				label: 'IPC online',
				state: 'online',
			}}
			isSetupRefreshing={false}
			onDashboardSelect={() => undefined}
			onDockTabChange={() => undefined}
			onHistorySelect={() => undefined}
			onReviewTabChange={() => undefined}
			onSessionTabChange={() => undefined}
			onSettingsSelect={() => undefined}
			onSetupRetry={() => undefined}
			onWorkspaceSelect={() => undefined}
			projects={shellFixtureProjects}
			setupDiagnostics={snapshot}
			setupError={null}
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
	);

	expect(markup).toContain('Dashboard');
	expect(markup).toContain('History');
	expect(markup).toContain('Conductor shell rework');
	expect(markup).toContain('Review shell');
	expect(markup).toContain('All files');
	expect(markup).toContain('Changes');
	expect(markup).toContain('Checks');
	expect(markup).toContain('Setup');
	expect(markup).toContain('Run');
	expect(markup).toContain('Terminal');
	expect(markup).toContain('New terminal');
	expect(markup).toContain('Create PR');
	expect(markup).toContain('Open create pull request options');
	expect(markup).toContain('Open app settings');
	expect(markup).toContain('Ask Pi to continue review shell');
	expect(markup).not.toContain('Open workspace menu');
	expect(markup).not.toContain('Changed files');
	expect(markup).not.toContain('Review state');
});

test('renders merge-ready pull request state in the right header', () => {
	const activeWorkspace: WorkspaceShellModel = {
		...getDefaultWorkspace(),
		pullRequest: {
			detail: 'All required checks passed.',
			label: 'Ready to merge',
			status: 'ready-to-merge',
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

	expect(markup).toContain('Ready to merge');
	expect(markup).toContain('All required checks passed.');
	expect(markup).toContain('Merge');
	expect(markup).not.toContain('Create PR');
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
	expect(markup).toContain('Git executable');
	expect(markup).toContain('Retry check');
	expect(markup).toContain('Install git or Xcode Command Line Tools');
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
