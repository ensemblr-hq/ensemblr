// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
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
import {
	BOARD_STATUS_LABELS,
	BOARD_STATUS_ORDER,
} from '../../src/renderer/state/workspace';
import type { SetupDiagnosticsContextValue } from '../../src/renderer/types/contexts';
import type { ProjectShellModel } from '../../src/renderer/types/workbench';
import type { WorkbenchLayoutModel } from '../../src/renderer/types/workbench-shell';
import type { SetupDiagnosticsSnapshot } from '../../src/shared/ipc/contracts/setup';
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
	addProjectMenu: { actions: [], recentProjects: [] },
	displayProjects: shellFixtureProjects,
	displaySelection: null,
	health: { detail: 'Ready', label: 'Ready', state: 'online' },
	navigateToStaticRoute: noop,
	navigateToWorkspace: noop,
	onAddProject: noop,
	resolveWorkspaceRouteSearch: () => ({}),
};

const BLOCKED_SNAPSHOT: SetupDiagnosticsSnapshot = {
	blockedCount: 1,
	checks: [],
	generatedAt: '2026-07-18T00:00:00.000Z',
	optionalCount: 0,
	requiredCount: 1,
	status: 'blocked',
	successCount: 0,
	warningCount: 0,
};

/** Renders the dashboard with a collapsed sidebar and the given setup snapshot. */
function renderCollapsedDashboard(options: {
	onOpenChange?: (open: boolean) => void;
	projects?: ProjectShellModel[];
	setupDiagnostics?: SetupDiagnosticsSnapshot;
}) {
	const setupDiagnostics: SetupDiagnosticsContextValue = {
		actions: { onSetupDiagnosticsRetry: noop },
		state: {
			isSetupDiagnosticsRetrying: false,
			setupDiagnostics: options.setupDiagnostics ?? null,
			setupDiagnosticsError: null,
		},
	};

	const routeModel: WorkbenchLayoutModel = {
		...model,
		displayProjects: options.projects ?? model.displayProjects,
	};

	return renderWithProviders(
		<SetupDiagnosticsProvider value={setupDiagnostics}>
			<WorkbenchLayoutModelProvider value={routeModel}>
				<SidebarProvider
					onOpenChange={options.onOpenChange ?? noop}
					open={false}
				>
					<Sidebar collapsible='offcanvas' />
					<DashboardBoard />
				</SidebarProvider>
			</WorkbenchLayoutModelProvider>
		</SetupDiagnosticsProvider>,
	);
}

test('renders the board inside a collapsed sidebar inset with an expand trigger', () => {
	const { container } = renderCollapsedDashboard({});

	expect(container.querySelector('[data-slot="sidebar-inset"]')).not.toBeNull();
	expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();
	expect(container.querySelector('.sidebar-collapsed-trigger')).not.toBeNull();
	expect(screen.getByText('Dashboard')).toBeTruthy();
});

test('clicking the collapsed trigger requests the sidebar to expand', () => {
	const onOpenChange = vi.fn();
	const { container } = renderCollapsedDashboard({ onOpenChange });

	const trigger = container.querySelector('.sidebar-collapsed-trigger');
	expect(trigger).not.toBeNull();
	fireEvent.click(trigger as Element);

	expect(onOpenChange).toHaveBeenCalledWith(true);
});

test('keeps the dashboard board accessible when no workspace exists', () => {
	renderCollapsedDashboard({
		projects: [
			{
				id: 'empty-repo',
				name: 'Empty repo',
				owner: { name: 'alice' },
				pathLabel: '/tmp/empty-repo',
				workspaces: [],
			},
		],
	});

	expect(screen.getByText('Dashboard')).toBeTruthy();
	for (const status of BOARD_STATUS_ORDER) {
		expect(
			screen.getByRole('region', {
				name: `${BOARD_STATUS_LABELS[status]} column, 0 workspaces`,
			}),
		).toBeTruthy();
	}
});

test('keeps an expand trigger on the setup-blocked dashboard placeholder', () => {
	const onOpenChange = vi.fn();
	const { container } = renderCollapsedDashboard({
		onOpenChange,
		setupDiagnostics: BLOCKED_SNAPSHOT,
	});

	const trigger = container.querySelector('.sidebar-collapsed-trigger');
	expect(trigger).not.toBeNull();
	fireEvent.click(trigger as Element);

	expect(onOpenChange).toHaveBeenCalledWith(true);
});
