// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { NewChatEmptyState } from '../../../src/renderer/components/workbench-shell/conversation-panel/new-chat-empty-state';
import { useComposerAttachmentInbox } from '../../../src/renderer/state/composer';
import type { ClosedChatTabEntryWire } from '../../../src/shared/ipc/contracts/chat-tab';
import { installLocalStorage, renderWithProviders } from '../support/dom';

const WORKSPACE_CWD = '/tmp/ws';
const ACTIVE_TAB = 'tab-active';

/**
 * Builds one closed-chat history entry. An empty `summaryPath` is how the main
 * process reports a chat whose transcript was never written or has since gone.
 */
function closedChat(
	id: string,
	title: string,
	summaryPath: string,
): ClosedChatTabEntryWire {
	return {
		closedAt: '2026-06-08T00:00:00.000Z',
		summaryPath,
		summaryTitle: null,
		tab: {
			agentSessionId: `session-${id}`,
			closedAt: '2026-06-08T00:00:00.000Z',
			fullTitle: title,
			id,
			isPreview: false,
			kind: 'chat',
			metadata: {},
			openedAt: '2026-06-08T00:00:00.000Z',
			position: 0,
			title,
			workspaceId: 'ws-1',
		},
	};
}

/**
 * Reports what the composer inbox is holding for the active tab, so a test can
 * assert what a chip queued without reaching into the private atom.
 */
function AttachmentProbe() {
	const { pending } = useComposerAttachmentInbox(ACTIVE_TAB, WORKSPACE_CWD);
	return (
		<ul data-testid='queued'>
			{pending.map((attachment) => (
				<li key={attachment.id}>
					{attachment.kind === 'workspace-file'
						? `${attachment.id}|${attachment.path}`
						: `${attachment.id}|${attachment.kind}`}
				</li>
			))}
		</ul>
	);
}

/** The attachment entries the probe is currently reporting. */
function queuedEntries(): string[] {
	return Array.from(
		screen.getByTestId('queued').querySelectorAll('li'),
		(item) => item.textContent ?? '',
	);
}

/** Mounts the empty state over the given closed-chat history. */
function renderChips(transcripts: readonly ClosedChatTabEntryWire[]): void {
	renderWithProviders(
		<>
			<NewChatEmptyState
				activeChatTabId={ACTIVE_TAB}
				transcripts={transcripts}
				workspaceCwd={WORKSPACE_CWD}
				workspaceName='ws'
			/>
			<AttachmentProbe />
		</>,
	);
}

beforeEach(() => {
	installLocalStorage();
});

describe('the new-chat transcript chips', () => {
	test('offers a chat whose transcript reached disk', () => {
		renderChips([
			closedChat(
				'tab-1',
				'Refactor the loader',
				`${WORKSPACE_CWD}/.context/sessions/tab-1.md`,
			),
		]);

		const chip = screen.getByRole('button', { name: /Refactor the loader/ });
		expect(chip).not.toHaveAttribute('aria-disabled');
		expect(chip).toHaveAttribute(
			'title',
			`${WORKSPACE_CWD}/.context/sessions/tab-1.md`,
		);
	});

	test('still lists a chat with no transcript, refused and explained', () => {
		// Dropping it would leave the user reading an empty surface in a workspace
		// they know they have chatted in — the exact report this behavior answers.
		renderChips([closedChat('tab-2', 'Chase the flaky test', '')]);

		const chip = screen.getByRole('button', { name: /Chase the flaky test/ });
		expect(chip).toHaveAttribute('aria-disabled', 'true');
		expect(chip).toHaveAttribute(
			'title',
			'No transcript was saved for this chat, so it cannot be attached.',
		);
	});

	test('the refusal reaches both the pointer and the accessibility tree', () => {
		// `disabled` would have set `pointer-events: none` through the button base
		// class, so the title tooltip could never be hovered into view, and it would
		// drop the chip out of the tab order — the explanation reaching nobody.
		renderChips([closedChat('tab-3', 'Ship the migration', '')]);

		const chip = screen.getByRole('button', {
			name: /Ship the migration — no transcript was saved/,
		});
		expect(chip).toBeEnabled();
		expect(chip).not.toHaveAttribute('disabled');
	});

	test('clicking a chat with no transcript attaches nothing', () => {
		renderChips([closedChat('tab-4', 'Read the spec', '')]);

		fireEvent.click(screen.getByRole('button', { name: /Read the spec/ }));

		expect(queuedEntries()).toEqual([]);
	});

	test('clicking an attachable chat queues its workspace-relative path', () => {
		renderChips([
			closedChat(
				'tab-5',
				'Trim the bundle',
				`${WORKSPACE_CWD}/.context/sessions/tab-5.md`,
			),
		]);

		fireEvent.click(screen.getByRole('button', { name: /Trim the bundle/ }));

		expect(queuedEntries()).toEqual([
			'transcript:tab-5|.context/sessions/tab-5.md',
		]);
	});
});
