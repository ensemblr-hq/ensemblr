import { beforeEach, describe, expect, test, vi } from 'vitest';
import { seedRendererStorage } from '../../src/preload/seed-renderer-storage.ts';
import type { RendererStorageSnapshot } from '../../src/shared/ipc/contracts/renderer-storage.ts';

/**
 * A storage area standing in for the document's own, with a hook for making one
 * write fail the way a quota refusal would.
 * @param failOnKey - Key whose write should throw, if any.
 */
function fakeStorage(failOnKey?: string): Storage {
	const items = new Map<string, string>();
	return {
		clear: () => items.clear(),
		getItem: (key: string) => items.get(key) ?? null,
		key: (index: number) => Array.from(items.keys())[index] ?? null,
		get length() {
			return items.size;
		},
		removeItem: (key: string) => {
			items.delete(key);
		},
		setItem: (key: string, value: string) => {
			if (key === failOnKey) {
				throw new DOMException('quota', 'QuotaExceededError');
			}
			items.set(key, value);
		},
	} as Storage;
}

describe('seedRendererStorage', () => {
	beforeEach(() => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	test('replays the mirror into a document whose storage is empty', () => {
		const storage = fakeStorage();

		const outcome = seedRendererStorage({
			requestSeed: () => ({ entries: { a: '1', b: '2' } }),
			storage,
		});

		expect(outcome).toBe('seeded');
		expect(storage.getItem('a')).toBe('1');
		expect(storage.getItem('b')).toBe('2');
	});

	test('leaves a document that already has storage alone', () => {
		const storage = fakeStorage();
		storage.setItem('mine', 'kept');
		const requestSeed = vi.fn(() => ({ entries: { a: '1' } }));

		expect(seedRendererStorage({ requestSeed, storage })).toBe(
			'already-populated',
		);
		expect(requestSeed).not.toHaveBeenCalled();
		expect(storage.getItem('mine')).toBe('kept');
	});

	test('does nothing when main offers no seed', () => {
		const storage = fakeStorage();

		expect(seedRendererStorage({ requestSeed: () => null, storage })).toBe(
			'no-seed',
		);
		expect(seedRendererStorage({ requestSeed: () => undefined, storage })).toBe(
			'no-seed',
		);
		expect(
			seedRendererStorage({ requestSeed: () => ({ entries: {} }), storage }),
		).toBe('no-seed');
		expect(storage.length).toBe(0);
	});

	// A half-applied seed is the one state that destroys the mirror: main would
	// refuse the snapshot missing those keys for the session, then accept the
	// same reduced storage on the next launch, when no seed is offered. Undoing
	// it leaves the document empty, which is what the seed recognises.
	test('rolls the whole seed back when one write is refused', () => {
		const storage = fakeStorage('c');

		const outcome = seedRendererStorage({
			requestSeed: () => ({ entries: { a: '1', b: '2', c: '3', d: '4' } }),
			storage,
		});

		expect(outcome).toBe('rolled-back');
		expect(storage.length).toBe(0);
	});

	test('reports rather than throws when the storage area is unreachable', () => {
		const storage = {
			get length(): number {
				throw new DOMException('denied', 'SecurityError');
			},
		} as Storage;

		expect(
			seedRendererStorage({
				requestSeed: () => ({ entries: { a: '1' } }) as RendererStorageSnapshot,
				storage,
			}),
		).toBe('unavailable');
	});
});
