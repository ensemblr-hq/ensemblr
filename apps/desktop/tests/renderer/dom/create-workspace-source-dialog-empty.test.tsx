// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CreateWorkspaceSourceDialog } from '@/renderer/components/workbench-shell/create-workspace-source-dialog';
import type {
	ProjectShellModel,
	WorkspaceCreationSeed,
	WorkspaceSource,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
import type { GithubFailure } from '@/shared/ipc/contracts/github';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import { renderWithProviders } from '../support/dom';

// Hoisted so the vi.mock factory, lifted above the imports, can close over it.
const pickerHolder = vi.hoisted(() => ({
	error: null as GithubFailure | null,
	isLoading: false,
	itemsById: new Map<string, WorkspaceSourceItem>(),
	linearGap: null as string | null,
	sources: [] as WorkspaceSource[],
	startedSources: [] as WorkspaceSource[],
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-picker',
	() => ({
		useWorkspaceSourcePicker: ({ query }: { query: string }) => ({
			error: pickerHolder.error,
			isLoading: pickerHolder.isLoading,
			itemsById: pickerHolder.itemsById,
			linearGap: pickerHolder.linearGap,
			sources: pickerHolder.sources,
			startedSources: query.trim() ? pickerHolder.startedSources : [],
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

const ISSUE_SEARCH_PLACEHOLDER =
	'Search by issue number, title, or description';

const startedLinearIssue = {
	accountId: 'acc-1',
	description: null,
	id: 'linear-started',
	identifier: 'ENS-9',
	teamKey: 'ENS',
	teamName: 'Ensemblr',
	title: 'Pick up the teammate ticket',
	url: 'https://linear.app/e/issue/ENS-9',
} as unknown as LinearIssueWire;

const startedSource: WorkspaceSource = {
	id: startedLinearIssue.id,
	kind: 'issue',
	provider: 'linear',
	reference: startedLinearIssue.identifier,
	title: startedLinearIssue.title,
};

beforeEach(() => {
	pickerHolder.error = null;
	pickerHolder.isLoading = false;
	pickerHolder.itemsById = new Map();
	pickerHolder.linearGap = null;
	pickerHolder.sources = [];
	pickerHolder.startedSources = [];
});

/**
 * Opens the dialog on the given repository and switches to one of its tabs.
 * @param tab - Accessible name of the source tab to select
 * @param onCreateWorkspace - Receives the seed when a row is chosen
 * @returns The render result, to reopen the dialog with
 */
async function openTab(
	tab: 'Issues' | 'Pull requests',
	onCreateWorkspace?: (input: {
		repoId: string;
		seed: WorkspaceCreationSeed;
	}) => void,
) {
	const rendered = renderWithProviders(
		<CreateWorkspaceSourceDialog
			onCreateWorkspace={onCreateWorkspace}
			onOpenChange={() => {}}
			open
			project={project}
			projects={[project]}
		/>,
	);
	await userEvent.click(screen.getByRole('radio', { name: tab }));
	return rendered;
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

// GitHub rows alone would read as the whole backlog while Linear is unreadable.
test('an Issues tab with rows names the Linear gap above them', async () => {
	pickerHolder.linearGap = 'The Linear connection expired.';
	pickerHolder.sources = [
		{
			id: 'github-issue-7',
			kind: 'issue',
			provider: 'github',
			reference: '#7',
			title: 'Fix the sidebar',
		},
	];
	await openTab('Issues');

	const note = screen.getByText('The Linear connection expired.');
	const row = screen.getByText('Fix the sidebar');
	expect(
		note.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	expect(screen.getByRole('listbox')).not.toContainElement(note);
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});

test('an Issues tab with rows and a complete Linear list shows no gap note', async () => {
	pickerHolder.sources = [
		{
			id: 'github-issue-7',
			kind: 'issue',
			provider: 'github',
			reference: '#7',
			title: 'Fix the sidebar',
		},
	];
	await openTab('Issues');

	expect(screen.getByText('Fix the sidebar')).toBeInTheDocument();
	expect(screen.queryByText(/Linear/)).not.toBeInTheDocument();
});

// cmdk reorders groups by match score, so both sections carry a heading once
// a search splits the list, and neither does before.
test('a search on the Issues tab lists started issues under their own heading', async () => {
	pickerHolder.sources = [
		{
			id: 'linear-todo',
			kind: 'issue',
			provider: 'linear',
			reference: 'ENS-2',
			title: 'Teammate onboarding checklist',
		},
	];
	pickerHolder.startedSources = [startedSource];
	await openTab('Issues');

	expect(screen.getByText('Teammate onboarding checklist')).toBeInTheDocument();
	expect(screen.queryByText(startedSource.title)).not.toBeInTheDocument();
	expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
	expect(screen.queryByText('In progress')).not.toBeInTheDocument();

	await userEvent.type(
		screen.getByPlaceholderText(ISSUE_SEARCH_PLACEHOLDER),
		'teammate',
	);

	expect(screen.getByText('Teammate onboarding checklist')).toBeInTheDocument();
	expect(screen.getByText(startedSource.title)).toBeInTheDocument();
	expect(screen.getByText('Backlog')).toBeInTheDocument();
	expect(screen.getByText('In progress')).toBeInTheDocument();
});

test('an empty Issues tab still lists matching started issues once searched', async () => {
	pickerHolder.startedSources = [startedSource];
	await openTab('Issues');

	expect(screen.getByText(NOTHING_TO_START)).toBeInTheDocument();

	await userEvent.type(
		screen.getByPlaceholderText(ISSUE_SEARCH_PLACEHOLDER),
		'teammate',
	);

	expect(screen.getByText(startedSource.title)).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
	expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
});

// A search reaches started issues too, so "nothing waiting" would undersell it.
test('a searched Issues tab with no rows reports a search miss', async () => {
	await openTab('Issues');
	await userEvent.type(
		screen.getByPlaceholderText(ISSUE_SEARCH_PLACEHOLDER),
		'nothing',
	);

	expect(screen.getByText(NO_MATCH)).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});

test('choosing a started issue creates a workspace linked to it', async () => {
	pickerHolder.startedSources = [startedSource];
	pickerHolder.itemsById = new Map([
		[startedSource.id, { issue: startedLinearIssue, kind: 'linear-issue' }],
	]);
	const onCreateWorkspace = vi.fn();
	await openTab('Issues', onCreateWorkspace);

	await userEvent.type(
		screen.getByPlaceholderText(ISSUE_SEARCH_PLACEHOLDER),
		'teammate',
	);
	await userEvent.click(screen.getByText(startedSource.title));

	expect(onCreateWorkspace).toHaveBeenCalledWith({
		repoId: project.id,
		seed: {
			linkedIssue: expect.objectContaining({
				id: startedLinearIssue.id,
				identifier: startedLinearIssue.identifier,
				provider: 'linear',
			}),
		},
	});
});

test('reopening the dialog starts from an empty search', async () => {
	const { rerender } = await openTab('Issues');
	await userEvent.type(
		screen.getByPlaceholderText(ISSUE_SEARCH_PLACEHOLDER),
		'teammate',
	);

	const dialogAt = (open: boolean) => (
		<CreateWorkspaceSourceDialog
			onOpenChange={() => {}}
			open={open}
			project={project}
			projects={[project]}
		/>
	);
	rerender(dialogAt(false));
	rerender(dialogAt(true));

	expect(
		screen.getByPlaceholderText('Search by title, number, or author'),
	).toHaveValue('');
});

test('an empty tab whose GitHub read failed names the failure and its fix', async () => {
	pickerHolder.error = {
		code: 'gh-not-authenticated',
		message: 'gh is not authenticated',
		remediation: 'Run gh auth login.',
	};
	await openTab('Pull requests');

	expect(
		screen.getByText(
			'GitHub CLI is not signed in. Run gh auth login, then retry.',
		),
	).toBeInTheDocument();
	expect(screen.getByText('Run gh auth login.')).toBeInTheDocument();
	expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
});

test('an empty Pull requests tab keeps the search-miss message', async () => {
	await openTab('Pull requests');

	expect(screen.getByText(NO_MATCH)).toBeInTheDocument();
	expect(screen.queryByText(NOTHING_TO_START)).not.toBeInTheDocument();
});
