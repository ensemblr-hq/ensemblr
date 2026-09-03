// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ProjectContextMenuContent } from '@/renderer/components/workbench-shell/project-sidebar/project-context-menu';
import type { ProjectShellModel } from '@/renderer/types/workbench';

import { renderWithProviders } from '../support/dom';

const PROJECT: ProjectShellModel = {
	id: 'project-1',
	name: 'ensemblr',
	owner: { name: 'ensemblr-hq' },
	pathLabel: '~/repos/ensemblr',
	workspaces: [],
};

/** Opens the repository context menu with the handlers a test wants to observe. */
function openMenu(
	props: Partial<Parameters<typeof ProjectContextMenuContent>[0]> = {},
) {
	renderWithProviders(
		<ContextMenu>
			<ContextMenuTrigger>repository row</ContextMenuTrigger>
			<ProjectContextMenuContent
				onRepositorySettingsSelect={vi.fn()}
				project={PROJECT}
				{...props}
			/>
		</ContextMenu>,
	);
	fireEvent.contextMenu(screen.getByText('repository row'));
}

describe('repository context menu', () => {
	test('New workspace calls the create handler the sidebar already holds', () => {
		const onCreateWorkspaceSelect = vi.fn();
		openMenu({ onCreateWorkspaceSelect });

		fireEvent.click(screen.getByText('New workspace'));

		expect(onCreateWorkspaceSelect).toHaveBeenCalledTimes(1);
	});

	test('New workspace is disabled while a workspace is already being created', () => {
		const onCreateWorkspaceSelect = vi.fn();
		openMenu({ isCreatingWorkspace: true, onCreateWorkspaceSelect });

		const item = screen
			.getByText('New workspace')
			.closest('[data-slot="context-menu-item"]');

		expect(item).toHaveAttribute('data-disabled');

		fireEvent.click(item as Element);

		expect(onCreateWorkspaceSelect).not.toHaveBeenCalled();
	});

	test('New workspace is disabled when no create handler is wired', () => {
		openMenu();

		const item = screen
			.getByText('New workspace')
			.closest('[data-slot="context-menu-item"]');

		expect(item).toHaveAttribute('data-disabled');
	});
});
