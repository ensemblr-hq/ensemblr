// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { BoardWorkspaceMenuProvider } from '@/renderer/components/workbench-shell/dashboard/board-workspace-menu';
import { WorkspaceCard } from '@/renderer/components/workbench-shell/dashboard/workspace-card';
import { shellFixtureProjects } from '@/renderer/fixtures/workbench';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { renderWithProviders } from './support/dom';

const readyWorkspace = shellFixtureProjects
	.flatMap((project) => project.workspaces)
	.find((workspace) => workspace.pullRequest.status === 'ready-to-merge');

if (!readyWorkspace) {
	throw new Error('expected a ready-to-merge workspace fixture');
}

/** Renders the board card for a workspace. */
function renderCard(workspace: WorkspaceShellModel) {
	return renderWithProviders(
		<BoardWorkspaceMenuProvider
			controller={{
				archive: vi.fn(),
				openDelete: vi.fn(),
				openRename: vi.fn(),
			}}
		>
			<WorkspaceCard
				allowReorder={true}
				onOpen={vi.fn()}
				projectName='Ensemblr'
				workspace={workspace}
			/>
		</BoardWorkspaceMenuProvider>,
	);
}

/** The same workspace with its git-status row reporting unsent local work. */
function withGitStatusKind(
	workspace: WorkspaceShellModel,
	kind: 'unpublished' | 'unpushed',
): WorkspaceShellModel {
	return {
		...workspace,
		pullRequest: {
			...workspace.pullRequest,
			gitStatus: { ...workspace.pullRequest.gitStatus, kind },
		},
	};
}

describe('board card pull-request badge', () => {
	test('a pushed ready PR reads as ready to merge', () => {
		renderCard(readyWorkspace);

		expect(
			screen.getByLabelText(
				`Pull request #${readyWorkspace.pullRequest.number} ready to merge`,
			),
		).toBeInTheDocument();
	});

	// The badge is the only place the state is named: its icon carries no label,
	// so a screen reader reads this phrase or nothing.
	test.each(['unpublished', 'unpushed'] as const)(
		'a ready PR on a %s branch reads as changes not pushed',
		(kind) => {
			renderCard(withGitStatusKind(readyWorkspace, kind));

			expect(
				screen.getByLabelText(
					`Pull request #${readyWorkspace.pullRequest.number} changes not pushed`,
				),
			).toBeInTheDocument();
		},
	);

	// `changeSummary` on a board card is a `baseRef..HEAD` diff, so a file count
	// says nothing about whether the branch was pushed.
	test('a large branch diff does not make a pushed PR read as unpushed', () => {
		renderCard({
			...readyWorkspace,
			changeSummary: { additions: 628, deletions: 31, files: 21 },
		});

		expect(
			screen.getByLabelText(
				`Pull request #${readyWorkspace.pullRequest.number} ready to merge`,
			),
		).toBeInTheDocument();
	});
});
