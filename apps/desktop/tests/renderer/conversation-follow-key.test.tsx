// @vitest-environment happy-dom

/**
 * Sending a prompt has to land in view: the composer empties, and a viewport
 * parked further up the transcript would otherwise show nothing new. These
 * tests pin the follow-key contract — a changed key jumps to the newest
 * message, mounting and re-rendering on the same key do not.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useConversationFollowKey } from '../../src/renderer/hooks/conversation/use-conversation-follow-key';

/** Drives the hook with a changeable follow key and reports the scrolls it asked for. */
function renderFollowKey(followKey: number | undefined) {
	const scrollToBottom = vi.fn();
	const view = renderHook(
		(props: { followKey: number | undefined }) =>
			useConversationFollowKey({
				followKey: props.followKey,
				scrollToBottom,
			}),
		{ initialProps: { followKey } },
	);
	return { ...view, scrollToBottom };
}

describe('conversation follow key', () => {
	test('leaves a freshly opened conversation where it was restored to', () => {
		const { scrollToBottom } = renderFollowKey(4);

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('jumps to the newest message once the key changes', () => {
		const { rerender, scrollToBottom } = renderFollowKey(4);

		rerender({ followKey: 5 });

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	test('stays put while the key holds, however often the tree re-renders', () => {
		const { rerender, scrollToBottom } = renderFollowKey(4);

		rerender({ followKey: 5 });
		rerender({ followKey: 5 });
		rerender({ followKey: 5 });

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	test('ignores a conversation that opted out of following', () => {
		const { rerender, scrollToBottom } = renderFollowKey(undefined);

		rerender({ followKey: undefined });

		expect(scrollToBottom).not.toHaveBeenCalled();
	});
});
