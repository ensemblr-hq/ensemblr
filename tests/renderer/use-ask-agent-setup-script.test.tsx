// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, expect, test, vi } from 'vitest';

import { useAskAgentSetupScript } from '@/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script';
import { useComposerInsertConsumer } from '@/renderer/state/composer';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * Renders the hook alongside a composer-insert consumer so the test observes the
 * text the hook seeds. Both share Jotai's default store, mirroring the single
 * mounted composer in the app.
 */
function renderAskAgent(
	openSessionTab: () => Promise<{ chatTabId: string } | null>,
	selectChat: (chatTabId: string) => void,
) {
	const inserted: string[] = [];
	const view = renderHook(
		({ activeChatTabId }: { activeChatTabId: string }) => {
			useComposerInsertConsumer((text) => {
				inserted.push(text);
			});
			return useAskAgentSetupScript({
				activeChatTabId,
				openSessionTab,
				selectChat,
			});
		},
		{ initialProps: { activeChatTabId: 'old-chat' } },
	);
	return { inserted, view };
}

beforeEach(() => {
	vi.clearAllMocks();
});

test('opens a fresh chat and defers the seed until it is active', async () => {
	const openSessionTab = vi.fn().mockResolvedValue({ chatTabId: 'new-chat' });
	const selectChat = vi.fn();
	const { inserted, view } = renderAskAgent(openSessionTab, selectChat);

	await act(async () => {
		view.result.current();
	});

	// The new chat is created and selected, but its composer is not active yet,
	// so the prompt must NOT leak into the previous chat's composer.
	expect(openSessionTab).toHaveBeenCalledTimes(1);
	expect(selectChat).toHaveBeenCalledWith('new-chat');
	expect(inserted).toEqual([]);

	// Navigation lands: the new chat becomes active and now receives the seed.
	act(() => {
		view.rerender({ activeChatTabId: 'new-chat' });
	});

	expect(inserted).toHaveLength(1);
	expect(inserted[0]).toContain('.ensemblr/settings.toml');
	expect(inserted[0]).toContain('[scripts]');
	expect(toast.success).toHaveBeenCalledTimes(1);
});

test('does not seed when the chat-tab limit blocks a new chat', async () => {
	const openSessionTab = vi.fn().mockResolvedValue(null);
	const selectChat = vi.fn();
	const { inserted, view } = renderAskAgent(openSessionTab, selectChat);

	await act(async () => {
		view.result.current();
	});
	act(() => {
		view.rerender({ activeChatTabId: 'whatever' });
	});

	expect(selectChat).not.toHaveBeenCalled();
	expect(inserted).toEqual([]);
	expect(toast.success).not.toHaveBeenCalled();
});

test('surfaces an error and seeds nothing when opening the chat rejects', async () => {
	const openSessionTab = vi.fn().mockRejectedValue(new Error('boom'));
	const selectChat = vi.fn();
	const { inserted, view } = renderAskAgent(openSessionTab, selectChat);

	await act(async () => {
		view.result.current();
	});
	act(() => {
		view.rerender({ activeChatTabId: 'whatever' });
	});

	expect(selectChat).not.toHaveBeenCalled();
	expect(inserted).toEqual([]);
	expect(toast.success).not.toHaveBeenCalled();
	expect(toast.error).toHaveBeenCalledTimes(1);
});
