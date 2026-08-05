import type { WorkspaceShellModel } from '@/renderer/types/workbench';

export const runningDevScripts = {
	runTargets: [
		{
			command: 'bun run dev',
			id: 'default',
			name: '',
			port: 5173,
			previewUrl: 'http://localhost:5173',
			sessionStatus: 'running',
			status: 'running',
			terminalId: 'run-session-1',
		},
	],
	setup: {
		command: 'bun install',
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

export const setupPendingScripts = {
	runTargets: [
		{ command: 'bun run dev', id: 'default', name: '', status: 'stopped' },
	],
	setup: {
		command: 'bun install',
		status: 'not-run',
	},
} satisfies WorkspaceShellModel['scripts'];

export const stoppedRunScripts = {
	runTargets: [
		{ command: 'bun run dev', id: 'default', name: '', status: 'stopped' },
	],
	setup: {
		command: 'bun install',
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

export const missingScripts = {
	// A workspace with no configured run target still gets one placeholder tab
	// (see MISSING_RUN_TARGET_ID in lib/terminal/script-summaries.ts) so the
	// "No run script configured" empty state stays discoverable.
	runTargets: [{ id: 'default', name: '', status: 'missing' }],
	setup: {
		status: 'missing',
	},
} satisfies WorkspaceShellModel['scripts'];
