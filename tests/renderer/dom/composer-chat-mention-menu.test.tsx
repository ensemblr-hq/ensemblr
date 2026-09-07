// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ComposerAutocompletePopover } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/mention-popover';
import type {
	ConciergeReferenceMatch,
	MentionMatch,
} from '../../../src/renderer/types/workbench';
import type { ConciergeReference } from '../../../src/shared/concierge-references';
import { renderWithProviders } from '../support/dom';

const FILE_MATCH: MentionMatch = {
	entry: {
		id: 'wsfile:src/app.ts',
		kind: 'file',
		name: 'app.ts',
		path: 'src/app.ts',
	},
	nameRanges: [],
	pathRanges: [],
};

const OPEN_CHAT: ConciergeReference = {
	agentSessionId: 'session-1',
	chatTabId: 'tab-1',
	kind: 'chat',
	label: 'Audit the docs',
	role: 'orchestrator',
	state: 'open',
	workspace: 'khachaturian',
	workspaceId: 'ws-1',
};

const CLOSED_CHAT: ConciergeReference = {
	...OPEN_CHAT,
	chatTabId: 'tab-2',
	label: 'Ship the release',
	state: 'closed',
};

/** A ranked chat row, unhighlighted. */
function chatMatch(reference: ConciergeReference): ConciergeReferenceMatch {
	return { labelRanges: [], reference };
}

/** Mounts the `@` menu with the chat rows and file rows a workspace offers. */
function mountMentionMenu({
	chatMatches = [],
	onChatSelect = vi.fn(),
	onMentionSelect = vi.fn(),
}: {
	chatMatches?: readonly ConciergeReferenceMatch[];
	onChatSelect?: (reference: ConciergeReference) => void;
	onMentionSelect?: () => void;
} = {}) {
	renderWithProviders(
		<ComposerAutocompletePopover
			activeIndex={0}
			chatMatches={chatMatches}
			kind='mention'
			mentionMatches={[FILE_MATCH]}
			onChatSelect={onChatSelect}
			onHover={() => undefined}
			onMentionSelect={onMentionSelect}
			onOpenChange={() => undefined}
			onSlashSelect={() => undefined}
			slashLoading={false}
			slashMatches={[]}
		>
			<div data-testid='composer-surface' />
		</ComposerAutocompletePopover>,
	);
}

describe("the composer's @ menu offering this workspace's chats", () => {
	it('lists the chats above the files', async () => {
		mountMentionMenu({ chatMatches: [chatMatch(OPEN_CHAT)] });

		const rows = await screen.findAllByRole('button');

		expect(rows.map((row) => row.textContent)).toEqual([
			'Audit the docs',
			'app.tssrc/app.ts',
		]);
	});

	it('marks a closed chat so it is not mistaken for one still running', async () => {
		mountMentionMenu({ chatMatches: [chatMatch(CLOSED_CHAT)] });

		expect(await screen.findByText('closed')).toBeInTheDocument();
	});

	it('leaves the workspace name off a row, since every chat shares it', async () => {
		mountMentionMenu({ chatMatches: [chatMatch(OPEN_CHAT)] });

		await screen.findByText('Audit the docs');
		expect(screen.queryByText('khachaturian')).not.toBeInTheDocument();
	});

	it('hands the picked chat back as a reference', async () => {
		const onChatSelect = vi.fn();
		mountMentionMenu({ chatMatches: [chatMatch(OPEN_CHAT)], onChatSelect });

		await userEvent.click(await screen.findByText('Audit the docs'));

		expect(onChatSelect).toHaveBeenCalledWith(OPEN_CHAT);
	});

	it('picks the file the merged index points at, not the one beneath it', async () => {
		const onMentionSelect = vi.fn();
		mountMentionMenu({ chatMatches: [chatMatch(OPEN_CHAT)], onMentionSelect });

		await userEvent.click(await screen.findByText('app.ts'));

		expect(onMentionSelect).toHaveBeenCalledWith(FILE_MATCH.entry);
	});

	it('renders the files alone in a workspace with no other chats', async () => {
		mountMentionMenu();

		const rows = await screen.findAllByRole('button');

		expect(rows).toHaveLength(1);
		expect(rows[0]).toHaveTextContent('app.ts');
	});
});
