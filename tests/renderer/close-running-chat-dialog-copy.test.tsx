// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { CloseRunningChatDialog } from '../../src/renderer/components/workbench-shell/conversation-panel/close-running-chat-dialog';
import { renderWithProviders } from './support/dom';

function renderDialog(props: {
	backgroundTaskCount: number;
	isRunningTurn: boolean;
}) {
	return renderWithProviders(
		<CloseRunningChatDialog
			backgroundTaskCount={props.backgroundTaskCount}
			isRunningTurn={props.isRunningTurn}
			onCancel={vi.fn(() => {})}
			onConfirm={vi.fn(() => {})}
			open={true}
		/>,
	);
}

describe('close-running-chat dialog copy', () => {
	test('a running turn alone says only that confirming cancels it', () => {
		renderDialog({ backgroundTaskCount: 0, isRunningTurn: true });

		expect(screen.getByText('Close running chat?')).toBeInTheDocument();
		expect(
			screen.getByText(/stop the current agent session/),
		).toBeInTheDocument();
		expect(screen.queryByText(/background task/)).toBeNull();
	});

	test('background tasks alone get their own title and copy', () => {
		renderDialog({ backgroundTaskCount: 2, isRunningTurn: false });

		expect(
			screen.getByText('Close chat with background tasks?'),
		).toBeInTheDocument();
		expect(
			screen.getByText(/still has 2 background tasks running/),
		).toBeInTheDocument();
	});

	test('a running turn holding background tasks names both losses', () => {
		renderDialog({ backgroundTaskCount: 3, isRunningTurn: true });

		expect(screen.getByText('Close running chat?')).toBeInTheDocument();
		expect(
			screen.getByText(/stop the current agent session/),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Closing also ends the 3 background tasks it left running.',
			),
		).toBeInTheDocument();
	});

	test('the combined sentence pluralizes down to one', () => {
		renderDialog({ backgroundTaskCount: 1, isRunningTurn: true });

		expect(
			screen.getByText(
				'Closing also ends the 1 background task it left running.',
			),
		).toBeInTheDocument();
	});
});
