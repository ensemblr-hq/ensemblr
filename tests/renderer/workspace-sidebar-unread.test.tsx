// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { WorkspaceSidebarItemContent } from '../../src/renderer/components/workbench-shell/workspace-sidebar-item/item-content';
import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench';
import { getWorkspaceSidebarState } from '../../src/renderer/lib/workbench';
import { renderWithProviders } from './support/dom';

const workspace = {
	...shellFixtureProjects[0].workspaces[0],
	name: 'Unread mechanism',
};

/** Renders one sidebar row at a given unread count. */
function renderRow(unreadCount: number) {
	return renderWithProviders(
		<WorkspaceSidebarItemContent
			dockActivityState={null}
			hasDiffStats={false}
			isPendingCreation={false}
			isUnread={unreadCount > 0}
			sidebarState={getWorkspaceSidebarState(workspace, { agentBusy: false })}
			unreadCount={unreadCount}
			workspace={workspace}
		/>,
	);
}

describe('workspace sidebar unread marker', () => {
	test('renders no dot when the workspace has nothing unread', () => {
		const { container } = renderRow(0);
		expect(container.querySelector('[data-workspace-unread-count]')).toBeNull();
	});

	test('renders the dot carrying its count when chats are unread', () => {
		const { container } = renderRow(3);
		const dot = container.querySelector('[data-workspace-unread-count]');
		expect(dot?.getAttribute('data-workspace-unread-count')).toBe('3');
		expect(dot?.className).toContain('bg-primary');
	});

	test('names the count for screen readers, pluralized', () => {
		renderRow(1);
		expect(screen.getByText('1 unread chat')).toBeInTheDocument();
	});

	test('bolds the workspace name while it is unread', () => {
		renderRow(2);
		expect(screen.getByText('Unread mechanism').className).toContain(
			'font-semibold',
		);
	});
});
