// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { BoardWorkspaceMenuProvider } from '@/renderer/components/workbench-shell/dashboard/board-workspace-menu';
import { WorkspaceCard } from '@/renderer/components/workbench-shell/dashboard/workspace-card';
import { shellFixtureProjects } from '@/renderer/fixtures/workbench';
import { workspaceLifecycleRunsAtom } from '@/renderer/state/workspace/workspace-lifecycle-runs';

import { renderWithProviders } from './support/dom';

const workspace = { ...shellFixtureProjects[0].workspaces[0], name: 'Doomed' };
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

/** Marks the fixture workspace as having an archive in flight. */
function markArchiving(): void {
	store.set(
		workspaceLifecycleRunsAtom,
		new Map([[workspace.id, 'archiving' as const]]),
	);
}

afterEach(() => {
	store.set(workspaceLifecycleRunsAtom, new Map());
	vi.clearAllMocks();
});

describe('board workspace card while archiving', () => {
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
		markArchiving();
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
});
