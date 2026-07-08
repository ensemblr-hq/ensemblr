import type { DockTabModel, DockTabStatus } from '@/renderer/types/workbench';

export function createDockTabs({
	runStatus,
	setupStatus,
}: {
	runStatus: DockTabStatus;
	setupStatus: DockTabStatus;
}): DockTabModel[] {
	return [
		{
			id: 'setup',
			kind: 'setup-script',
			label: 'Setup',
			status: setupStatus,
		},
		{
			id: 'run',
			kind: 'run-script',
			label: 'Run',
			status: runStatus,
		},
	];
}
