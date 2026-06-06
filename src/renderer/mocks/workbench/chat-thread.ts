import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

export type WorkbenchMockChatToolIcon =
	| 'check'
	| 'circle-dashed'
	| 'file-code'
	| 'loader'
	| 'search'
	| 'terminal';

export interface WorkbenchMockChatTool {
	detail: string;
	icon: WorkbenchMockChatToolIcon;
	label: string;
	status: 'done' | 'pending' | 'running';
}

export interface WorkbenchMockChatMessage {
	author: string;
	body: string[];
	speaker: 'assistant' | 'user';
	status?: 'blocked' | 'working';
	time: string;
	tools?: WorkbenchMockChatTool[];
}

export function getWorkbenchMockChatThread({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}): WorkbenchMockChatMessage[] {
	return [
		{
			author: 'You',
			body: [
				`Can you update ${workspace.name} so the sidebar feels closer to Conductor?`,
				'Start with the project groups, pinned workspaces, and workspace actions.',
			],
			speaker: 'user',
			time: '14:31',
		},
		{
			author: 'Pi',
			body: [
				`I am working in ${workspace.branchName}. I will keep the sidebar data model local to the shell fixture and preserve the existing project ordering.`,
			],
			speaker: 'assistant',
			time: '14:32',
			tools: [
				{
					detail: 'Read workbench-shell.tsx and sidebar primitives',
					icon: 'search',
					label: 'Inspecting layout',
					status: 'done',
				},
				{
					detail: 'Project collapse, context menus, and pinned rows',
					icon: 'file-code',
					label: 'Editing sidebar',
					status: 'done',
				},
			],
		},
		{
			author: 'You',
			body: [
				'Pin should move a workspace out of Projects, and the row motion should stay calm.',
			],
			speaker: 'user',
			time: '14:38',
		},
		{
			author: 'Pi',
			body: [
				'Pinned workspaces now render above Projects, project counts ignore pinned rows, and pinning briefly disables reorder layout motion while the list reflows.',
			],
			speaker: 'assistant',
			time: '14:39',
			tools: [
				{
					detail: 'bun run check',
					icon: 'terminal',
					label: 'Biome and Tailwind',
					status: 'done',
				},
				{
					detail: 'bun run test:renderer',
					icon: 'check',
					label: 'Renderer tests',
					status: 'done',
				},
				{
					detail: 'bun run typecheck',
					icon: 'check',
					label: 'TypeScript',
					status: 'done',
				},
			],
		},
		{
			author: 'Pi',
			body: [
				`Current thread: ${activeSession.label}. I am mocking this chat pane with agent messages, tool activity, and verification output so the composer has a real conversation target.`,
			],
			speaker: 'assistant',
			status: composer.disabled ? 'blocked' : 'working',
			time: 'now',
			tools: [
				{
					detail: composer.disabled
						? 'Waiting for setup diagnostics to clear'
						: 'Replacing timeline cards with chat transcript',
					icon: composer.disabled ? 'circle-dashed' : 'loader',
					label: composer.disabled
						? 'Composer blocked'
						: 'Chat mock in progress',
					status: composer.disabled ? 'pending' : 'running',
				},
			],
		},
	];
}
