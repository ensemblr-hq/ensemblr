// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type {
	ProjectShellModel,
	SessionTabModel,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import { installLocalStorage } from './support/dom';

const { useQuery, writeWorkspaceActionPrompt } = vi.hoisted(() => ({
	useQuery: vi.fn(() => ({ data: undefined })),
	writeWorkspaceActionPrompt: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery }));

vi.mock('@/renderer/api/ensemblr', () => ({
	settingsResolutionQuery: () => ({ queryKey: ['settings-resolution'] }),
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	writeWorkspaceActionPrompt,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useAgentActionRunner } from '../../src/renderer/hooks/workbench-shell/review-actions/use-agent-action-runner';

const project: ProjectShellModel = {
	id: 'repo-1',
	name: 'Ensemblr',
	owner: { name: 'alice' },
	pathLabel: '/Users/alice/Ensemblr/repos/ensemblr',
	workspaces: [],
};

const session = {
	chatTabId: 'chat-1',
	kind: 'chat',
} as unknown as SessionTabModel;

/** Workspace fixture carrying the pull-request slice the runner reroutes on. */
function makeWorkspace(
	pullRequest: Record<string, unknown>,
): WorkspaceShellModel {
	return {
		branchName: 'feature/widget',
		changeSummary: { files: 1 },
		id: 'workspace-1',
		landingSummary: { branchSource: { baseBranch: 'main' } },
		pathLabel: '/Users/alice/Ensemblr/workspaces/ensemblr/widget',
		pullRequest: { checks: [], description: [], title: '', ...pullRequest },
		reviewFiles: [],
	} as unknown as WorkspaceShellModel;
}

/** Runs the hook against a workspace and fires the given action once. */
async function runAction(
	workspace: WorkspaceShellModel,
): Promise<{ action: string; content: string }> {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const view = renderHook(
		() =>
			useAgentActionRunner({
				activeProject: project,
				activeSession: session,
				activeWorkspace: workspace,
				openSessionTab: () => Promise.resolve({ chatTabId: 'chat-1' }),
				selectChat: () => undefined,
				sessionTabs: [session],
			}),
		{ wrapper },
	);
	await act(async () => {
		view.result.current('create-pr');
		await Promise.resolve();
	});
	return writeWorkspaceActionPrompt.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
	installLocalStorage();
	vi.clearAllMocks();
	useQuery.mockReturnValue({ data: undefined });
	writeWorkspaceActionPrompt.mockResolvedValue({
		file: { path: '.context/attachments/prompt.md' },
	});
});

test('reroutes a create-pr trigger to the update prompt when a PR is open', async () => {
	const written = await runAction(
		makeWorkspace({ number: 390, state: 'open', title: 'Add widget' }),
	);
	expect(written.action).toBe('update-pr');
	expect(written.content).toContain('never run `gh pr create`');
	expect(written.content).toContain('gh pr edit 390 --title');
});

test('keeps a create-pr trigger creating when the branch has no PR', async () => {
	const written = await runAction(makeWorkspace({ number: undefined }));
	expect(written.action).toBe('create-pr');
	expect(written.content).toContain('gh pr create --base main');
});

test('keeps a create-pr trigger creating once the PR is merged', async () => {
	const written = await runAction(
		makeWorkspace({ number: 390, state: 'merged', title: 'Add widget' }),
	);
	expect(written.action).toBe('create-pr');
	expect(written.content).toContain('gh pr create --base main');
});
