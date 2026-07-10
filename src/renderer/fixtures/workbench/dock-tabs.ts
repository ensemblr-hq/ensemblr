import type { DockTabModel, DockTabStatus } from '@/renderer/types/workbench';

/**
 * Builds the Setup and Run dock tab fixtures from their current statuses.
 * @param statuses - Current run-script and setup-script status values
 * @returns The ordered Setup and Run dock tab models
 */
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
