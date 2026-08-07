// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { ToolApprovalCard } from '@/renderer/components/tool-approval';
import type { ToolApprovalRequestedBroadcast } from '@/shared/agent-tool-approval';
import { renderWithProviders } from '../support/dom';

const BASH_REQUEST: ToolApprovalRequestedBroadcast = {
	agentSessionId: 'session-1',
	input: { command: 'rm -rf build', description: 'clear the build' },
	requestId: 'req-1',
	toolName: 'Bash',
};

/** Renders the card and returns the decision spy the buttons fire into. */
function renderCard(
	request: ToolApprovalRequestedBroadcast = BASH_REQUEST,
): ReturnType<typeof vi.fn> {
	const onDecide = vi.fn();
	renderWithProviders(
		<ToolApprovalCard onDecide={onDecide} request={request} />,
	);
	return onDecide;
}

test('names the tool and shows the command the user is deciding about', () => {
	renderCard();

	expect(screen.getByLabelText('Tool approval request')).toBeInTheDocument();
	expect(screen.getByText('Bash')).toBeInTheDocument();
	expect(screen.getByText('rm -rf build')).toBeInTheDocument();
	expect(
		screen.getByText('Claude wants to use Bash.', { exact: false }),
	).toBeInTheDocument();
});

test('shows the file path for an edit rather than the first field it finds', () => {
	renderCard({
		agentSessionId: 'session-1',
		input: { file_path: '/tmp/a.ts', replace_all: 'false' },
		requestId: 'req-2',
		toolName: 'Edit',
	});

	expect(screen.getByText('/tmp/a.ts')).toBeInTheDocument();
	expect(screen.getByText('replace_all: false')).toBeInTheDocument();
});

test("prefers Claude Code's own prompt sentence when it supplies one", () => {
	renderCard({
		agentSessionId: 'session-1',
		displayName: 'Read file',
		input: { file_path: '/tmp/a.ts' },
		requestId: 'req-3',
		title: 'Claude wants to read a.ts',
		toolName: 'Read',
	});

	expect(screen.getByText('Claude wants to read a.ts')).toBeInTheDocument();
});

test('allows once', () => {
	const onDecide = renderCard();

	fireEvent.click(screen.getByRole('button', { name: 'Allow' }));

	expect(onDecide).toHaveBeenCalledWith({ kind: 'allow' });
});

test('allows the tool for the rest of the session', () => {
	const onDecide = renderCard();

	fireEvent.click(
		screen.getByRole('button', { name: 'Allow for this session' }),
	);

	expect(onDecide).toHaveBeenCalledWith({ kind: 'allow-for-session' });
});

test('denies', () => {
	const onDecide = renderCard();

	fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

	expect(onDecide).toHaveBeenCalledWith({ kind: 'deny' });
});

test('denies from the dismiss control, so Escape and the X agree', () => {
	const onDecide = renderCard();

	fireEvent.click(screen.getByRole('button', { name: 'Deny tool call' }));

	expect(onDecide).toHaveBeenCalledWith({ kind: 'deny' });
});

test.each([
	['1', { kind: 'allow' }],
	['2', { kind: 'allow-for-session' }],
	['3', { kind: 'deny' }],
	['Escape', { kind: 'deny' }],
])('routes the %s key to its decision', (key, decision) => {
	const onDecide = renderCard();

	fireEvent.keyDown(screen.getByLabelText('Tool approval request'), { key });

	expect(onDecide).toHaveBeenCalledWith(decision);
});

test('leaves a chorded key press to the app', () => {
	const onDecide = renderCard();

	fireEvent.keyDown(screen.getByLabelText('Tool approval request'), {
		key: '1',
		metaKey: true,
	});

	expect(onDecide).not.toHaveBeenCalled();
});

test('announces the pending approval to assistive technology', () => {
	renderCard();

	const announcement = screen.getByRole('status');

	expect(announcement).toHaveAttribute('aria-live', 'assertive');
	expect(announcement).toHaveTextContent(/approval required for bash/i);
});
