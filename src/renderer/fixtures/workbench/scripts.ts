import type { WorkspaceShellModel } from '@/renderer/types/workbench';

export const runningDevScripts = {
	run: {
		command: 'bun run dev',
		lines: [
			'$ bun run dev',
			'VITE v5.4.21 ready in 418 ms',
			'Local: http://localhost:5173/',
			'Press h + enter to show help',
		],
		port: 5173,
		status: 'running',
	},
	setup: {
		command: 'bun install',
		lines: [
			'$ bun install',
			'Resolved, downloaded and extracted [9]',
			'Saved lockfile',
			'Done in 1.2s',
		],
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

export const setupPendingScripts = {
	run: {
		command: 'bun run dev',
		lines: [],
		status: 'stopped',
	},
	setup: {
		command: 'bun install',
		lines: [],
		status: 'not-run',
	},
} satisfies WorkspaceShellModel['scripts'];

export const stoppedRunScripts = {
	run: {
		command: 'bun run dev',
		lines: ['$ bun run dev', 'Run script has not started for this workspace.'],
		status: 'stopped',
	},
	setup: {
		command: 'bun install',
		lines: ['$ bun install', 'Dependencies are already up to date.'],
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

export const missingScripts = {
	run: {
		lines: [],
		status: 'missing',
	},
	setup: {
		lines: [],
		status: 'missing',
	},
} satisfies WorkspaceShellModel['scripts'];
