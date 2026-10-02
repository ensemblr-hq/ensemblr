// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type {
	CommandFailureCopy,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';

import { renderChecksPanel } from './support/checks-panel';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

function createWorkspace(
	syncError: CommandFailureCopy,
	pullRequestNumber?: number,
): WorkspaceShellModel {
	const workspace = getDefaultWorkspace();
	return {
		...workspace,
		id: 'sync-error-test-workspace',
		pathLabel: '/tmp/sync-error-workspace',
		pullRequest: {
			...workspace.pullRequest,
			checks: [],
			comments: [],
			description: [],
			...(pullRequestNumber ? { number: pullRequestNumber } : {}),
			status: 'idle',
			syncError,
			todos: [],
		},
	};
}

afterEach(() => {
	clearEnsemblrApi();
});

test('a failed refresh explains itself instead of showing gh stderr alone', () => {
	installEnsemblrApi({});

	renderChecksPanel(
		createWorkspace({
			detail: 'could not determine current branch: not on any branch',
			message: 'This workspace is not on a branch.',
		}),
	);

	const alert = screen.getByRole('alert');
	expect(alert).toHaveTextContent('Could not refresh from GitHub');
	expect(alert).toHaveTextContent('This workspace is not on a branch.');
	// The stderr dump sits outside the live region, so a screen reader announces
	// the explanation rather than having gh's output read at it.
	expect(alert).not.toHaveTextContent('could not determine current branch');
	expect(
		screen.getByText('could not determine current branch: not on any branch'),
	).toBeInTheDocument();
});

test('the output block is reachable by keyboard and named', () => {
	installEnsemblrApi({});

	renderChecksPanel(
		createWorkspace({
			detail: 'fatal: could not read Username for https://github.com',
			message: 'The command failed.',
		}),
	);

	const output = screen.getByRole('region', { name: 'Command output' });
	expect(output).toHaveAttribute('tabindex', '0');
	expect(output).toHaveTextContent(
		'fatal: could not read Username for https://github.com',
	);
});

test('the banner drops its output block when there is nothing to demote', () => {
	installEnsemblrApi({});

	renderChecksPanel(
		createWorkspace(
			{ message: 'This repository has no remote configured.' },
			7,
		),
	);

	expect(screen.getByRole('alert')).toHaveTextContent(
		'This repository has no remote configured.',
	);
	expect(screen.queryByRole('region', { name: 'Command output' })).toBeNull();
});
