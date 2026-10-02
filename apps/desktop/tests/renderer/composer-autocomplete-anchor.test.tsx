// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { TextContextMenu } from '../../src/renderer/components/text-context-menu';
import { ComposerAutocompletePopover } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/mention-popover';
import type {
	AutocompleteKind,
	MentionMatch,
	SlashCommandMatch,
} from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const SLASH_MATCH: SlashCommandMatch = {
	item: { autoSubmit: true, command: 'review', description: 'Review changes' },
	ranges: [],
};

const MENTION_MATCH: MentionMatch = {
	entry: {
		id: 'wsfile:src/app.ts',
		kind: 'file',
		name: 'app.ts',
		path: 'src/app.ts',
	},
	nameRanges: [],
	pathRanges: [],
};

/**
 * Mounts the popover around the composer surface exactly as `ComposerPanel`
 * does: wrapped in `TextContextMenu`, which is a plain function component and
 * forwards neither a ref nor its props onto a DOM node.
 */
function mountPopover(kind: AutocompleteKind) {
	return renderWithProviders(
		<ComposerAutocompletePopover
			activeIndex={0}
			kind={kind}
			mentionMatches={[MENTION_MATCH]}
			onHover={() => undefined}
			onMentionSelect={() => undefined}
			onOpenChange={() => undefined}
			onSlashSelect={() => undefined}
			slashLoading={false}
			slashMatches={[SLASH_MATCH]}
		>
			<TextContextMenu>
				<div data-testid='composer-surface' />
			</TextContextMenu>
		</ComposerAutocompletePopover>,
	);
}

// Radix measures the anchor element to place the menu. Handed `asChild` onto a
// wrapper that drops the ref, it measures nothing and parks the menu at
// translate(0, -200%) — open, populated, and off the top of the window.
test('anchors to a real element even though its child forwards no ref', () => {
	mountPopover('slash');

	const anchor = document.querySelector('[data-slot="popover-anchor"]');

	expect(anchor).not.toBeNull();
	expect(anchor).toContainElement(screen.getByTestId('composer-surface'));
});

test('keeps the anchor mounted while no token is under the caret', () => {
	mountPopover(null);

	expect(document.querySelector('[data-slot="popover-anchor"]')).not.toBeNull();
	expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
	expect(screen.queryByText('review')).not.toBeInTheDocument();
});

test('renders the slash rows inside the anchored menu', async () => {
	mountPopover('slash');

	expect(await screen.findByText('review')).toBeInTheDocument();
});

test('renders the mention rows inside the anchored menu', async () => {
	mountPopover('mention');

	expect(await screen.findByText('app.ts')).toBeInTheDocument();
});
