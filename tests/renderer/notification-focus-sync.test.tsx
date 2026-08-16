// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { matches, navigate, onFocusChatRequested } = vi.hoisted(() => ({
	matches: { current: [] as { routeId: string }[] },
	navigate: vi.fn(),
	onFocusChatRequested: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useMatches: ({
		select,
	}: {
		select: (matched: { routeId: string }[]) => boolean;
	}) => select(matches.current),
	useNavigate: () => navigate,
}));

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
	window.ensemblr = { onFocusChatRequested } as never;
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
	onFocusChatRequested.mockReturnValue(unsubscribe);
	mountSync(createStore()).unmount();

	expect(unsubscribe).toHaveBeenCalled();
});
