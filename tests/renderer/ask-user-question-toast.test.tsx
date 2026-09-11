// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import type { ExternalToast } from 'sonner';
import { beforeEach, expect, test, vi } from 'vitest';

const { toastDismiss, toastWarning } = vi.hoisted(() => ({
	toastDismiss: vi.fn(),
	toastWarning: vi.fn(),
}));

vi.mock('sonner', () => ({
	toast: { dismiss: toastDismiss, warning: toastWarning },
}));

import { useAskUserQuestionToast } from '@/renderer/hooks/ask-user-question/use-ask-user-question-toast';
import { i18n } from '@/renderer/lib/i18n';
import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import {
	activeChatIdentityAtom,
	pendingNotificationFocusAtom,
} from '@/renderer/state/unread';
import type { AskUserQuestionBroadcast } from '@/shared/agent-control';

/** Creates a pending agent question for toast behavior tests. */
function question({
	agentSessionId = 'session-1',
	requestId = 'request-1',
	workspaceId = 'workspace-1',
}: Partial<AskUserQuestionBroadcast> = {}): AskUserQuestionBroadcast {
	return {
		agentSessionId,
		questions: [
			{
				options: [{ label: 'Now' }, { label: 'Later' }],
				question: 'When should the agent proceed?',
			},
		],
		requestId,
		workspaceId,
	};
}

/** Mounts the global toast hook with direct access to its Jotai store. */
function mountToastHook() {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	return { store, ...renderHook(useAskUserQuestionToast, { wrapper }) };
}

beforeEach(() => {
	toastDismiss.mockReset();
	toastWarning.mockReset();
});

test('shows a persistent warning for a question from an offscreen chat', () => {
	const { store } = mountToastHook();
	const pending = question();

	act(() => store.set(pendingAskUserQuestionsAtom, { 'session-1': pending }));

	expect(toastWarning).toHaveBeenCalledWith(
		'Agent needs your input',
		expect.objectContaining({
			closeButton: true,
			description: 'When should the agent proceed?',
			duration: Number.POSITIVE_INFINITY,
			id: 'ask-user-question:request-1',
		}),
	);
});

test.each([
	{
		language: 'ru',
		title: 'Агенту нужен ваш ответ',
		label: 'Открыть чат',
	},
	{
		language: 'el',
		title: 'Ο πράκτορας χρειάζεται την απάντησή σας',
		label: 'Άνοιξε τη συνομιλία',
	},
])(
	'updates a visible toast in place when switching to $language',
	async ({ language, title, label }) => {
		const { store } = mountToastHook();
		act(() =>
			store.set(pendingAskUserQuestionsAtom, { 'session-1': question() }),
		);

		await act(async () => {
			await i18n.changeLanguage(language);
		});

		expect(toastWarning).toHaveBeenCalledTimes(2);
		expect(toastWarning).toHaveBeenLastCalledWith(
			title,
			expect.objectContaining({
				id: 'ask-user-question:request-1',
				action: expect.objectContaining({ label }),
			}),
		);
		expect(toastDismiss).not.toHaveBeenCalled();
	},
);

test('does not toast a question already visible in the exact chat', () => {
	const { store } = mountToastHook();
	store.set(activeChatIdentityAtom, {
		agentSessionId: 'session-1',
		chatTabId: 'tab-1',
		workspaceId: 'workspace-1',
	});

	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);

	expect(toastWarning).not.toHaveBeenCalled();
});

test.each([
	{
		active: {
			agentSessionId: 'session-2',
			chatTabId: 'tab-2',
			workspaceId: 'workspace-1',
		},
		caseName: 'another chat in the same workspace',
	},
	{
		active: {
			agentSessionId: 'session-1',
			chatTabId: 'tab-1',
			workspaceId: 'workspace-2',
		},
		caseName: 'the same session identity in another workspace',
	},
	{ active: null, caseName: 'a route with no active chat' },
])('toasts while viewing $caseName', ({ active }) => {
	const { store } = mountToastHook();
	store.set(activeChatIdentityAtom, active);

	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);

	expect(toastWarning).toHaveBeenCalledTimes(1);
});

test('focus action parks navigation and stays dismissed across language changes', async () => {
	const { store } = mountToastHook();
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);
	const options = toastWarning.mock.calls[0]?.[1] as ExternalToast;
	const action = options.action as {
		onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	};

	act(() => action.onClick({} as React.MouseEvent<HTMLButtonElement>));

	expect(store.get(pendingNotificationFocusAtom)).toEqual({
		agentSessionId: 'session-1',
		chatTabId: null,
		workspaceId: 'workspace-1',
	});

	await act(async () => {
		await i18n.changeLanguage('ru');
	});

	expect(toastWarning).toHaveBeenCalledTimes(1);
});

test('does not revive a manually dismissed toast when the language changes', async () => {
	const { store } = mountToastHook();
	act(() =>
		store.set(pendingAskUserQuestionsAtom, { 'session-1': question() }),
	);
	const options = toastWarning.mock.calls[0]?.[1] as ExternalToast;

	act(() => options.onDismiss?.({ id: 'ask-user-question:request-1' }));
	await act(async () => {
		await i18n.changeLanguage('el');
	});

	expect(toastWarning).toHaveBeenCalledTimes(1);
});

test('dismisses a shown toast when its chat is opened', () => {
	const { store } = mountToastHook();
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);

	act(() =>
		store.set(activeChatIdentityAtom, {
			agentSessionId: 'session-1',
			chatTabId: 'tab-1',
			workspaceId: 'workspace-1',
		}),
	);

	expect(toastDismiss).toHaveBeenCalledWith('ask-user-question:request-1');
});

test('dismisses a shown toast when its question is resolved', () => {
	const { store } = mountToastHook();
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);

	act(() => store.set(pendingAskUserQuestionsAtom, {}));

	expect(toastDismiss).toHaveBeenCalledWith('ask-user-question:request-1');
});

test('never notifies for a Concierge question', () => {
	const { store } = mountToastHook();
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			concierge: question({ workspaceId: '' }),
		}),
	);

	expect(toastWarning).not.toHaveBeenCalled();
});

test('does not notify later for a request first seen in its focused chat', () => {
	const { store } = mountToastHook();
	store.set(activeChatIdentityAtom, {
		agentSessionId: 'session-1',
		chatTabId: 'tab-1',
		workspaceId: 'workspace-1',
	});
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);

	act(() => store.set(activeChatIdentityAtom, null));

	expect(toastWarning).not.toHaveBeenCalled();
});

test('shows each request once and supports simultaneous questions', () => {
	const { store } = mountToastHook();
	const first = question();
	const second = question({
		agentSessionId: 'session-2',
		requestId: 'request-2',
		workspaceId: 'workspace-2',
	});
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': first,
			'session-2': second,
		}),
	);
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': first,
			'session-2': second,
		}),
	);

	expect(toastWarning).toHaveBeenCalledTimes(2);
	expect(toastWarning.mock.calls.map((call) => call[1]?.id)).toEqual([
		'ask-user-question:request-1',
		'ask-user-question:request-2',
	]);
});

test('keeps a restored question visible through StrictMode effect replay', () => {
	const store = createStore();
	store.set(pendingAskUserQuestionsAtom, { 'session-1': question() });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);

	renderHook(useAskUserQuestionToast, { reactStrictMode: true, wrapper });

	const lastWarning = toastWarning.mock.invocationCallOrder.at(-1);
	const lastDismiss = toastDismiss.mock.invocationCallOrder.at(-1);
	expect(lastWarning).toBeGreaterThan(lastDismiss ?? 0);
});

test('dismisses every shown toast when the root hook unmounts', () => {
	const { store, unmount } = mountToastHook();
	act(() =>
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': question(),
		}),
	);

	unmount();

	expect(toastDismiss).toHaveBeenCalledWith('ask-user-question:request-1');
});
