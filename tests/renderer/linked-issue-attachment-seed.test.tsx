// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useLinkedIssueSeed } from '@/renderer/hooks/workbench-shell/composer/use-linked-issue-seed';
import { composerLinkedIssueSeededAtomFamily } from '@/renderer/state/composer';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';

const linkedIssue: WorkspaceLinkedIssueSummary = {
	description: 'Steps to reproduce.',
	provider: 'github',
	reference: '#44',
	remoteId: 'https://github.com/o/r/issues/44',
	title: 'Dedup recents',
	url: 'https://github.com/o/r/issues/44',
};

/** Mounts the seed hook against one shared store, so remounts share the flag. */
function renderSeed({
	attach,
	chatTabId,
	issue = linkedIssue,
	store,
}: {
	attach: (issue: WorkspaceLinkedIssueSummary) => Promise<boolean>;
	chatTabId: string;
	issue?: WorkspaceLinkedIssueSummary;
	store: ReturnType<typeof createStore>;
}) {
	return renderHook(
		() =>
			useLinkedIssueSeed({
				attachLinkedIssue: attach,
				chatTabId,
				linkedIssue: issue,
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<Provider store={store}>{children}</Provider>
			),
		},
	);
}

describe('useLinkedIssueSeed', () => {
	let store: ReturnType<typeof createStore>;

	beforeEach(() => {
		composerLinkedIssueSeededAtomFamily.remove('chat-1');
		store = createStore();
	});

	test('attaches the workspace issue exactly once', () => {
		const attach = vi.fn(async () => true);

		renderSeed({ attach, chatTabId: 'chat-1', store });

		expect(attach).toHaveBeenCalledTimes(1);
		expect(attach).toHaveBeenCalledWith(linkedIssue);
	});

	test('does not attach again on a remount, which a route change causes', () => {
		const attach = vi.fn(async () => true);

		renderSeed({ attach, chatTabId: 'chat-1', store }).unmount();
		renderSeed({ attach, chatTabId: 'chat-1', store });

		expect(attach).toHaveBeenCalledTimes(1);
	});

	test('does not resurrect the attachment after the user removes the chip', () => {
		const attach = vi.fn(async () => true);

		const view = renderSeed({ attach, chatTabId: 'chat-1', store });
		// Removing the chip only empties the draft; the seeded flag is what stops
		// the next render from putting it straight back.
		view.rerender();
		view.unmount();
		renderSeed({ attach, chatTabId: 'chat-1', store });

		expect(attach).toHaveBeenCalledTimes(1);
	});

	test('attaches nothing for a workspace that came from no issue', () => {
		const attach = vi.fn(async () => true);

		renderHook(
			() =>
				useLinkedIssueSeed({ attachLinkedIssue: attach, chatTabId: 'chat-1' }),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<Provider store={store}>{children}</Provider>
				),
			},
		);

		expect(attach).not.toHaveBeenCalled();
		expect(store.get(composerLinkedIssueSeededAtomFamily('chat-1'))).toBe(
			false,
		);
	});

	test('seeds each chat separately', () => {
		const attach = vi.fn(async () => true);
		composerLinkedIssueSeededAtomFamily.remove('chat-2');

		renderSeed({ attach, chatTabId: 'chat-1', store });
		renderSeed({ attach, chatTabId: 'chat-2', store });

		expect(attach).toHaveBeenCalledTimes(2);
	});

	// The flag is claimed before the attach is awaited so a second render cannot
	// duplicate the chip. Leaving it claimed over a failure would lose the issue
	// for that chat permanently — there is no gesture that asks for it back.
	test('releases the seed flag when the attach fails', async () => {
		const attach = vi.fn(async () => false);

		renderSeed({ attach, chatTabId: 'chat-1', store });

		await waitFor(() => {
			expect(store.get(composerLinkedIssueSeededAtomFamily('chat-1'))).toBe(
				false,
			);
		});
		expect(attach).toHaveBeenCalledTimes(1);
	});
});
