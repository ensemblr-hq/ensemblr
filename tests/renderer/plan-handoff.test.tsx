// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

const { invalidateQueries, navigate, openChatTab, toastError } = vi.hoisted(
	() => ({
		invalidateQueries: vi.fn().mockResolvedValue(undefined),
		navigate: vi.fn().mockResolvedValue(undefined),
		openChatTab: vi.fn(),
		toastError: vi.fn(),
	}),
);

vi.mock('@tanstack/react-query', async () => {
	const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
		'@tanstack/react-query',
	);
	return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

vi.mock('sonner', () => ({ toast: { error: toastError } }));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	ensemblrQueryKeys: { chatTabs: (id: string) => ['chat-tabs', id] },
	openChatTab,
}));

import { usePlanHandoff } from '../../src/renderer/hooks/workbench-shell/conversation-panel/use-plan-handoff';
import {
	composerValueAtomFamily,
	useComposerAttachmentInbox,
} from '../../src/renderer/state/composer';

const PLAN_PATH = '.context/plans/20260728-1432-add-plan-mode.md';
const NEW_TAB_ID = 'tab-new';

const workspace = {
	id: 'ws-1',
	name: 'raleigh',
	projectId: 'repo-1',
} as unknown as WorkspaceShellModel;

const renderHandoff = () => {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const { result } = renderHook(
		() => ({
			handoff: usePlanHandoff(workspace),
			inbox: useComposerAttachmentInbox(NEW_TAB_ID),
		}),
		{ wrapper },
	);
	return { result, store };
};

beforeEach(() => {
	vi.clearAllMocks();
	openChatTab.mockResolvedValue({ tab: { id: NEW_TAB_ID } });
});

describe('usePlanHandoff', () => {
	it('opens a chat tab named after the plan', async () => {
		const { result } = renderHandoff();

		await act(async () => {
			await result.current.handoff.handOff({
				planPath: PLAN_PATH,
				title: 'Add Plan Mode',
			});
		});

		expect(openChatTab).toHaveBeenCalledWith({
			title: 'Implement: Add Plan Mode',
			workspaceId: 'ws-1',
		});
	});

	it('seeds the new tab with a draft and the plan as a file chip, unsent', async () => {
		const { result, store } = renderHandoff();

		await act(async () => {
			await result.current.handoff.handOff({
				planPath: PLAN_PATH,
				title: 'Add Plan Mode',
			});
		});

		expect(store.get(composerValueAtomFamily(NEW_TAB_ID))).toBe(
			'Implement the attached plan.',
		);
		expect(result.current.inbox.pending).toEqual([
			{
				id: `wsfile:${PLAN_PATH}`,
				kind: 'file',
				name: '20260728-1432-add-plan-mode.md',
				path: PLAN_PATH,
			},
		]);
	});

	it('navigates to the new chat and returns its id', async () => {
		const { result } = renderHandoff();

		let handoffTabId: string | null = null;
		await act(async () => {
			handoffTabId = await result.current.handoff.handOff({
				planPath: PLAN_PATH,
				title: 'Add Plan Mode',
			});
		});

		expect(handoffTabId).toBe(NEW_TAB_ID);
		expect(navigate).toHaveBeenCalledWith({
			params: {
				chatId: NEW_TAB_ID,
				projectId: 'repo-1',
				workspaceId: 'ws-1',
			},
			to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['chat-tabs', 'ws-1'],
		});
	});

	it('still seeds the draft when the plan file could not be saved', async () => {
		const { result, store } = renderHandoff();

		await act(async () => {
			await result.current.handoff.handOff({
				planPath: null,
				title: 'Add Plan Mode',
			});
		});

		expect(store.get(composerValueAtomFamily(NEW_TAB_ID))).toBe(
			'Implement the attached plan.',
		);
		expect(result.current.inbox.pending).toEqual([]);
	});

	it('reports a failure to open the tab instead of throwing', async () => {
		openChatTab.mockRejectedValue(new Error('tab limit reached'));
		const { result } = renderHandoff();

		let handoffTabId: string | null = 'unset';
		await act(async () => {
			handoffTabId = await result.current.handoff.handOff({
				planPath: PLAN_PATH,
				title: 'Add Plan Mode',
			});
		});

		expect(handoffTabId).toBeNull();
		expect(toastError).toHaveBeenCalledWith('tab limit reached');
		expect(navigate).not.toHaveBeenCalled();
	});
});
