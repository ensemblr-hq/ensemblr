import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SetupDiagnosticsPanel } from '../../src/components/setup-diagnostics';
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

test('renders loading setup diagnostics state', () => {
	const markup = renderToStaticMarkup(
		<SetupDiagnosticsPanel onRetry={() => undefined} snapshot={null} />,
	);

	expect(markup).toContain('Checking setup readiness');
	expect(markup).toContain('Loading setup diagnostics');
	expect(markup).toContain('Retry checks');
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
