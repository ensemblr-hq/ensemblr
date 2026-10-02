// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
	useAnswerUserQuestion,
	useAskUserQuestionSync,
	usePendingAskUserQuestion,
} from '@/renderer/state/ask-user-question';
import type {
	AskUserQuestionBroadcast,
	AskUserQuestionClosedBroadcast,
} from '@/shared/agent-control';
import { clearEnsemblrApi, installEnsemblrApi } from '../support/dom';

const broadcast = (
	requestId: string,
	agentSessionId: string,
): AskUserQuestionBroadcast => ({
	agentSessionId,
	questions: [
		{ options: [{ label: 'Yes' }, { label: 'No' }], question: 'Proceed?' },
	],
	requestId,
	workspaceId: 'ws-1',
});

/** Captures the two broadcast listeners so tests can drive main→renderer pushes. */
const installBridge = () => {
	const listeners: {
		ask?: (payload: AskUserQuestionBroadcast) => void;
		closed?: (payload: AskUserQuestionClosedBroadcast) => void;
	} = {};
	const answerUserQuestion = vi.fn().mockResolvedValue(undefined);
	const unsubscribeAsk = vi.fn();
	const unsubscribeClosed = vi.fn();
	installEnsemblrApi({
		answerUserQuestion,
		onAskUserQuestion: (listener: (p: AskUserQuestionBroadcast) => void) => {
			listeners.ask = listener;
			return unsubscribeAsk;
		},
		onAskUserQuestionClosed: (
			listener: (p: AskUserQuestionClosedBroadcast) => void,
		) => {
			listeners.closed = listener;
			return unsubscribeClosed;
		},
	});
	return { answerUserQuestion, listeners, unsubscribeAsk, unsubscribeClosed };
};

/** One Jotai store shared by every hook in a test, as the app root provides. */
const wrapper = ({ children }: { children: ReactNode }) => (
	<Provider>{children}</Provider>
);

const mountPending = (agentSessionId: string) =>
	renderHook(
		() => {
			useAskUserQuestionSync();
			return {
				answer: useAnswerUserQuestion(),
				pending: usePendingAskUserQuestion(agentSessionId),
			};
		},
		{ wrapper },
	);

afterEach(() => {
	clearEnsemblrApi();
});

test('surfaces a broadcast question to the chat tab that asked it', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');
	expect(result.current.pending).toBeNull();

	act(() => listeners.ask?.(broadcast('req-1', 'session-1')));
	expect(result.current.pending?.requestId).toBe('req-1');
});

test('hides a question from chat tabs that did not ask it', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-2');

	act(() => listeners.ask?.(broadcast('req-1', 'session-1')));
	expect(result.current.pending).toBeNull();
});

test('holds questions for several sessions at once', () => {
	const { listeners } = installBridge();
	const { result } = renderHook(
		() => {
			useAskUserQuestionSync();
			return {
				one: usePendingAskUserQuestion('session-1'),
				two: usePendingAskUserQuestion('session-2'),
			};
		},
		{ wrapper },
	);

	act(() => listeners.ask?.(broadcast('req-1', 'session-1')));
	act(() => listeners.ask?.(broadcast('req-2', 'session-2')));
	expect(result.current.one?.requestId).toBe('req-1');
	expect(result.current.two?.requestId).toBe('req-2');
});

test('drops a question the main process withdrew', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');

	act(() => listeners.ask?.(broadcast('req-1', 'session-1')));
	act(() => listeners.closed?.({ requestId: 'req-1' }));
	expect(result.current.pending).toBeNull();
});

test('ignores a withdrawal for a request that is not pending', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');

	act(() => listeners.ask?.(broadcast('req-1', 'session-1')));
	act(() => listeners.closed?.({ requestId: 'other' }));
	expect(result.current.pending?.requestId).toBe('req-1');
});

test('answering clears the dialog and forwards answers without a summary', () => {
	const { answerUserQuestion, listeners } = installBridge();
	const { result } = mountPending('session-1');
	act(() => listeners.ask?.(broadcast('req-1', 'session-1')));

	act(() =>
		result.current.answer({
			answers: [
				{
					answer: 'Yes',
					kind: 'option',
					question: 'Proceed?',
					questionIndex: 0,
				},
			],
			cancelled: false,
			requestId: 'req-1',
		}),
	);

	expect(result.current.pending).toBeNull();
	expect(answerUserQuestion).toHaveBeenCalledWith({
		answers: [expect.objectContaining({ answer: 'Yes' })],
		cancelled: false,
		requestId: 'req-1',
	});
});

test('unsubscribes from both channels on unmount', () => {
	const { unsubscribeAsk, unsubscribeClosed } = installBridge();
	mountPending('session-1').unmount();
	expect(unsubscribeAsk).toHaveBeenCalledTimes(1);
	expect(unsubscribeClosed).toHaveBeenCalledTimes(1);
});
