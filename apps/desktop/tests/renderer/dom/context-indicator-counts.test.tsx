// @vitest-environment happy-dom

/**
 * What the context hover card actually says. The gauge used to fall back to a
 * fabricated 258.4k window whenever nothing had been measured yet, so a chat
 * that had never run a turn read as "0/258.4k — window unavailable". The count
 * must now name the window it was given, and name nothing when there is none.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { ContextIndicator } from '@/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';
import type { ComposerContextUsage } from '@/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

/** Renders the gauge and opens its card so the counts are queryable. */
async function openCard(usage: ComposerContextUsage | null): Promise<void> {
	renderWithProviders(<ContextIndicator usage={usage} />);
	await userEvent.click(screen.getByLabelText('Context usage'));
}

test('names the window it was given on a chat that has run nothing yet', async () => {
	await openCard({ maxTokens: 1_000_000, usedTokens: 0 });

	expect(await screen.findByText('0/1.0M')).toBeVisible();
});

test('names no window at all when the runtime published none', async () => {
	await openCard(null);

	expect(
		await screen.findByText('Context window unavailable for this model.'),
	).toBeVisible();
	expect(screen.queryByText(/258\.4k/)).toBeNull();
});
