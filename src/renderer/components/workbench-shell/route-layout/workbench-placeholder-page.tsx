import { WorkbenchEmptyStateContent } from '@/renderer/components/workbench-empty-state';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/contexts';
import { getEmptyStateCopy } from '@/renderer/lib/workbench';
import type { WorkbenchActiveView } from '@/renderer/types/workbench-shell';

import { useWorkbenchLayoutRouteModel } from './layout-model-context';

/** Placeholder content for dashboard/history/help/settings views. */
export function WorkbenchPlaceholderPage({
	view,
}: {
	view: Exclude<WorkbenchActiveView, 'welcome' | 'workspace'>;
}) {
	const model = useWorkbenchLayoutRouteModel();
	const { state: setupDiagnosticsState } = useSetupDiagnostics();

	return (
		<WorkbenchEmptyStateContent
			emptyState={getWorkbenchPlaceholderCopy({
				projectCount: model.displayProjects.length,
				setupStatus: setupDiagnosticsState.setupDiagnostics?.status,
				view,
			})}
		/>
	);
}

/** Picks placeholder title + detail copy for non-workspace workbench views. */
function getWorkbenchPlaceholderCopy({
	projectCount,
	setupStatus,
	view,
}: {
	projectCount: number;
	setupStatus?: string;
	view: Exclude<WorkbenchActiveView, 'welcome' | 'workspace'>;
}) {
	if (setupStatus !== 'ready') {
		return getEmptyStateCopy({
			isLoading: false,
			navigationError: null,
			projectCount,
			setupStatus,
		});
	}

	switch (view) {
		case 'history':
			return {
				detail: 'Session history is not connected yet.',
				title: 'History',
			};
		case 'help':
			return {
				detail: 'Help content is not connected yet.',
				title: 'Help',
			};
		case 'settings':
			return {
				detail: 'Settings are available from the settings route.',
				title: 'Settings',
			};
		case 'dashboard':
			return {
				detail: 'Kanban board is not connected yet.',
				title: 'Dashboard',
			};
		default: {
			const exhaustive: never = view;
			return exhaustive;
		}
	}
}
