// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, expect, test } from 'vitest';

import { WorkspaceTimeline } from '@/renderer/components/workbench-shell/conversation-panel/workspace-timeline';
import { useOptimisticPrompts } from '@/renderer/state/composer';
import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const workspace = {
	changeSummary: { additions: 0, deletions: 0, files: 0 },
	id: 'ws-1',
	landingSummary: null,
	name: 'nyman',
} as unknown as WorkspaceShellModel;

const composer = {
	activeAgentSessionId: null,
	workspaceCwd: '/tmp/ws-1',
} as unknown as ComposerShellState;

const TIMELINE = '[data-timeline-state]';
const EMPTY_STATE = '[data-new-chat-state="empty"]';
const PENDING_TURN = '[data-pending="true"]';

function sessionTab(chatTabId: string): SessionTabModel {
	return {
		agentSessionId: null,
		chatTabId,
		id: chatTabId,
	} as unknown as SessionTabModel;
}

// Each test owns its Jotai store, so a prompt pushed here cannot leak into the
// next test through the module-level default store.
function setup(chatTabId: string) {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const { result } = renderHook(() => useOptimisticPrompts(chatTabId), {
		wrapper,
	});

	const render = () => {
		installEnsemblrApi({
			listAgentSessions: async () => ({ sessions: [] }),
			listChatTabSummaries: async () => ({ entries: [] }),
		});
		return renderWithProviders(
			<Provider store={store}>
				<WorkspaceTimeline
					activeSession={sessionTab(chatTabId)}
					composer={composer}
					workspace={workspace}
				/>
			</Provider>,
		).container;
	};

	return { prompts: result, render };
}

afterEach(() => {
	clearEnsemblrApi();
});

test('the first prompt and its turn timer render while the session is still opening', () => {
	const { prompts, render } = setup('chat-pending');
	act(() => {
		prompts.current.push('run the tests');
	});

	const container = render();

	expect(container.textContent).toContain('run the tests');
	expect(container.querySelector(PENDING_TURN)).not.toBeNull();
	expect(container.querySelector(EMPTY_STATE)).toBeNull();
});

test('an untouched new chat still shows its empty state', () => {
	const container = setup('chat-idle').render();

	expect(container.querySelector(EMPTY_STATE)).not.toBeNull();
	expect(container.querySelector(TIMELINE)).toBeNull();
});

// Reuses the tab id of the first test on purpose: the store isolation in
// `setup` is what keeps that earlier prompt out of this one.
test('a retracted prompt returns the chat to its empty state', () => {
	const { prompts, render } = setup('chat-pending');
	let entryId = '';
	act(() => {
		entryId = prompts.current.push('ship it').id;
	});
	act(() => {
		prompts.current.remove(entryId);
	});

	const container = render();

	expect(container.querySelector(EMPTY_STATE)).not.toBeNull();
	expect(container.querySelector(TIMELINE)).toBeNull();
});
