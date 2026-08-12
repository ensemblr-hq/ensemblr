// @vitest-environment happy-dom

/**
 * The attachment channel is app-global and outlives a workspace switch, so these
 * cover who is allowed to drain an entry. A chip carries a workspace-relative
 * path: a review surface that broadcasts one has to reach the composers editing
 * that workspace and no others, or the path resolves against the wrong tree and
 * the send fails on a chip the user never put there.
 */

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';

import {
	useComposerAttachmentDispatcher,
	useComposerAttachmentInbox,
	useComposerAttachmentInsert,
} from '@/renderer/state/composer';
import type { ComposerAttachment } from '@/renderer/types/workbench';

const WORKSPACE_A = '/repos/alpha';
const WORKSPACE_B = '/repos/beta';

const CHIP: ComposerAttachment = {
	id: 'review-comment:c1',
	kind: 'workspace-file',
	label: 'page.tsx',
	path: '.context/attachments/ab12cd/review-comment-github-page-tsx-57.md',
};

/** Mounts a broadcast sender for one workspace alongside two draining inboxes. */
function renderChannel() {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	return renderHook(
		() => ({
			broadcastToA: useComposerAttachmentInsert(WORKSPACE_A),
			dispatch: useComposerAttachmentDispatcher(),
			inboxA: useComposerAttachmentInbox('chat-a', WORKSPACE_A),
			inboxB: useComposerAttachmentInbox('chat-b', WORKSPACE_B),
		}),
		{ wrapper },
	);
}

test('a broadcast reaches a composer on the same workspace root', () => {
	const { result } = renderChannel();

	act(() => {
		result.current.broadcastToA(CHIP);
	});

	expect(result.current.inboxA.pending).toEqual([CHIP]);
});

// The failure this prevents: the user attaches from a review panel while no
// composer is mounted, switches workspace, and the parked chip drains into a
// chat whose root cannot resolve the path.
test('a broadcast never reaches a composer on another workspace root', () => {
	const { result } = renderChannel();

	act(() => {
		result.current.broadcastToA(CHIP);
	});

	expect(result.current.inboxB.pending).toEqual([]);
});

test('draining one workspace leaves another workspace queue alone', () => {
	const { result } = renderChannel();

	act(() => {
		result.current.broadcastToA(CHIP);
		result.current.dispatch({ workspaceCwd: WORKSPACE_B }, CHIP);
	});
	act(() => {
		result.current.inboxA.clear();
	});

	expect(result.current.inboxA.pending).toEqual([]);
	expect(result.current.inboxB.pending).toEqual([CHIP]);
});

// A chat-addressed entry names one composer, so it must not be swallowed by a
// broadcast drain for the same workspace and lost before that chat mounts.
test('a chat-addressed entry ignores the workspace root', () => {
	const { result } = renderChannel();

	act(() => {
		result.current.dispatch({ chatTabId: 'chat-b' }, CHIP);
	});

	expect(result.current.inboxA.pending).toEqual([]);
	expect(result.current.inboxB.pending).toEqual([CHIP]);
});

test('the same chip queued twice for one target is queued once', () => {
	const { result } = renderChannel();

	act(() => {
		result.current.broadcastToA(CHIP);
		result.current.broadcastToA(CHIP);
	});

	expect(result.current.inboxA.pending).toEqual([CHIP]);
});
