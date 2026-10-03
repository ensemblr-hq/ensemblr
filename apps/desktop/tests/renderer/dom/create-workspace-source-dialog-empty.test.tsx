// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CreateWorkspaceSourceDialog } from '@/renderer/components/workbench-shell/create-workspace-source-dialog';
import type {
	ProjectShellModel,
	WorkspaceSource,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

// Hoisted so the vi.mock factory, lifted above the imports, can close over it.
const pickerHolder = vi.hoisted(() => ({
	isLoading: false,
	linearGap: null as string | null,
	sources: [] as WorkspaceSource[],
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-picker',
	() => ({
		useWorkspaceSourcePicker: () => ({
			error: null,
			isLoading: pickerHolder.isLoading,
			itemsById: new Map<string, WorkspaceSourceItem>(),
			linearGap: pickerHolder.linearGap,
			sources: pickerHolder.sources,
		}),
	}),
);

const project = {
	id: 'repo-1',
	name: 'ensemblr',
	owner: { name: 'ensemblr-hq' },
	pathLabel: '~/Ensemblr/repos/ensemblr',
	workspaces: [],
} as unknown as ProjectShellModel;

const NOTHING_TO_START = /No issues waiting to be started/;
const NO_MATCH = /match your search/;

beforeEach(() => {
	pickerHolder.isLoading = false;
	pickerHolder.linearGap = null;
	pickerHolder.sources = [];
});

/**
 * Opens the dialog on the given repository and switches to one of its tabs.
 * @param tab - Accessible name of the source tab to select
 */
async function openTab(tab: 'Issues' | 'Pull requests'): Promise<void> {
	renderWithProviders(
		<CreateWorkspaceSourceDialog
			onOpenChange={() => {}}
			open
			project={project}
			projects={[project]}
		/>,
	);
	await userEvent.click(screen.getByRole('radio', { name: tab }));
}

// The Issues tab lists only unstarted work, so an empty tab is an ordinary
// state rather than a search miss, and must not blame a search nobody typed.
test('an empty Issues tab says nothing is waiting to be started', async () => {
	await openTab('Issues');

	expect(screen.getByText(NOTHING_TO_START)).toBeInTheDocument();
	expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
});

test('an Issues tab with rows shows them instead of the empty message', async () => {
	pickerHolder.sources = [
		{
			id: 'linear-1',
			kind: 'issue',
			provider: 'linear',
			reference: 'ENS-1',
			title: 'Wire the picker',
		},
	];
	await openTab('Issues');

	expect(screen.getByText('Wire the picker')).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});

test('an empty Issues tab that is still loading says so, not that nothing waits', async () => {
	pickerHolder.isLoading = true;
	await openTab('Issues');

	expect(screen.getByText('Loading issues…')).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});

// With Linear unreadable, "nothing waiting" would hide a backlog that exists.
test('an empty Issues tab names the Linear gap instead of claiming nothing waits', async () => {
	pickerHolder.linearGap = 'The Linear connection expired.';
	await openTab('Issues');

	expect(
		screen.getByText('The Linear connection expired.'),
	).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});

test('an empty Pull requests tab keeps the search-miss message', async () => {
	await openTab('Pull requests');

	expect(screen.getByText(NO_MATCH)).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});
