import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	RootDirectoryChangeContent,
	SetupDiagnosticsPanel,
} from '../../src/renderer/components/setup-diagnostics';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectorySelectionResult,
	SetupCheckGroupId,
	SetupCheckId,
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupDiagnosticsSnapshot,
	SetupRemediationAction,
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

function createCheck({
	blocking = true,
	detail,
	id,
	status = 'success',
	title,
	remediationActions,
}: {
	blocking?: boolean;
	detail?: string;
	id: SetupCheckId;
	remediationActions?: SetupRemediationAction[];
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
		remediationActions: remediationActions ?? [
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

test('renders loading setup diagnostics state', () => {
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel onRetry={() => undefined} snapshot={null} />,
	);

	expect(markup).toContain('Checking setup readiness');
	expect(markup).toContain('Loading setup diagnostics');
	expect(markup).toContain('Retry checks');
	expect(markup).toContain('data-local-execution-notice="true"');
	expect(markup).toContain(
		'Agents, scripts, terminals, and tools run locally with your macOS account permissions.',
	);
});

test('renders success state for ready diagnostics', () => {
	const snapshot = createSnapshot(
		[
			createCheck({ id: 'config', title: 'Declarative config' }),
			createCheck({ id: 'sqlite-database', title: 'SQLite database' }),
		],
		'ready',
	);
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel snapshot={snapshot} />,
	);

	expect(markup).toContain('Core workflows are ready');
	expect(markup).toContain('Core workflows ready');
	expect(markup).toContain('Declarative config');
	expect(markup).toContain('SQLite database');
	expect(markup).toContain('Workspace trusted mode is the default');
});

test('renders failure state with remediation actions', () => {
	const snapshot = createSnapshot(
		[
			createCheck({
				detail: 'Install git or Xcode Command Line Tools before retrying.',
				id: 'git-executable',
				status: 'failure',
				title: 'Git executable',
			}),
		],
		'blocked',
	);
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel snapshot={snapshot} />,
	);

	expect(markup).toContain('Core workflows are blocked');
	expect(markup).toContain('Failed');
	expect(markup).toContain('Install git or Xcode Command Line Tools');
	expect(markup).toContain('Retry check');
});

test('renders retrying state', () => {
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel
			isRetrying
			onRetry={() => undefined}
			snapshot={null}
		/>,
	);

	expect(markup).toContain('Retrying');
	expect(markup).toContain('disabled');
});

test('renders optional Linear state without blocking language', () => {
	const snapshot = createSnapshot(
		[
			createCheck({
				blocking: false,
				detail: 'Linear OAuth is optional for local and GitHub-only workflows.',
				id: 'linear-oauth',
				status: 'warning',
				title: 'Linear connection',
			}),
		],
		'ready',
	);
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel snapshot={snapshot} />,
	);

	expect(markup).toContain('Linear connection');
	expect(markup).toContain('Optional');
	expect(markup).toContain('Linear OAuth is optional');
	expect(markup).not.toContain('Core workflows are blocked');
});

test('renders Pi executable and root-directory select-path remediations as action buttons', () => {
	const snapshot = createSnapshot(
		[
			createCheck({
				id: 'pi-executable',
				remediationActions: [
					{
						id: 'select-pi-executable',
						kind: 'select-path',
						label: 'Select Pi executable',
						target: 'pi.executablePath',
					},
					{
						id: 'retry-pi-executable',
						kind: 'retry',
						label: 'Retry Pi executable check',
					},
				],
				status: 'failure',
				title: 'Pi executable',
			}),
			createCheck({
				id: 'root-directory',
				remediationActions: [
					{
						id: 'choose-root-directory',
						kind: 'select-path',
						label: 'Choose another root',
						target: 'rootDirectory',
					},
				],
				status: 'failure',
				title: 'Root directory',
			}),
		],
		'blocked',
	);
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel snapshot={snapshot} />,
	);

	expect(markup).toContain('data-remediation-action="select-pi-executable"');
	expect(markup).toContain('data-remediation-action="choose-root-directory"');
	expect(markup).toContain('Select Pi executable');
	expect(markup).toContain('Retry Pi executable check');
	expect(markup).toContain('Choose another root');
	expect(markup).not.toContain('data-remediation-action="retry-pi-executable"');
});

test('renders root directory change confirmation copy', () => {
	const selection: RootDirectorySelectionResult = {
		canceled: false,
		preview: createRootDirectoryPreview(),
	};
	const markup = renderToStaticMarkup(
		<RootDirectoryChangeContent
			applyResult={null}
			canApply={selection.preview?.canApply ?? false}
			isApplying={false}
			onConfirm={() => undefined}
			preview={selection.preview ?? null}
		/>,
	);

	expect(markup).toContain('Change root directory');
	expect(markup).toContain('Old root contents are preserved.');
	expect(markup).toContain('Reindex/adopt is the default behavior.');
	expect(markup).toContain('Migration is a separate action.');
	expect(markup).toContain(
		'Delete or cleanup is a separate destructive action.',
	);
	expect(markup).toContain(
		'Shared Conductor root continuity covers filesystem, git, and config only',
	);
	expect(markup).toContain('/Users/alice/Ensemble');
	expect(markup).toContain('/Users/alice/Conductor');
	expect(markup).toContain('Switch root');
});

test('renders reconciliation errors as a danger apply result', () => {
	const preview = createRootDirectoryPreview();
	const applyResult: RootDirectoryChangeApplyResult = {
		applied: true,
		newRoot: preview.newRoot,
		oldRoot: preview.oldRoot,
		oldRootPreserved: true,
		reconciliation: {
			diagnostics: [
				{
					code: 'reconcile-directory-read-failed',
					message: 'Failed to read workspaces during root reconciliation.',
					path: '/Users/alice/Conductor/workspaces',
					severity: 'error',
				},
			],
			repositoryDirectoryCount: 1,
			scannedAt: '2026-06-06T08:05:00.000Z',
			status: 'error',
			workspaceDirectoryCount: 0,
		},
	};
	const markup = renderToStaticMarkup(
		<RootDirectoryChangeContent
			applyResult={applyResult}
			canApply={true}
			isApplying={false}
			onConfirm={() => undefined}
			preview={preview}
		/>,
	);

	expect(markup).toContain('Root switch result');
	expect(markup).toContain('Applied');
	expect(markup).toContain('text-status-danger');
	expect(markup).toContain('reconcile-directory-read-failed');
	expect(markup).toContain(
		'Failed to read workspaces during root reconciliation.',
	);
});

function createRootDirectoryPreview(): RootDirectoryChangePreview {
	return {
		canApply: true,
		diagnostics: [
			{
				code: 'shared-root-content',
				message:
					'Managed directory "repos" already contains content; it may be a shared or previously used root.',
				path: '/Users/alice/Conductor/repos',
				severity: 'warning',
			},
		],
		newRoot: {
			archivedContextsPath: '/Users/alice/Conductor/archived-contexts',
			createdPaths: [],
			diagnostics: [
				{
					code: 'shared-root-content',
					message:
						'Managed directory "repos" already contains content; it may be a shared or previously used root.',
					path: '/Users/alice/Conductor/repos',
					severity: 'warning',
				},
			],
			managedPaths: [
				{
					key: 'repos',
					path: '/Users/alice/Conductor/repos',
					status: 'present',
				},
				{
					key: 'workspaces',
					path: '/Users/alice/Conductor/workspaces',
					status: 'present',
				},
				{
					key: 'archived-contexts',
					path: '/Users/alice/Conductor/archived-contexts',
					status: 'present',
				},
			],
			path: '/Users/alice/Conductor',
			repositoriesPath: '/Users/alice/Conductor/repos',
			setting: null,
			source: 'sqlite',
			status: 'warning',
			workspacesPath: '/Users/alice/Conductor/workspaces',
		},
		oldRoot: {
			archivedContextsPath: '/Users/alice/Ensemble/archived-contexts',
			createdPaths: [],
			diagnostics: [],
			managedPaths: [
				{
					key: 'repos',
					path: '/Users/alice/Ensemble/repos',
					status: 'present',
				},
				{
					key: 'workspaces',
					path: '/Users/alice/Ensemble/workspaces',
					status: 'present',
				},
				{
					key: 'archived-contexts',
					path: '/Users/alice/Ensemble/archived-contexts',
					status: 'present',
				},
			],
			path: '/Users/alice/Ensemble',
			repositoriesPath: '/Users/alice/Ensemble/repos',
			setting: null,
			source: 'built-in-default',
			status: 'ok',
			workspacesPath: '/Users/alice/Ensemble/workspaces',
		},
		oldRootPreserved: true,
	};
}
