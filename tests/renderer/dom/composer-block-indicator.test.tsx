// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ComposerNotices } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/composer-notices';
import type { ComposerStateApi } from '../../../src/renderer/hooks/workbench-shell/composer/use-composer-state';
import { resolveSendIntent } from '../../../src/renderer/lib/workbench';
import type { FollowUpBehavior } from '../../../src/renderer/state/preferences';
import { renderWithProviders } from '../support/dom';

const HELD_NOTICE = /Follow-ups are held while the agent works/;

/**
 * Renders the notices strip for one point in the behavior × streaming matrix,
 * deriving the intent exactly as the composer does so the test cannot drift from
 * the resolver it is describing.
 */
function renderNotices(behavior: FollowUpBehavior, isStreaming: boolean) {
	const state = {
		attachmentError: null,
		attachments: [],
		followUpQueue: [],
		hasChips: false,
		linkedDirectories: [],
		pendingLinkedDirectories: [],
		sendIntent: resolveSendIntent(behavior, isStreaming),
		unlinkDirectory: vi.fn(),
	} as unknown as ComposerStateApi;
	renderWithProviders(<ComposerNotices state={state} />);
}

describe('the held-follow-up notice', () => {
	test('shows only under block, and only mid-turn', () => {
		renderNotices('block', true);

		expect(screen.getByText(HELD_NOTICE)).toBeInTheDocument();
	});

	test('is absent under block when the agent is idle', () => {
		// The behavior does nothing when there is no turn to interrupt, so a notice
		// then would describe a state the user is not in.
		renderNotices('block', false);

		expect(screen.queryByText(HELD_NOTICE)).toBeNull();
	});

	test('is absent under steer and queue, streaming or not', () => {
		for (const behavior of ['steer', 'queue'] as const) {
			for (const isStreaming of [true, false]) {
				const { unmount } = renderWithProviders(<span />);
				unmount();
				renderNotices(behavior, isStreaming);
				expect(screen.queryByText(HELD_NOTICE)).toBeNull();
			}
		}
	});

	test('renders once, not twice, when it does show', () => {
		renderNotices('block', true);

		expect(screen.getAllByText(HELD_NOTICE)).toHaveLength(1);
	});
});
