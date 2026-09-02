// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, test } from 'vitest';

import { SidebarProvider } from '../../src/renderer/components/ui/sidebar';
import { NavigationProvider } from '../../src/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceSidebarItem } from '../../src/renderer/components/workbench-shell/workspace-sidebar-item/workspace-sidebar-item';
import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench';
import { archivingWorkspaceIdsAtom } from '../../src/renderer/state/workspace/workspace-archiving';
import type { WorkbenchRouteSearch } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const workspace = {
	...shellFixtureProjects[0].workspaces[0],
	name: 'Doomed',
};

const store = getDefaultStore();

/** Renders the sidebar row for the fixture workspace, archive action wired. */
function renderRow() {
	return renderWithProviders(
		<SidebarProvider>
			<NavigationProvider
				value={{ renderStaticLink: undefined, renderWorkspaceLink: undefined }}
			>
				<WorkspaceSidebarItem
					isActive={false}
					isPinned={false}
					onArchiveSelect={() => undefined}
					onDeleteSelect={() => undefined}
					onPinToggle={() => undefined}
					onRenameSelect={() => undefined}
					onSelect={() => undefined}
					routeSearch={{} as WorkbenchRouteSearch}
					workspace={workspace}
				/>
			</NavigationProvider>
		</SidebarProvider>,
	);
}

/** Marks the fixture workspace as having an archive in flight. */
function markArchiving(): void {
	store.set(archivingWorkspaceIdsAtom, new Set([workspace.id]));
}

afterEach(() => {
	store.set(archivingWorkspaceIdsAtom, new Set<string>());
});

describe('workspace sidebar row while archiving', () => {
	test('an idle row offers the archive button and shows its branch', () => {
		renderRow();

		expect(
			screen.getByRole('button', { name: /Archive workspace Doomed/ }),
		).toBeInTheDocument();
		expect(screen.getByText(workspace.branchName)).toBeInTheDocument();
		expect(screen.queryByText('Archiving…')).toBeNull();
	});

	test('an archiving row says so instead of naming its branch', () => {
		markArchiving();
		renderRow();

		expect(screen.getByText('Archiving…')).toBeInTheDocument();
		expect(screen.queryByText(workspace.branchName)).toBeNull();
	});

	// The row going non-interactive is the whole fix: the quick button was the
	// only way to fire a second archive at a workspace already being torn down.
	test('an archiving row is disabled and offers no archive button', () => {
		markArchiving();
		renderRow();

		const row = screen.getByRole('button', {
			name: 'Workspace Doomed is being archived',
		});
		expect(row).toBeDisabled();
		expect(
			screen.queryByRole('button', { name: /Archive workspace Doomed/ }),
		).toBeNull();
	});
});
