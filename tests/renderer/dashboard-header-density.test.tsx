// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import {
	Sidebar,
	SidebarProvider,
} from '../../src/renderer/components/ui/sidebar';
import { DashboardBoard } from '../../src/renderer/components/workbench-shell/dashboard/dashboard-board';
import {
	SetupDiagnosticsProvider,
	WorkbenchLayoutModelProvider,
} from '../../src/renderer/components/workbench-shell/shell-contexts';
import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench/projects';
import type { SetupDiagnosticsContextValue } from '../../src/renderer/types/contexts';
import type { WorkbenchLayoutModel } from '../../src/renderer/types/workbench-shell';
import { renderWithProviders } from './support/dom';

vi.mock('@tanstack/react-router', async () => {
	const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
		'@tanstack/react-router',
	);

	return {
		...actual,
		useRouter: () => ({}),
	};
});

const noop = () => undefined;

const model: WorkbenchLayoutModel = {
	activeProject: null,
	activeWorkspace: null,
	addProjectMenu: { actions: [], recents: [] },
	displayProjects: shellFixtureProjects,
	displaySelection: null,
	health: { detail: 'Ready', label: 'Ready', state: 'online' },
	navigateToStaticRoute: noop,
	navigateToWorkspace: noop,
	onAddProject: noop,
	resolveWorkspaceRouteSearch: () => ({}),
};

const setupDiagnostics: SetupDiagnosticsContextValue = {
	actions: { onSetupDiagnosticsRetry: noop },
	state: {
		isSetupDiagnosticsRetrying: false,
		setupDiagnostics: null,
		setupDiagnosticsError: null,
	},
};

/** Renders the dashboard header with its board, sidebar expanded. */
function renderDashboard() {
	return renderWithProviders(
		<SetupDiagnosticsProvider value={setupDiagnostics}>
			<WorkbenchLayoutModelProvider value={model}>
				<SidebarProvider onOpenChange={noop} open={true}>
					<Sidebar collapsible='offcanvas' />
					<DashboardBoard />
				</SidebarProvider>
			</WorkbenchLayoutModelProvider>
		</SetupDiagnosticsProvider>,
	);
}

test('measures a container inside the header rather than the drag region itself', () => {
	const { container } = renderDashboard();

	const header = container.querySelector('header.native-toolbar');
	expect(header?.className).not.toContain('@container');
	expect(
		header?.querySelector('.\\@container\\/dashboard-header'),
	).not.toBeNull();
});

test('drops the dashboard title before any toolbar control collapses', () => {
	renderDashboard();

	expect(screen.getByText('Dashboard').className).toContain(
		'@max-3xl/dashboard-header:hidden',
	);
});

test('collapses the facet labels one step after the title', () => {
	renderDashboard();

	for (const name of ['Repositories', 'Sources']) {
		const label = screen.getByText(name);
		expect(label.className).toContain('@max-2xl/dashboard-header:hidden');
		expect(screen.getByRole('button', { name })).toBeTruthy();
	}
});

test('names every collapsing control so an icon-only toolbar stays readable', () => {
	renderDashboard();

	expect(
		screen.getByRole('button', { name: 'Repositories' }).getAttribute('title'),
	).toBe('Repositories');
	expect(
		screen.getByRole('combobox', { name: 'Sort cards' }).getAttribute('title'),
	).toBe('Manual order');
});

test('squeezes the sort value rather than removing it from layout', () => {
	const { container } = renderDashboard();

	const collapser = container.querySelector(
		'[data-slot="select-value"]',
	)?.parentElement;
	expect(collapser?.className).toContain('@max-2xl/dashboard-header:w-0');
	expect(collapser?.className).toContain(
		'@max-2xl/dashboard-header:overflow-hidden',
	);
	expect(collapser?.className).not.toContain(
		'@max-2xl/dashboard-header:hidden',
	);
});

test('lets the filter field give up width before the toolbar overflows', () => {
	renderDashboard();

	const field = screen.getByRole('textbox', { name: 'Filter board cards' });
	expect(field.className).not.toContain('w-44');
	expect(field.parentElement?.className).toContain('w-44');
	expect(field.parentElement?.className).toContain('min-w-24');
});
