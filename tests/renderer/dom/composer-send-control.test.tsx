// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { ComposerControls } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/composer-controls';
import type { ComposerStateApi } from '../../../src/renderer/hooks/workbench-shell/composer/use-composer-state';
import type { ComposerSendIntent } from '../../../src/renderer/types/workbench';
import { formatShortcut } from '../../../src/shared/keymap';
import { createComposerShellState } from '../support/composer';
import { renderWithProviders } from '../support/dom';

/**
 * Renders the control row mid-turn with a draft in the box, which is the state
 * that shows Send rather than Stop.
 */
function renderSendControl(sendIntent: ComposerSendIntent) {
	const handleSubmit = vi.fn();
	const sendNow = vi.fn();
	const composer = {
		...createComposerShellState(),
		isStreaming: true,
	};
	const state = {
		canSend: true,
		followUpQueue: [],
		handleStop: vi.fn(() => Promise.resolve()),
		handleSubmit,
		hasContent: true,
		isStreaming: true,
		pending: false,
		queueStalled: false,
		sendIntent,
		sendNow,
	} as unknown as ComposerStateApi;

	renderWithProviders(
		<ComposerControls
			composer={composer}
			dictation={{
				available: false,
				elapsedMs: 0,
				failure: null,
				phase: 'idle',
				toggle: vi.fn(),
			}}
			modelPickerOpen={false}
			onLinkDirectory={vi.fn()}
			onLinkIssue={vi.fn()}
			onModelPickerOpenChange={vi.fn()}
			pickersDisabled={false}
			state={state}
			workspaceId='workspace-1'
		/>,
	);
	return {
		handleSubmit,
		sendButton: screen.getByRole('button', { name: 'Send' }),
		sendNow,
	};
}

describe('the composer send control', () => {
	test('a plain click follows the Follow-up behavior', () => {
		const { handleSubmit, sendButton, sendNow } = renderSendControl('queue');

		fireEvent.click(sendButton);

		expect(handleSubmit).toHaveBeenCalledTimes(1);
		expect(sendNow).not.toHaveBeenCalled();
	});

	test('a shift-click sends now, steering past the queue', () => {
		const { handleSubmit, sendButton, sendNow } = renderSendControl('queue');

		fireEvent.click(sendButton, { shiftKey: true });

		expect(sendNow).toHaveBeenCalledTimes(1);
		expect(handleSubmit).not.toHaveBeenCalled();
	});

	test.each(['queue', 'hold'] as const)(
		'names the shift-click in the tooltip while a click would %s',
		async (intent) => {
			const { sendButton } = renderSendControl(intent);

			await userEvent.hover(sendButton);

			expect(
				(await screen.findAllByText('Shift-click to steer now')).at(0),
			).toBeVisible();
			expect(
				(await screen.findAllByText(formatShortcut('composer.sendNow'))).at(0),
			).toBeVisible();
		},
	);

	test('leaves the shift-click out of the tooltip when a click already sends', async () => {
		const { sendButton } = renderSendControl('send');

		await userEvent.hover(sendButton);

		expect((await screen.findAllByText('Send message')).at(0)).toBeVisible();
		expect(screen.queryByText('Shift-click to steer now')).toBeNull();
	});
});
