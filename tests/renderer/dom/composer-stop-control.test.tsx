// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { ComposerControls } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/composer-controls';
import type { ComposerStateApi } from '../../../src/renderer/hooks/workbench-shell/composer/use-composer-state';
import { createComposerShellState } from '../support/composer';
import { renderWithProviders } from '../support/dom';

/**
 * Renders the control row mid-turn with an empty draft, which is the one state
 * that shows Stop rather than Send.
 */
function renderStopControl() {
	const handleStop = vi.fn(() => Promise.resolve());
	const onStop = vi.fn(() => Promise.resolve());
	const composer = {
		...createComposerShellState(),
		isStreaming: true,
		onStop,
	};
	const state = {
		canSend: false,
		followUpQueue: [],
		handleStop,
		handleSubmit: vi.fn(),
		hasContent: false,
		isStreaming: true,
		pending: false,
		queueStalled: false,
		sendIntent: 'send',
	} as unknown as ComposerStateApi;

	renderWithProviders(
		<ComposerControls
			composer={composer}
			modelPickerOpen={false}
			onLinkDirectory={vi.fn()}
			onLinkIssue={vi.fn()}
			onModelPickerOpenChange={vi.fn()}
			pickersDisabled={false}
			state={state}
			workspaceId='workspace-1'
		/>,
	);
	return { handleStop, onStop };
}

describe('the composer stop control', () => {
	test('stops through the composer state, so the queue pauses with the turn', async () => {
		// A stop lowers the streaming flag exactly like a natural finish. Calling the
		// shell's onStop directly skips the hold, and the flush then sends the very
		// messages the user was cutting short.
		const { handleStop, onStop } = renderStopControl();

		await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

		expect(handleStop).toHaveBeenCalledTimes(1);
		expect(onStop).not.toHaveBeenCalled();
	});
});
