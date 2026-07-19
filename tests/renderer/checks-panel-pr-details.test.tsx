// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { expect, test } from 'vitest';
import { ChecksPanel } from '../../src/renderer/components/workbench-shell/checks-panel/checks-panel';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import { createTestQueryClient } from './support/dom';

function createPullRequestWorkspace(
	pullRequest: Partial<WorkspaceShellModel['pullRequest']>,
): WorkspaceShellModel {
	const workspace = getDefaultWorkspace();
	return {
		...workspace,
		id: 'pr-details-test-workspace',
		pullRequest: {
			...workspace.pullRequest,
			checks: [],
			comments: [],
			description: [],
			detail: 'All required checks passed.',
			label: 'Ready to merge',
			number: 138,
			state: 'open',
			status: 'ready-to-merge',
			title: '',
			todos: [],
			...pullRequest,
		},
	};
}

function renderChecksPanel(workspace: WorkspaceShellModel) {
	const client = createTestQueryClient();
	const store = createStore();
	const tree = (currentWorkspace: WorkspaceShellModel) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>
				<ChecksPanel workspace={currentWorkspace} />
			</QueryClientProvider>
		</Provider>
	);
	const result = render(tree(workspace));
	return {
		...result,
		rerenderWorkspace: (currentWorkspace: WorkspaceShellModel) =>
			result.rerender(tree(currentWorkspace)),
	};
}

test('hydrates untouched PR details when the live snapshot arrives after restart', () => {
	const initialWorkspace = createPullRequestWorkspace({});
	const hydratedWorkspace = createPullRequestWorkspace({
		description: ['## Summary', 'Preserve the loaded pull request body.'],
		title: 'Persist action prompts and preserve app detection cache',
	});
	const { rerenderWorkspace } = renderChecksPanel(initialWorkspace);

	rerenderWorkspace(hydratedWorkspace);

	expect(screen.getByLabelText('PR title')).toHaveValue(
		'Persist action prompts and preserve app detection cache',
	);
	expect(screen.getByLabelText('PR description')).toHaveValue(
		'## Summary\n\nPreserve the loaded pull request body.',
	);
	expect(
		screen.queryByRole('button', { name: 'Discard' }),
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole('button', { name: 'Save' }),
	).not.toBeInTheDocument();
});

test('preserves edited PR fields while hydrating untouched fields', () => {
	const initialWorkspace = createPullRequestWorkspace({
		description: ['Initial description'],
		title: 'Initial title',
	});
	const refreshedWorkspace = createPullRequestWorkspace({
		description: ['Refreshed description'],
		title: 'Refreshed title',
	});
	const { rerenderWorkspace } = renderChecksPanel(initialWorkspace);

	fireEvent.change(screen.getByLabelText('PR title'), {
		target: { value: 'Local title edit' },
	});
	rerenderWorkspace(refreshedWorkspace);

	expect(screen.getByLabelText('PR title')).toHaveValue('Local title edit');
	expect(screen.getByLabelText('PR description')).toHaveValue(
		'Refreshed description',
	);
	expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('makes merged pull request details read-only', () => {
	renderChecksPanel(
		createPullRequestWorkspace({
			description: ['Merged description'],
			label: 'Merged',
			state: 'merged',
			status: 'idle',
			title: 'Merged title',
		}),
	);

	expect(screen.getByLabelText('PR title')).toHaveProperty('readOnly', true);
	expect(screen.getByLabelText('PR description')).toHaveProperty(
		'readOnly',
		true,
	);
});
