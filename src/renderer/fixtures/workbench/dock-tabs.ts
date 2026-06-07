import { DEFAULT_TERMINAL_DOCK_TAB_ID } from '@/renderer/lib/workbench/constants';
import type {
	DockTabModel,
	DockTabStatus,
	TerminalDockTabModel,
} from '@/renderer/types/workbench';

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
		createDefaultTerminalDockTab(),
	];
}

function createDefaultTerminalDockTab(): TerminalDockTabModel {
	return {
		id: DEFAULT_TERMINAL_DOCK_TAB_ID,
		isDefault: true,
		kind: 'terminal',
		label: 'Terminal',
		lines: [
			'$ zsh',
			'Interactive PTY rendering is intentionally deferred to ENS-037.',
			'This placeholder preserves the default interactive terminal tab contract.',
		],
		sessionId: 'terminal-default',
		status: 'idle',
	};
}
