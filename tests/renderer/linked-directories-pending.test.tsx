// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLinkedDirectories } from '@/renderer/hooks/workbench-shell/composer/use-linked-directories';
import {
	chatAppliedLinkedDirectoriesAtomFamily,
	chatLinkedDirectoriesAtomFamily,
} from '@/renderer/state/preferences';
import type { LinkedDirectory } from '@/renderer/types/workbench';
import { createTestQueryClient, installLocalStorage } from './support/dom';

const CHAT_TAB_ID = 'chat-1';
const VAULT: LinkedDirectory = { name: 'Vault', path: '/Users/me/Vault' };
const DESIGNS: LinkedDirectory = { name: 'designs', path: '/Users/me/designs' };

/**
 * Renders the hook against a fresh Jotai store, seeded with the chat's linked
 * set and whatever the running session was launched with.
 */
function renderLinkedDirectories(seed: {
	applied?: readonly string[] | null;
	linked?: readonly LinkedDirectory[];
}) {
	const store = createStore();
	const client = createTestQueryClient();
	store.set(chatLinkedDirectoriesAtomFamily(CHAT_TAB_ID), seed.linked ?? []);
	if (seed.applied !== undefined) {
		store.set(
			chatAppliedLinkedDirectoriesAtomFamily(CHAT_TAB_ID),
			seed.applied,
		);
	}
	return renderHook(() => useLinkedDirectories({ chatTabId: CHAT_TAB_ID }), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>
				<JotaiProvider store={store}>{children}</JotaiProvider>
			</QueryClientProvider>
		),
	});
}

describe('pending linked directories', () => {
	beforeEach(() => {
		installLocalStorage();
		chatLinkedDirectoriesAtomFamily.remove(CHAT_TAB_ID);
		chatAppliedLinkedDirectoriesAtomFamily.remove(CHAT_TAB_ID);
	});

	it('reports nothing pending before any session has opened', () => {
		const { result } = renderLinkedDirectories({ linked: [VAULT] });

		expect(result.current.linkedDirectories).toEqual([VAULT]);
		expect(result.current.pendingDirectories).toEqual([]);
	});

	it('reports a directory linked after a session that carried none', () => {
		const { result } = renderLinkedDirectories({
			applied: [],
			linked: [VAULT],
		});

		expect(result.current.pendingDirectories).toEqual([VAULT]);
	});

	it('reports nothing pending when the session was launched with the set', () => {
		const { result } = renderLinkedDirectories({
			applied: [VAULT.path],
			linked: [VAULT],
		});

		expect(result.current.pendingDirectories).toEqual([]);
	});

	it('reports only the directories the running session is missing', () => {
		const { result } = renderLinkedDirectories({
			applied: [VAULT.path],
			linked: [VAULT, DESIGNS],
		});

		expect(result.current.pendingDirectories).toEqual([DESIGNS]);
	});
});
