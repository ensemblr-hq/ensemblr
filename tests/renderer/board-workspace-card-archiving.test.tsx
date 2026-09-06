// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { BoardWorkspaceMenuProvider } from '@/renderer/components/workbench-shell/dashboard/board-workspace-menu';
import { WorkspaceCard } from '@/renderer/components/workbench-shell/dashboard/workspace-card';
import { shellFixtureProjects } from '@/renderer/fixtures/workbench';
import { workspaceLifecycleRunsAtom } from '@/renderer/state/workspace/workspace-lifecycle-runs';
import type { WorkspaceLifecycleRun } from '@/renderer/types/components';

import { renderWithProviders } from './support/dom';

const workspace = { ...shellFixtureProjects[0].workspaces[0], name: 'Doomed' };
const { additions, deletions } = workspace.changeSummary;
const store = getDefaultStore();

const menuController = {
	archive: vi.fn(),
	openDelete: vi.fn(),
	openRename: vi.fn(),
};

/** Renders the board card for the fixture workspace. */
function renderCard(onOpen = vi.fn()) {
	return renderWithProviders(
		<BoardWorkspaceMenuProvider controller={menuController}>
			<WorkspaceCard
				allowReorder={true}
				onOpen={onOpen}
				projectName='Ensemblr'
				workspace={workspace}
			/>
		</BoardWorkspaceMenuProvider>,
	);
}

/** Marks the fixture workspace as having a teardown of the given kind in flight. */
function markLifecycleRun(run: WorkspaceLifecycleRun): void {
	store.set(workspaceLifecycleRunsAtom, new Map([[workspace.id, run]]));
}

afterEach(() => {
	store.set(workspaceLifecycleRunsAtom, new Map());
	vi.clearAllMocks();
});

describe('board workspace card while archiving or deleting', () => {
	test('an idle card opens on click and carries its grab cursor', async () => {
		const onOpen = vi.fn();
		renderCard(onOpen);

		const card = screen.getByRole('button', {
			name: 'Open workspace Doomed',
		});
		await userEvent.click(card);

		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(card.closest('div.cursor-grab')).not.toBeNull();
	});

	// The workspace is leaving the board, so a status it is dragged into lands on
	// nothing and the menu's lifecycle actions would fire a second run at it.
	test('an archiving card is disabled, undraggable and outside the menu', async () => {
		markLifecycleRun('archiving');
		const onOpen = vi.fn();
		const { container } = renderCard(onOpen);

		const card = screen.getByRole('button', {
			name: 'Workspace Doomed is being archived',
		});
		expect(card).toBeDisabled();
		expect(card.closest('div.cursor-grab')).toBeNull();
		expect(container.querySelector('[draggable="true"]')).toBeNull();

		await userEvent.pointer({ keys: '[MouseRight]', target: card });
		expect(screen.queryByRole('menu')).toBeNull();
		expect(menuController.archive).not.toHaveBeenCalled();
	});

	// Guards the hiding cases below from going vacuous: they only mean anything
	// while the fixture still carries counts an idle card renders.
	test('an idle card shows the diff stats it has', () => {
		renderCard();

		expect(screen.getByText(`+${additions}`)).toBeInTheDocument();
		expect(screen.getByText(`-${deletions}`)).toBeInTheDocument();
	});

	// The counts describe a worktree the run is removing, and the sidebar row for
	// the same workspace drops them too.
	test.each(['archiving', 'deleting'] as const)(
		'a card hides its diff stats while %s',
		(run) => {
			markLifecycleRun(run);
			renderCard();

			expect(screen.queryByText(`+${additions}`)).toBeNull();
			expect(screen.queryByText(`-${deletions}`)).toBeNull();
		},
	);
});
