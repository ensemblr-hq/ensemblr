// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
	useAnswerToolApproval,
	usePendingToolApproval,
	useToolApprovalSync,
} from '@/renderer/state/tool-approval';
import type {
	ToolApprovalClosedBroadcast,
	ToolApprovalRequestedBroadcast,
} from '@/shared/agent-tool-approval';
import { clearEnsemblrApi, installEnsemblrApi } from '../support/dom';

const broadcast = (
	requestId: string,
	agentSessionId: string,
): ToolApprovalRequestedBroadcast => ({
	agentSessionId,
	input: { command: 'ls' },
	requestId,
	toolName: 'Bash',
});

/** Captures the two broadcast listeners so tests can drive main→renderer pushes. */
const installBridge = () => {
	const listeners: {
		closed?: (payload: ToolApprovalClosedBroadcast) => void;
		requested?: (payload: ToolApprovalRequestedBroadcast) => void;
	} = {};
	const agentToolApprovalAnswered = vi.fn().mockResolvedValue(undefined);
	installEnsemblrApi({
		agentToolApprovalAnswered,
		onAgentToolApprovalClosed: (
			listener: (payload: ToolApprovalClosedBroadcast) => void,
		) => {
			listeners.closed = listener;
			return vi.fn();
		},
		onAgentToolApprovalRequested: (
			listener: (payload: ToolApprovalRequestedBroadcast) => void,
		) => {
			listeners.requested = listener;
			return vi.fn();
		},
	});
	return { agentToolApprovalAnswered, listeners };
};

/** One Jotai store shared by every hook in a test, as the app root provides. */
const wrapper = ({ children }: { children: ReactNode }) => (
	<Provider>{children}</Provider>
);

const mountPending = (agentSessionId: string) =>
	renderHook(
		() => {
			useToolApprovalSync();
			return {
				answer: useAnswerToolApproval(),
				pending: usePendingToolApproval(agentSessionId),
			};
		},
		{ wrapper },
	);

afterEach(() => {
	clearEnsemblrApi();
});

test('surfaces a blocked tool call to the chat tab whose session raised it', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');
	expect(result.current.pending).toBeNull();

	act(() => listeners.requested?.(broadcast('req-1', 'session-1')));

	expect(result.current.pending?.requestId).toBe('req-1');
	expect(result.current.pending?.toolName).toBe('Bash');
});

test('leaves another chat tab alone', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-2');

	act(() => listeners.requested?.(broadcast('req-1', 'session-1')));

	expect(result.current.pending).toBeNull();
});

test('clears the card when main withdraws the prompt', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');
	act(() => listeners.requested?.(broadcast('req-1', 'session-1')));

	act(() => listeners.closed?.({ requestId: 'req-1' }));

	expect(result.current.pending).toBeNull();
});

test('answering clears the card and sends the decision', () => {
	const { agentToolApprovalAnswered, listeners } = installBridge();
	const { result } = mountPending('session-1');
	act(() => listeners.requested?.(broadcast('req-1', 'session-1')));

	act(() =>
		result.current.answer({
			agentSessionId: 'session-1',
			decision: { kind: 'allow-for-session' },
			requestId: 'req-1',
		}),
	);

	expect(result.current.pending).toBeNull();
	expect(agentToolApprovalAnswered).toHaveBeenCalledWith({
		agentSessionId: 'session-1',
		decision: { kind: 'allow-for-session' },
		requestId: 'req-1',
	});
});

test('ignores a withdrawal for a prompt this window never held', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');
	act(() => listeners.requested?.(broadcast('req-1', 'session-1')));

	act(() => listeners.closed?.({ requestId: 'req-other' }));

	expect(result.current.pending?.requestId).toBe('req-1');
});
