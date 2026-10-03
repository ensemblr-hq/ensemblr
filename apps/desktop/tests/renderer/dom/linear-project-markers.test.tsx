// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { LinearIssueRow } from '@/renderer/components/linear/issue-row';
import { CreateWorkspaceSourceDialog } from '@/renderer/components/workbench-shell/create-workspace-source-dialog';
import { IssueCard } from '@/renderer/components/workbench-shell/dashboard/issue-card';
import type {
	ProjectShellModel,
	WorkspaceSource,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
import type { BoardIssueCard } from '@/renderer/types/workbench-shell';
import { createLinearIssueFixture } from '../../fixtures/linear';
import { renderWithProviders } from '../support/dom';

// Hoisted so the vi.mock factory, lifted above the imports, can close over it.
const pickerHolder = vi.hoisted(() => ({
	sources: [] as WorkspaceSource[],
}));

// The Backlog card links into the Linear viewer; no router is mounted here.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	Link: ({
		children,
		to,
		...props
	}: { children: ReactNode; to: string } & ComponentProps<'a'>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-picker',
	() => ({
		useWorkspaceSourcePicker: () => ({
			error: null,
			isLoading: false,
			itemsById: new Map<string, WorkspaceSourceItem>(),
			linearGap: null,
			sources: pickerHolder.sources,
		}),
	}),
);

const repository = {
	id: 'repo-1',
	name: 'ensemblr',
	owner: { name: 'ensemblr-hq' },
	pathLabel: '~/Ensemblr/repos/ensemblr',
	workspaces: [],
} as unknown as ProjectShellModel;

beforeEach(() => {
	pickerHolder.sources = [];
});

// One Linear team's issues can span several Linear projects, and the picker sits
// beside the repository it creates the workspace in, so a row has to say which
// Linear project it belongs to — and say "Linear" so it is not read as the repo.
describe('create-from picker', () => {
	beforeEach(() => {
		pickerHolder.sources = [
			{
				id: 'linear-1',
				kind: 'issue',
				provider: 'linear',
				reference: 'THE-227',
				title: 'Linux picker crashes',
				trackerProject: 'Skrepka',
			},
			{
				id: 'linear-2',
				kind: 'issue',
				provider: 'linear',
				reference: 'THE-226',
				title: 'Sort the Issues tab',
				trackerProject: 'Ensemblr',
			},
		];
		renderWithProviders(
			<CreateWorkspaceSourceDialog
				onOpenChange={() => {}}
				open
				project={repository}
				projects={[repository]}
			/>,
		);
	});

	test('labels each Linear issue with its project', async () => {
		await userEvent.click(screen.getByRole('radio', { name: 'Issues' }));

		expect(screen.getByText('Linear project: Skrepka')).toBeInTheDocument();
		expect(screen.getByText('Linear project: Ensemblr')).toBeInTheDocument();
	});

	test('narrows to a project when its name is searched', async () => {
		await userEvent.click(screen.getByRole('radio', { name: 'Issues' }));
		await userEvent.type(
			screen.getByPlaceholderText(/Search by issue number/),
			'skrepka',
		);

		expect(screen.getByText('Linux picker crashes')).toBeInTheDocument();
		expect(screen.queryByText('Sort the Issues tab')).not.toBeInTheDocument();
	});
});

describe('Linear browse row', () => {
	/**
	 * Renders one browse-list row inside a list, as the browse list does.
	 * @param showProject - Whether the list reserves the project column
	 * @param projectName - The issue's Linear project, or null for none
	 */
	function renderRow(showProject: boolean, projectName: string | null) {
		renderWithProviders(
			<ul>
				<LinearIssueRow
					issue={createLinearIssueFixture({
						projectId: projectName ? 'project-1' : null,
						projectName,
					})}
					onOpen={() => {}}
					showOrganization={false}
					showProject={showProject}
				/>
			</ul>,
		);
	}

	test('shows the project column when the list carries projects', () => {
		renderRow(true, 'Skrepka');

		expect(screen.getByText('Linear project: Skrepka')).toBeInTheDocument();
	});

	test('leaves the project out when the list hides the column', () => {
		renderRow(false, 'Skrepka');

		expect(
			screen.queryByText('Linear project: Skrepka'),
		).not.toBeInTheDocument();
	});
});

describe('board Backlog card', () => {
	/**
	 * Renders one Backlog card for a Linear issue.
	 * @param trackerProject - The issue's Linear project, or null for none
	 */
	function renderCard(trackerProject: string | null) {
		const issue: BoardIssueCard = {
			item: { issue: {} as never, kind: 'linear-issue' },
			key: 'linear-1',
			labels: [],
			priority: null,
			projectId: null,
			provider: 'linear',
			reference: 'THE-227',
			scopeRepoIds: null,
			stateColor: null,
			stateName: 'Backlog',
			stateType: 'backlog',
			subtitle: 'The Swiss Cheese',
			title: 'Linux picker crashes',
			trackerProject,
			updatedAt: null,
			url: 'https://linear.app/e/issue/THE-227',
		};
		renderWithProviders(
			<IssueCard
				allowReorder={true}
				isDismissed={false}
				issue={issue}
				onAssign={() => undefined}
				onDismiss={() => undefined}
				onRestore={() => undefined}
			/>,
		);
	}

	test('badges the card with its Linear project', () => {
		renderCard('Skrepka');

		expect(screen.getByText('Linear project: Skrepka')).toBeInTheDocument();
	});

	test('draws no project badge for an issue in no project', () => {
		renderCard(null);

		expect(screen.queryByText(/Linear project:/)).not.toBeInTheDocument();
	});
});
