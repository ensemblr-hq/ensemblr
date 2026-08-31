// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { useChatPromptHandoff } from '../../src/renderer/hooks/workbench-shell/review-actions/use-chat-prompt-handoff';
import { resolveTargetChatTabId } from '../../src/renderer/lib/workbench/chat-tab-target';
import { useComposerSubmitConsumer } from '../../src/renderer/state/composer';
import { sessionVisitOrderByWorkspaceAtom } from '../../src/renderer/state/workspace';
import type {
	QueuedFollowUpSource,
	SessionTabModel,
} from '../../src/renderer/types/workbench';

const WORKSPACE_ID = 'workspace-handoff';

/** Identity fields every strip tab carries, whatever its kind. */
function tabBase(id: string) {
	return {
		agentSessionId: null,
		chatTabId: id,
		fullLabel: id,
		id,
		isPreview: false,
		isSubAgent: false,
		label: id,
		status: 'idle' as const,
		summary: '',
		updatedLabel: '',
	};
}

const CHAT_A: SessionTabModel = { ...tabBase('chat-a'), kind: 'chat' };
const CHAT_B: SessionTabModel = { ...tabBase('chat-b'), kind: 'chat' };
const DIFF_TAB: SessionTabModel = {
	...tabBase('diff-1'),
	filePath: 'src/app.ts',
	kind: 'diff',
	turnId: null,
};
const FILE_TAB: SessionTabModel = {
	...tabBase('file-1'),
	filePath: 'src/app.ts',
	kind: 'file',
};
/**
 * What the shell stands in front of a workspace whose tab rows have not landed:
 * no `kind`, so it reads as a chat, and an id no chat-tab row backs.
 */
const PLACEHOLDER_TAB: SessionTabModel = tabBase(`${WORKSPACE_ID}:overview`);

describe('resolveTargetChatTabId', () => {
	test('targets the tab in front when it is a chat', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: CHAT_A,
				sessionTabs: [CHAT_A, CHAT_B, DIFF_TAB],
				visitOrder: ['chat-b', 'chat-a'],
			}),
		).toBe('chat-a');
	});

	test('falls back to the chat visited most recently behind a diff tab', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: DIFF_TAB,
				sessionTabs: [CHAT_A, CHAT_B, DIFF_TAB],
				visitOrder: ['diff-1', 'chat-a', 'chat-b'],
			}),
		).toBe('chat-a');
	});

	test('skips visited tabs the workspace no longer has open', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: FILE_TAB,
				sessionTabs: [CHAT_B, FILE_TAB],
				visitOrder: ['file-1', 'chat-closed', 'chat-b'],
			}),
		).toBe('chat-b');
	});

	test('falls back to the last chat in the strip with no visit history', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: FILE_TAB,
				sessionTabs: [CHAT_A, CHAT_B, FILE_TAB],
			}),
		).toBe('chat-b');
	});

	test('reports no target when the strip holds no chat tab', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: DIFF_TAB,
				sessionTabs: [DIFF_TAB, FILE_TAB],
				visitOrder: ['diff-1'],
			}),
		).toBeNull();
	});

	// The placeholder carries no `kind`, so it reads as a chat, but no row backs
	// it: `onSubmit` refuses every send against it, so a chore routed there is
	// dropped by the composer that drained it.
	test('never targets the placeholder standing in for an unloaded strip', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: PLACEHOLDER_TAB,
				sessionTabs: [],
				visitOrder: ['chat-a'],
			}),
		).toBeNull();
	});

	test('prefers a real chat over the placeholder in front of it', () => {
		expect(
			resolveTargetChatTabId({
				activeSession: PLACEHOLDER_TAB,
				sessionTabs: [CHAT_A, CHAT_B],
				visitOrder: [`${WORKSPACE_ID}:overview`, 'chat-a'],
			}),
		).toBe('chat-a');
	});
});

type ChannelSubmit = (text: string, source: QueuedFollowUpSource) => boolean;

/** Renders the handoff over a store seeded with a visit order, plus one consumer. */
function renderHandoff({
	activeSession,
	sessionTabs,
	visitOrder,
}: {
	activeSession: SessionTabModel;
	sessionTabs: readonly SessionTabModel[];
	visitOrder: string[];
}) {
	const store = createStore();
	store.set(sessionVisitOrderByWorkspaceAtom, { [WORKSPACE_ID]: visitOrder });
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);
	const selectChat = vi.fn();
	const handoff = renderHook(
		() =>
			useChatPromptHandoff({
				activeSession,
				selectChat,
				sessionTabs,
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
	const consumer = (chatTabId: string, submit: ChannelSubmit) =>
		renderHook(() => useComposerSubmitConsumer(chatTabId, submit), { wrapper });
	return { consumer, handoff, selectChat };
}

describe('useChatPromptHandoff', () => {
	// The reported bug: a chore fired from the Checks panel with a diff viewer in
	// front was queued against that viewer, which mounts no composer, so it was
	// never delivered while the toast claimed it had been handed over.
	test('hands a chore to the last-visited chat rather than the diff tab in front', () => {
		const { consumer, handoff, selectChat } = renderHandoff({
			activeSession: DIFF_TAB,
			sessionTabs: [CHAT_A, CHAT_B, DIFF_TAB],
			visitOrder: ['diff-1', 'chat-b', 'chat-a'],
		});
		const chatSubmit = vi.fn(() => true);
		const diffSubmit = vi.fn(() => true);

		consumer('chat-b', chatSubmit);
		consumer('diff-1', diffSubmit);

		let handed: boolean | undefined;
		act(() => {
			handed = handoff.result.current('commit and push');
		});

		expect(handed).toBe(true);
		expect(chatSubmit).toHaveBeenCalledWith('commit and push', 'chore');
		expect(diffSubmit).not.toHaveBeenCalled();
		expect(selectChat).toHaveBeenCalledWith('chat-b');
	});

	test('leaves the chat in front alone rather than navigating away from it', () => {
		const { consumer, handoff, selectChat } = renderHandoff({
			activeSession: CHAT_A,
			sessionTabs: [CHAT_A, CHAT_B],
			visitOrder: ['chat-a', 'chat-b'],
		});
		const submit = vi.fn(() => true);

		consumer('chat-a', submit);
		act(() => {
			handoff.result.current('commit and push');
		});

		expect(submit).toHaveBeenCalledWith('commit and push', 'chore');
		expect(selectChat).not.toHaveBeenCalled();
	});

	test('reports failure without navigating when no chat tab is open', () => {
		const { handoff, selectChat } = renderHandoff({
			activeSession: DIFF_TAB,
			sessionTabs: [DIFF_TAB, FILE_TAB],
			visitOrder: ['diff-1', 'file-1'],
		});

		let handed: boolean | undefined;
		act(() => {
			handed = handoff.result.current('commit and push');
		});

		expect(handed).toBe(false);
		expect(selectChat).not.toHaveBeenCalled();
	});

	// The window between entering a workspace and its tab rows arriving. The
	// composer mounted over the placeholder would drain the entry and then refuse
	// it, so queueing there loses the chore behind a toast claiming it landed.
	test('refuses rather than queueing against the unloaded placeholder', () => {
		const { consumer, handoff, selectChat } = renderHandoff({
			activeSession: PLACEHOLDER_TAB,
			sessionTabs: [],
			visitOrder: [],
		});
		const placeholderSubmit = vi.fn(() => true);

		consumer(`${WORKSPACE_ID}:overview`, placeholderSubmit);

		let handed: boolean | undefined;
		act(() => {
			handed = handoff.result.current('commit and push');
		});

		expect(handed).toBe(false);
		expect(placeholderSubmit).not.toHaveBeenCalled();
		expect(selectChat).not.toHaveBeenCalled();
	});
});
