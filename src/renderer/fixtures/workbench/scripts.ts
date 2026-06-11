import type { WorkspaceShellModel } from '@/renderer/types/workbench';

export const runningDevScripts = {
	run: {
		command: 'bun run dev',
		port: 5173,
		status: 'running',
	},
	setup: {
		command: 'bun install',
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

export const setupPendingScripts = {
	run: {
		command: 'bun run dev',
		status: 'stopped',
	},
	setup: {
		command: 'bun install',
		status: 'not-run',
	},
} satisfies WorkspaceShellModel['scripts'];

export const stoppedRunScripts = {
	run: {
		command: 'bun run dev',
		status: 'stopped',
	},
	setup: {
		command: 'bun install',
		status: 'succeeded',
	},
} satisfies WorkspaceShellModel['scripts'];

export const missingScripts = {
	run: {
		status: 'missing',
	},
	setup: {
		status: 'missing',
	},
} satisfies WorkspaceShellModel['scripts'];
