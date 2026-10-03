// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ComputeQueueSnapshot } from '../../src/shared/compute-queue';
import type { ComputeQueueChangedBroadcast } from '../../src/shared/ipc/contracts/compute-queue';

let changeListener: ((event: ComputeQueueChangedBroadcast) => void) | null =
	null;
const unsubscribe = vi.fn();
const readSnapshot = vi.fn<() => Promise<ComputeQueueSnapshot>>();

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/renderer/api/ensemblr')>();
	return {
		...actual,
		readComputeQueueSnapshot: () => readSnapshot(),
		subscribeComputeQueueChanged: (
			listener: (event: ComputeQueueChangedBroadcast) => void,
		) => {
			changeListener = listener;
			return unsubscribe;
		},
	};
});

const { computeQueueSnapshotAtom, useComputeQueueSync } = await import(
	'../../src/renderer/state/compute-queue'
);

/** Builds an empty snapshot distinguished by its slot count. */
function snapshot(slots: number): ComputeQueueSnapshot {
	return { enabled: true, inUse: 0, jobs: [], slots };
}

/** Mounts the sync hook against a fresh store and returns the store. */
function mountSync() {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const view = renderHook(() => useComputeQueueSync(), { wrapper });
	return { store, view };
}

beforeEach(() => {
	changeListener = null;
	unsubscribe.mockClear();
	readSnapshot.mockReset();
});

test('applies the initial read when no broadcast has arrived', async () => {
	readSnapshot.mockResolvedValue(snapshot(2));

	const { store } = mountSync();
	await act(async () => {
		await Promise.resolve();
	});

	expect(store.get(computeQueueSnapshotAtom)).toEqual(snapshot(2));
});

test('a broadcast that lands before the read resolves wins over it', async () => {
	let resolveRead: (value: ComputeQueueSnapshot) => void = () => undefined;
	readSnapshot.mockReturnValue(
		new Promise<ComputeQueueSnapshot>((resolve) => {
			resolveRead = resolve;
		}),
	);

	const { store } = mountSync();
	act(() => changeListener?.({ snapshot: snapshot(4) }));
	await act(async () => {
		resolveRead(snapshot(2));
		await Promise.resolve();
	});

	expect(store.get(computeQueueSnapshotAtom)).toEqual(snapshot(4));
});

test('logs a failed read instead of swallowing it', async () => {
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	readSnapshot.mockRejectedValue(new Error('ipc down'));

	const { store } = mountSync();
	await act(async () => {
		await Promise.resolve();
	});

	expect(store.get(computeQueueSnapshotAtom)).toBeNull();
	expect(error).toHaveBeenCalled();
	error.mockRestore();
});

test('unsubscribes when the hook unmounts', () => {
	readSnapshot.mockResolvedValue(snapshot(2));

	const { view } = mountSync();
	view.unmount();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});
