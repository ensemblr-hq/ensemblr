// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useClaimPlaceholderTab } from '../../src/renderer/hooks/workbench-shell/composer/use-claim-placeholder-tab.ts';
import {
	composerAttachmentsAtomFamily,
	composerValueAtomFamily,
} from '../../src/renderer/state/composer/index.ts';
import { useWorkspaceChatBootstrap } from '../../src/renderer/state/workspace/chat-tab-bootstrap.ts';
import type { ComposerAttachment } from '../../src/renderer/types/workbench';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

const CHAT_TAB_ID = 'tab-placeholder';

afterEach(() => {
	clearEnsemblrApi();
});

/**
 * Renders the claim hook against a fresh Jotai store so each test owns the draft
 * atoms outright.
 * @param store - Store holding the composer draft for {@link CHAT_TAB_ID}
 */
function renderClaim(store: ReturnType<typeof createStore>) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	return renderHook(() => useClaimPlaceholderTab(CHAT_TAB_ID), { wrapper });
}

// The bootstrap is the one open nobody asked for, and the only tab a spawned
// conversation may take over. Every other open belongs to whoever made it.
it('the workspace bootstrap opens its tab as a placeholder', async () => {
	const openChatTab = vi.fn(
		(
			_request: unknown,
			options: { onSuccess: (result: { tab: { id: string } }) => void },
		) => {
			options.onSuccess({ tab: { id: 'tab-new' } });
		},
	);

	renderHook(() =>
		useWorkspaceChatBootstrap({
			enabled: true,
			hasSettledTabList: true,
			invalidateChatTabs: vi.fn(),
			onSessionTabChange: vi.fn(),
			openChatTab: openChatTab as unknown as Parameters<
				typeof useWorkspaceChatBootstrap
			>[0]['openChatTab'],
			openTabCount: 0,
			workspaceId: 'ws-bootstrap-placeholder',
		}),
	);

	await waitFor(() => {
		expect(openChatTab).toHaveBeenCalledWith(
			{ placeholder: true },
			expect.anything(),
		);
	});
});

// A draft never leaves the renderer, so main cannot tell a blank placeholder
// from one the user is halfway through a prompt in. Typing says it is theirs.
it('claims the tab once the user starts typing', async () => {
	const pinChatTab = vi.fn().mockResolvedValue({ tab: null });
	installEnsemblrApi({ pinChatTab });
	const store = createStore();

	renderClaim(store);
	expect(pinChatTab).not.toHaveBeenCalled();

	act(() => {
		store.set(composerValueAtomFamily(CHAT_TAB_ID), 'half a prompt');
	});

	await waitFor(() => {
		expect(pinChatTab).toHaveBeenCalledWith({ chatTabId: CHAT_TAB_ID });
	});
});

// An attachment with no text is still the user spending the tab.
it('claims the tab on an attachment alone', async () => {
	const pinChatTab = vi.fn().mockResolvedValue({ tab: null });
	installEnsemblrApi({ pinChatTab });
	const store = createStore();

	renderClaim(store);

	act(() => {
		store.set(composerAttachmentsAtomFamily(CHAT_TAB_ID), [
			{ id: 'a1' } as ComposerAttachment,
		]);
	});

	await waitFor(() => {
		expect(pinChatTab).toHaveBeenCalledWith({ chatTabId: CHAT_TAB_ID });
	});
});

it('sends the claim once, not once per keystroke', async () => {
	const pinChatTab = vi.fn().mockResolvedValue({ tab: null });
	installEnsemblrApi({ pinChatTab });
	const store = createStore();

	renderClaim(store);

	act(() => {
		store.set(composerValueAtomFamily(CHAT_TAB_ID), 'h');
	});
	await waitFor(() => expect(pinChatTab).toHaveBeenCalledTimes(1));
	act(() => {
		store.set(composerValueAtomFamily(CHAT_TAB_ID), 'ha');
	});
	act(() => {
		store.set(composerValueAtomFamily(CHAT_TAB_ID), 'hal');
	});

	expect(pinChatTab).toHaveBeenCalledTimes(1);
});

// The tab stays claimable rather than silently un-claimed, so the next draft
// change retries instead of leaving the user's tab open to a spawn.
it('retries after a failed claim', async () => {
	const pinChatTab = vi
		.fn()
		.mockRejectedValueOnce(new Error('ipc down'))
		.mockResolvedValue({ tab: null });
	installEnsemblrApi({ pinChatTab });
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	const store = createStore();

	renderClaim(store);

	act(() => {
		store.set(composerValueAtomFamily(CHAT_TAB_ID), 'h');
	});
	await waitFor(() => expect(consoleError).toHaveBeenCalled());

	act(() => {
		store.set(composerAttachmentsAtomFamily(CHAT_TAB_ID), [
			{ id: 'a1' } as ComposerAttachment,
		]);
	});

	await waitFor(() => expect(pinChatTab).toHaveBeenCalledTimes(2));
	consoleError.mockRestore();
});
