import { WorkbenchEmptyStateContent } from '@/renderer/components/workbench-empty-state';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import type { WorkbenchActiveView } from '@/renderer/types/workbench-shell';

/** Placeholder content for dashboard/history/help/settings views. */
export function WorkbenchPlaceholderPage({
	view,
}: {
	view: Exclude<WorkbenchActiveView, 'welcome' | 'workspace'>;
}) {
	const { state: setupDiagnosticsState } = useSetupDiagnostics();

	return (
		<WorkbenchEmptyStateContent
			emptyState={getWorkbenchPlaceholderCopy({
				setupStatus: setupDiagnosticsState.setupDiagnostics?.status,
				view,
			})}
		/>
	);
}

/** Picks placeholder title + detail copy for non-workspace workbench views. */
function getWorkbenchPlaceholderCopy({
	setupStatus,
	view,
}: {
	setupStatus?: string;
	view: Exclude<WorkbenchActiveView, 'welcome' | 'workspace'>;
}) {
	if (setupStatus === 'blocked') {
		return {
			detail: 'Complete setup checks before creating or opening workspaces.',
			title: 'Setup required',
		};
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
		case 'linear':
			return {
				detail: 'Linear issues are available from the Linear route.',
				title: 'Linear',
			};
		default: {
			const exhaustive: never = view;
			return exhaustive;
		}
	}
}
