import type { WorkbenchActiveView } from '@/renderer/types/workbench-shell';

/**
 * Type guard for the workbench's active-view enum.
 * @param view - Candidate value.
 * @returns True when the value is a recognised workbench view name.
 */
export function isWorkbenchActiveView(
	view: unknown,
): view is WorkbenchActiveView {
	return (
		view === 'dashboard' ||
		view === 'help' ||
		view === 'history' ||
		view === 'linear' ||
		view === 'settings' ||
		view === 'welcome' ||
		view === 'workspace'
	);
}
