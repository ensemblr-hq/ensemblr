// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test } from 'vitest';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { ComposerPanel } from '@/renderer/components/workbench-shell/conversation-panel';
import { ComposerSlot } from '@/renderer/components/workbench-shell/conversation-panel/composer-slot';
import {
	composerValueAtomFamily,
	forgetComposerDraft,
} from '@/renderer/state/composer';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { createComposerShellState } from './support/composer';
import { createTestQueryClient } from './support/dom';

const TAB_A = 'chat-a';
const TAB_B = 'chat-b';
const STUCK = 'I want you to do a visual pass over the markdown previews';

const workspace = {
	id: 'workspace-draft-isolation',
	projectId: 'repo-draft-isolation',
} as WorkspaceShellModel;

/** A plain chat tab, so the slot renders the composer rather than a sub-agent readout. */
function createChatSession(chatTabId: string): SessionTabModel {
	return {
		agentSessionId: null,
		chatTabId,
		id: chatTabId,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: 'Chat',
		status: 'idle',
		summary: '',
		updatedLabel: 'Chat',
	};
}

/** The slot under the providers the workbench gives it, ready to re-render on another tab. */
function renderSlot(store: ReturnType<typeof createStore>, chatTabId: string) {
	const client = createTestQueryClient();
	const tree = (id: string) => (
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<Provider store={store}>
					<ComposerSlot
						agentSessionId={null}
						chatTabId={id}
						composer={createComposerShellState({
							activeSession: createChatSession(id),
						})}
						workspace={workspace}
					/>
				</Provider>
			</TooltipProvider>
		</QueryClientProvider>
	);
	const view = render(tree(chatTabId));
	return {
		switchTo: (id: string) => {
			view.rerender(tree(id));
		},
		view,
	};
}

/** The panel on its own, so the isolation is pinned to its own contract rather than the slot's. */
function renderPanel(store: ReturnType<typeof createStore>, chatTabId: string) {
	const client = createTestQueryClient();
	const tree = (id: string) => (
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<Provider store={store}>
					<ComposerPanel
						chatTabId={id}
						composer={createComposerShellState({
							activeSession: createChatSession(id),
						})}
						repositoryId={workspace.projectId}
						workspaceId={workspace.id}
					/>
				</Provider>
			</TooltipProvider>
		</QueryClientProvider>
	);
	const view = render(tree(chatTabId));
	return {
		switchTo: (id: string) => {
			view.rerender(tree(id));
		},
	};
}

describe('composer draft isolation across chat tabs', () => {
	afterEach(() => {
		forgetComposerDraft(TAB_A);
		forgetComposerDraft(TAB_B);
	});

	// The panel keys its own body, so a caller that renders it bare — and every
	// caller reaching it through the concern barrel — gets the isolation without
	// having to know about it.
	test('the panel isolates drafts without the caller supplying a key', () => {
		const store = createStore();
		store.set(composerValueAtomFamily(TAB_A), STUCK);

		const { switchTo } = renderPanel(store, TAB_A);
		expect(screen.getByText(STUCK)).toBeInTheDocument();

		switchTo(TAB_B);

		expect(screen.queryByText(STUCK)).not.toBeInTheDocument();
	});

	test('a draft left in one tab does not follow the user into the next', () => {
		const store = createStore();
		store.set(composerValueAtomFamily(TAB_A), STUCK);

		const { switchTo } = renderSlot(store, TAB_A);
		expect(screen.getByText(STUCK)).toBeInTheDocument();

		switchTo(TAB_B);

		expect(screen.queryByText(STUCK)).not.toBeInTheDocument();
		expect(store.get(composerValueAtomFamily(TAB_B))).toBe('');
	});

	test('the tab that owns the draft still gets it back', () => {
		const store = createStore();
		store.set(composerValueAtomFamily(TAB_A), STUCK);

		const { switchTo } = renderSlot(store, TAB_A);
		switchTo(TAB_B);
		switchTo(TAB_A);

		expect(screen.getByText(STUCK)).toBeInTheDocument();
		expect(store.get(composerValueAtomFamily(TAB_A))).toBe(STUCK);
	});
});
