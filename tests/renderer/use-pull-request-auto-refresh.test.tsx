// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { usePullRequestAutoRefresh } from '../../src/renderer/hooks/workbench-shell/route-layout/use-pull-request-auto-refresh';
import type { PiPersistedEnvelope } from '../../src/shared/ipc/contracts/pi-message-payloads';
import type { PiSessionEventBroadcast } from '../../src/shared/ipc/contracts/pi-session';
import { createTestQueryClient } from './support/dom';

const mocks = vi.hoisted(() => ({
	listener: null as ((event: PiSessionEventBroadcast) => void) | null,
	refreshPullRequestSnapshot: vi.fn(() => Promise.resolve()),
	refreshPullRequestSnapshotUntilPresent: vi.fn(() => Promise.resolve()),
	unsubscribe: vi.fn(),
}));

vi.mock('../../src/renderer/api/ensemblr-queries', () => ({
	refreshPullRequestSnapshot: mocks.refreshPullRequestSnapshot,
	refreshPullRequestSnapshotUntilPresent:
		mocks.refreshPullRequestSnapshotUntilPresent,
	subscribePiSessionEvents: (
		listener: (event: PiSessionEventBroadcast) => void,
	) => {
		mocks.listener = listener;
		return mocks.unsubscribe;
	},
}));

/** Wraps a persisted envelope in a broadcast for the given workspace. */
function broadcast(
	payload: PiPersistedEnvelope | null,
	workspaceId = 'ws-1',
): PiSessionEventBroadcast {
	return {
		event: {
			branchId: 'b1',
			createdAt: '2026-07-11T00:00:00Z',
			eventType: 'message',
			id: 'e1',
			ordinal: 1,
			payload,
			stream: 'protocol',
			turnId: 't1',
		},
		sessionId: 's1',
		workspaceId,
	};
}

/** A `gh pr create` tool-call envelope. */
const PR_CREATE_CALL: PiPersistedEnvelope = {
	kind: 'message',
	payload: {
		input: { command: 'gh pr create --fill' },
		kind: 'tool-call',
		name: 'Bash',
		toolCallId: 'c1',
	},
	role: 'tool',
};

/** A tool-result envelope carrying the created PR URL. */
const PR_URL_RESULT: PiPersistedEnvelope = {
	kind: 'message',
	payload: {
		isError: false,
		kind: 'tool-result',
		output: 'https://github.com/acme/app/pull/42',
		toolCallId: 'c1',
	},
	role: 'tool',
};

/** A status envelope for a streaming→idle turn end. */
const TURN_END: PiPersistedEnvelope = {
	kind: 'status',
	previous: 'streaming',
	status: 'idle',
};

/** A turn-start status envelope. */
const TURN_START: PiPersistedEnvelope = {
	kind: 'status',
	previous: 'idle',
	status: 'streaming',
};

beforeEach(() => {
	mocks.listener = null;
	mocks.refreshPullRequestSnapshot.mockClear();
	mocks.refreshPullRequestSnapshotUntilPresent.mockClear();
	mocks.unsubscribe.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Renders the hook with a fresh client and a provider wrapper. */
function renderAutoRefresh() {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			usePullRequestAutoRefresh({
				workspaceCwd: '/repo',
				workspaceId: 'ws-1',
			}),
		{ wrapper },
	);
}

test('fires a plain refresh at turn end when no PR was created', async () => {
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(TURN_END));
	});

	expect(mocks.refreshPullRequestSnapshot).toHaveBeenCalledTimes(1);
	expect(mocks.refreshPullRequestSnapshotUntilPresent).not.toHaveBeenCalled();
});

test('retries until present when the turn created a PR', async () => {
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(PR_CREATE_CALL));
		mocks.listener?.(broadcast(TURN_END));
	});

	expect(mocks.refreshPullRequestSnapshotUntilPresent).toHaveBeenCalledTimes(1);
	expect(mocks.refreshPullRequestSnapshot).not.toHaveBeenCalled();
});

test('retries immediately when the tool result carries the PR URL', async () => {
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(PR_URL_RESULT));
	});

	expect(mocks.refreshPullRequestSnapshotUntilPresent).toHaveBeenCalledTimes(1);
	expect(mocks.refreshPullRequestSnapshot).not.toHaveBeenCalled();
});

test('a turn start clears a prior PR-created signal', async () => {
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(PR_CREATE_CALL));
		mocks.listener?.(broadcast(TURN_START));
		mocks.listener?.(broadcast(TURN_END));
	});

	expect(mocks.refreshPullRequestSnapshot).toHaveBeenCalledTimes(1);
	expect(mocks.refreshPullRequestSnapshotUntilPresent).not.toHaveBeenCalled();
});

test('ignores broadcasts for other workspaces', async () => {
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(TURN_END, 'other-ws'));
	});

	expect(mocks.refreshPullRequestSnapshot).not.toHaveBeenCalled();
});

test('coalesces overlapping turn ends while a refresh is in flight', async () => {
	let resolveRefresh: (() => void) | null = null;
	mocks.refreshPullRequestSnapshot.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				resolveRefresh = resolve;
			}),
	);
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(TURN_END));
		mocks.listener?.(broadcast(TURN_END));
	});
	expect(mocks.refreshPullRequestSnapshot).toHaveBeenCalledTimes(1);

	act(() => {
		resolveRefresh?.();
	});
	await waitFor(() =>
		expect(mocks.refreshPullRequestSnapshot).toHaveBeenCalledTimes(1),
	);
});

test('does not drop a created-PR refresh while a plain refresh is in flight', async () => {
	let resolveRefresh: (() => void) | null = null;
	mocks.refreshPullRequestSnapshot.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				resolveRefresh = resolve;
			}),
	);
	renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	act(() => {
		mocks.listener?.(broadcast(TURN_END));
		mocks.listener?.(broadcast(PR_URL_RESULT));
	});

	expect(mocks.refreshPullRequestSnapshot).toHaveBeenCalledTimes(1);
	expect(mocks.refreshPullRequestSnapshotUntilPresent).toHaveBeenCalledTimes(1);

	act(() => {
		resolveRefresh?.();
	});
});

test('unsubscribes on unmount', async () => {
	const { unmount } = renderAutoRefresh();
	await waitFor(() => expect(mocks.listener).not.toBeNull());

	unmount();

	expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
