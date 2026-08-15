// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { emitTerminalInput } from '../../src/renderer/lib/terminal';
import {
	activeTerminalIdsAtom,
	terminalActivitySnapshotsAtom,
	useWatchTerminalActivity,
} from '../../src/renderer/state/workspace';
import type {
	ListTerminalSessionsResult,
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
	TerminalSessionSnapshot,
} from '../../src/shared/ipc';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

function createSession(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: '/bin/zsh',
		createdAt: '2026-08-15T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		harnessSessionId: null,
		id: 'terminal-1',
		kind: 'terminal',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		status: 'running',
		title: 'Terminal',
		titleIsDefault: false,
		workspaceId: 'workspace-1',
		...overrides,
	};
}

function runScript(
	id: string,
	overrides: Partial<TerminalSessionSnapshot> = {},
) {
	return createSession({ id, kind: 'run-script', ...overrides });
}

/**
 * A `window.ensemblr` stub whose session listing settles on demand, so a test
 * can drive the window between asking for it and its reply.
 */
function installTestBridge() {
	const lifecycleListeners = new Set<
		(event: TerminalLifecycleBroadcast) => void
	>();
	const outputListeners = new Set<(event: TerminalOutputBroadcast) => void>();
	let settleListing: (result: ListTerminalSessionsResult) => void = () => {};
	let listing = new Promise<ListTerminalSessionsResult>((resolve) => {
		settleListing = resolve;
	});

	installEnsemblrApi({
		listTerminalSessions: () => listing,
		onTerminalLifecycle: (
			listener: (e: TerminalLifecycleBroadcast) => void,
		) => {
			lifecycleListeners.add(listener);
			return () => lifecycleListeners.delete(listener);
		},
		onTerminalOutput: (listener: (e: TerminalOutputBroadcast) => void) => {
			outputListeners.add(listener);
			return () => outputListeners.delete(listener);
		},
	});

	return {
		armNextListing() {
			listing = new Promise<ListTerminalSessionsResult>((resolve) => {
				settleListing = resolve;
			});
		},
		emitLifecycle(session: TerminalSessionSnapshot) {
			for (const listener of lifecycleListeners) {
				listener({
					session,
					terminalId: session.id,
					workspaceId: session.workspaceId,
				});
			}
		},
		emitOutput(terminalId: string) {
			for (const listener of outputListeners) {
				listener({
					data: 'out',
					seq: 1,
					terminalId,
					workspaceId: 'workspace-1',
				});
			}
		},
		settleListing(sessions: TerminalSessionSnapshot[]) {
			settleListing({ sessions });
		},
	};
}

function createWrapper(store: ReturnType<typeof createStore>) {
	return ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
}

afterEach(() => {
	clearEnsemblrApi();
	vi.useRealTimers();
});

test('a remount re-seeds from the listing instead of keeping stale entries', async () => {
	const store = createStore();
	const bridge = installTestBridge();
	const wrapper = createWrapper(store);

	const first = renderHook(() => useWatchTerminalActivity(), { wrapper });
	await act(async () => {
		bridge.settleListing([runScript('run-1')]);
	});
	expect(Object.keys(store.get(terminalActivitySnapshotsAtom))).toEqual([
		'run-1',
	]);

	// The exit broadcast lands while no watcher is subscribed, so only the next
	// listing can report that the script is gone.
	first.unmount();
	bridge.armNextListing();

	const second = renderHook(() => useWatchTerminalActivity(), { wrapper });
	await act(async () => {
		bridge.settleListing([]);
	});

	expect(store.get(terminalActivitySnapshotsAtom)).toEqual({});
	second.unmount();
});

test('a session that starts while the listing is in flight survives the seed', async () => {
	const store = createStore();
	const bridge = installTestBridge();

	const view = renderHook(() => useWatchTerminalActivity(), {
		wrapper: createWrapper(store),
	});
	act(() => {
		bridge.emitLifecycle(runScript('run-2'));
	});
	await act(async () => {
		bridge.settleListing([runScript('run-1')]);
	});

	expect(Object.keys(store.get(terminalActivitySnapshotsAtom)).sort()).toEqual([
		'run-1',
		'run-2',
	]);
	view.unmount();
});

test('a session that ends while the listing is in flight is not resurrected', async () => {
	const store = createStore();
	const bridge = installTestBridge();

	const view = renderHook(() => useWatchTerminalActivity(), {
		wrapper: createWrapper(store),
	});
	act(() => {
		bridge.emitLifecycle(runScript('run-1', { status: 'exited' }));
	});
	await act(async () => {
		bridge.settleListing([runScript('run-1')]);
	});

	expect(store.get(terminalActivitySnapshotsAtom)).toEqual({});
	view.unmount();
});

test('teardown clears the shared active-terminal set', async () => {
	const store = createStore();
	const bridge = installTestBridge();

	const view = renderHook(() => useWatchTerminalActivity(), {
		wrapper: createWrapper(store),
	});
	await act(async () => {
		bridge.settleListing([createSession()]);
	});
	act(() => {
		emitTerminalInput({ data: 'ls\r', terminalId: 'terminal-1' });
		bridge.emitOutput('terminal-1');
	});
	expect(store.get(activeTerminalIdsAtom).has('terminal-1')).toBe(true);

	view.unmount();

	expect(store.get(activeTerminalIdsAtom).size).toBe(0);
});

test('an exited session stops counting as activity', async () => {
	const store = createStore();
	const bridge = installTestBridge();

	const view = renderHook(() => useWatchTerminalActivity(), {
		wrapper: createWrapper(store),
	});
	await act(async () => {
		bridge.settleListing([createSession()]);
	});
	act(() => {
		emitTerminalInput({ data: 'ls\r', terminalId: 'terminal-1' });
		bridge.emitOutput('terminal-1');
		bridge.emitLifecycle(createSession({ status: 'exited' }));
	});
	expect(store.get(activeTerminalIdsAtom).size).toBe(0);

	act(() => {
		bridge.emitOutput('terminal-1');
	});

	expect(store.get(activeTerminalIdsAtom).size).toBe(0);
	view.unmount();
});

test('activity retires once output has been quiet for the idle window', () => {
	vi.useFakeTimers();
	const store = createStore();
	const bridge = installTestBridge();

	const view = renderHook(() => useWatchTerminalActivity(), {
		wrapper: createWrapper(store),
	});
	act(() => {
		emitTerminalInput({ data: 'ls\r', terminalId: 'terminal-1' });
		bridge.emitOutput('terminal-1');
	});
	expect(store.get(activeTerminalIdsAtom).has('terminal-1')).toBe(true);

	act(() => {
		vi.advanceTimersByTime(1600);
	});

	expect(store.get(activeTerminalIdsAtom).size).toBe(0);
	view.unmount();
});
