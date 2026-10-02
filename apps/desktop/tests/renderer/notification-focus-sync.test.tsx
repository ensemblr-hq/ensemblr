// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { matches, navigate, onFocusChatRequested, onFocusConciergeRequested } =
	vi.hoisted(() => ({
		matches: { current: [] as { routeId: string }[] },
		navigate: vi.fn(),
		onFocusChatRequested: vi.fn(),
		onFocusConciergeRequested: vi.fn(),
	}));

vi.mock('@tanstack/react-router', () => ({
	useMatches: ({
		select,
	}: {
		select: (matched: { routeId: string }[]) => boolean;
	}) => select(matches.current),
	useNavigate: () => navigate,
}));

import { conciergePresentationAtom } from '../../src/renderer/state/concierge';
import {
	pendingNotificationFocusAtom,
	useNotificationFocusSync,
} from '../../src/renderer/state/unread';
import type { FocusChatBroadcast } from '../../src/shared/ipc/contracts/notifications';

/** Host component whose only job is to run the hook under test. */
function Host() {
	useNotificationFocusSync();
	return null;
}

/** Renders the hook under a store the case can read the parked request from. */
function mountSync(store: ReturnType<typeof createStore>) {
	const tree = () => (
		<Provider store={store}>
			<Host />
		</Provider>
	);
	const view = render(tree());
	return {
		click: onFocusChatRequested.mock.calls[0][0] as (
			payload: FocusChatBroadcast,
		) => void,
		clickConcierge: onFocusConciergeRequested.mock.calls[0][0] as () => void,
		rerender: () => view.rerender(tree()),
		unmount: () => view.unmount(),
	};
}

const payload: FocusChatBroadcast = {
	agentSessionId: 'session-7',
	chatTabId: 'tab-7',
	workspaceId: 'workspace-7',
};

beforeEach(() => {
	matches.current = [{ routeId: '/_workbench/_shell' }];
	navigate.mockReset();
	onFocusChatRequested.mockReset();
	onFocusChatRequested.mockReturnValue(() => undefined);
	onFocusConciergeRequested.mockReset();
	onFocusConciergeRequested.mockReturnValue(() => undefined);
	window.ensemblr = {
		onFocusChatRequested,
		onFocusConciergeRequested,
	} as never;
});

test('parks the chat a clicked notification names', async () => {
	const store = createStore();
	const { click } = mountSync(store);
	await act(async () => {
		click(payload);
	});

	expect(store.get(pendingNotificationFocusAtom)).toEqual(payload);
	expect(navigate).not.toHaveBeenCalled();
});

test('returns to the shell when the click lands outside it', async () => {
	matches.current = [{ routeId: '/_workbench/settings' }];
	const store = createStore();
	const { click } = mountSync(store);
	await act(async () => {
		click(payload);
	});

	expect(navigate).toHaveBeenCalledWith({ to: '/' });
	expect(store.get(pendingNotificationFocusAtom)).toEqual(payload);
});

test('pushes back to the shell when the window leaves it still parked', async () => {
	const store = createStore();
	const { click, rerender } = mountSync(store);
	await act(async () => {
		click(payload);
	});
	expect(navigate).not.toHaveBeenCalled();

	matches.current = [{ routeId: '/_workbench/settings' }];
	await act(async () => {
		rerender();
	});

	expect(navigate).toHaveBeenCalledWith({ to: '/' });
});

test('unsubscribes on unmount', () => {
	const unsubscribe = vi.fn();
	const unsubscribeConcierge = vi.fn();
	onFocusChatRequested.mockReturnValue(unsubscribe);
	onFocusConciergeRequested.mockReturnValue(unsubscribeConcierge);
	mountSync(createStore()).unmount();

	expect(unsubscribe).toHaveBeenCalled();
	expect(unsubscribeConcierge).toHaveBeenCalled();
});

test('opens the panel a clicked Concierge notification is about', async () => {
	const store = createStore();
	const { clickConcierge } = mountSync(store);
	await act(async () => {
		clickConcierge();
	});

	expect(store.get(conciergePresentationAtom)).toBe('panel');
	expect(navigate).not.toHaveBeenCalled();
});

test('returns to the shell when a Concierge click lands outside it', async () => {
	matches.current = [{ routeId: '/_workbench/settings' }];
	const store = createStore();
	const { clickConcierge } = mountSync(store);
	await act(async () => {
		clickConcierge();
	});

	expect(navigate).toHaveBeenCalledWith({ to: '/' });
	expect(store.get(conciergePresentationAtom)).toBe('panel');
});

test('stops asking to return once the shell is back', async () => {
	matches.current = [{ routeId: '/_workbench/settings' }];
	const store = createStore();
	const { clickConcierge, rerender } = mountSync(store);
	await act(async () => {
		clickConcierge();
	});
	navigate.mockReset();

	matches.current = [{ routeId: '/_workbench/_shell' }];
	await act(async () => {
		rerender();
	});
	matches.current = [{ routeId: '/_workbench/settings' }];
	await act(async () => {
		rerender();
	});

	expect(navigate).not.toHaveBeenCalled();
});
