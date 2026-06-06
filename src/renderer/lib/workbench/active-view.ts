import type { WorkbenchActiveView } from '@/renderer/types/workbench-shell';

export function isWorkbenchActiveView(
	view: unknown,
): view is WorkbenchActiveView {
	return (
		view === 'dashboard' ||
		view === 'help' ||
		view === 'history' ||
		view === 'settings' ||
		view === 'workspace'
	);
}
