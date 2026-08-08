import { describe, expect, test } from 'vitest';

import {
	clearCachedSlashCommands,
	hasCachedSlashCommands,
	readCachedSlashCommands,
	SLASH_COMMANDS_CACHE_KEY,
	SLASH_COMMANDS_CACHE_VERSION,
	writeCachedSlashCommands,
} from '../../src/renderer/api/ensemblr/slash-commands-cache';
import type { AgentProviderSlashCommandWire } from '../../src/shared/ipc/contracts/agent-provider';

/** Minimal Map-backed Storage for deterministic, DOM-free tests. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(initial));
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => {
			map.delete(k);
		},
		setItem: (k, v) => {
			map.set(k, v);
		},
	} satisfies Storage;
}

/** Storage whose writes always fail, standing in for an exhausted quota. */
function throwingStorage(): Storage {
	return {
		...fakeStorage(),
		setItem: () => {
			throw new Error('QuotaExceededError');
		},
	} satisfies Storage;
}

const COMMANDS: AgentProviderSlashCommandWire[] = [
	{ autoSubmit: false, command: 'code-review', description: 'Review' },
	{ autoSubmit: true, command: 'clear', description: 'Clear' },
];

describe('slash-commands-cache', () => {
	test('round-trips a catalogue for one runtime and workspace', () => {
		const store = fakeStorage();
		writeCachedSlashCommands('claude', '/w/demo', COMMANDS, 1_000, store);
		expect(readCachedSlashCommands('claude', '/w/demo', store)).toEqual({
			commands: COMMANDS,
			fetchedAt: 1_000,
		});
	});

	test('keeps runtimes and workspaces apart', () => {
		const store = fakeStorage();
		writeCachedSlashCommands('claude', '/w/demo', COMMANDS, 1_000, store);
		expect(readCachedSlashCommands('pi', '/w/demo', store)).toBeUndefined();
		expect(
			readCachedSlashCommands('claude', '/w/other', store),
		).toBeUndefined();
	});

	test('reports no cache when nothing was written', () => {
		expect(hasCachedSlashCommands('claude', '/w/demo', fakeStorage())).toBe(
			false,
		);
	});

	test('never stores an empty catalogue', () => {
		const store = fakeStorage();
		writeCachedSlashCommands('claude', '/w/demo', COMMANDS, 1_000, store);
		writeCachedSlashCommands('claude', '/w/demo', [], 2_000, store);
		expect(readCachedSlashCommands('claude', '/w/demo', store)?.fetchedAt).toBe(
			1_000,
		);
	});

	test('clearing forgets one entry and leaves the others', () => {
		const store = fakeStorage();
		writeCachedSlashCommands('claude', '/w/a', COMMANDS, 1_000, store);
		writeCachedSlashCommands('claude', '/w/b', COMMANDS, 2_000, store);
		clearCachedSlashCommands('claude', '/w/a', store);
		expect(readCachedSlashCommands('claude', '/w/a', store)).toBeUndefined();
		expect(readCachedSlashCommands('claude', '/w/b', store)).toBeDefined();
	});

	test('evicts the least recently fetched workspace past the cap', () => {
		const store = fakeStorage();
		for (let index = 0; index < 9; index += 1) {
			writeCachedSlashCommands(
				'claude',
				`/w/${index}`,
				COMMANDS,
				1_000 + index,
				store,
			);
		}
		expect(readCachedSlashCommands('claude', '/w/0', store)).toBeUndefined();
		expect(readCachedSlashCommands('claude', '/w/8', store)).toBeDefined();
	});

	// The count cap alone does not bound the envelope: one workspace with a huge
	// catalogue would still blow a shared quota, so size evicts too.
	test('evicts past the size budget even when the count cap is not reached', () => {
		const store = fakeStorage();
		const bulky = (index: number): AgentProviderSlashCommandWire[] => [
			{
				autoSubmit: false,
				command: `bulky-${index}`,
				description: 'x'.repeat(200_000),
			},
		];
		for (let index = 0; index < 4; index += 1) {
			writeCachedSlashCommands(
				'claude',
				`/w/${index}`,
				bulky(index),
				1_000 + index,
				store,
			);
		}

		expect(readCachedSlashCommands('claude', '/w/3', store)).toBeDefined();
		expect(readCachedSlashCommands('claude', '/w/2', store)).toBeDefined();
		expect(readCachedSlashCommands('claude', '/w/1', store)).toBeUndefined();
		expect(readCachedSlashCommands('claude', '/w/0', store)).toBeUndefined();
	});

	// A single entry over budget is still kept: dropping it would leave the menu
	// with nothing to paint, and the quota error is already handled.
	test('keeps the newest entry even when it alone exceeds the budget', () => {
		const store = fakeStorage();
		writeCachedSlashCommands(
			'claude',
			'/w/huge',
			[
				{
					autoSubmit: false,
					command: 'huge',
					description: 'x'.repeat(600_000),
				},
			],
			1_000,
			store,
		);

		expect(readCachedSlashCommands('claude', '/w/huge', store)).toBeDefined();
	});

	test('rewriting a workspace promotes it instead of duplicating it', () => {
		const store = fakeStorage();
		writeCachedSlashCommands('claude', '/w/a', COMMANDS, 1_000, store);
		writeCachedSlashCommands('claude', '/w/a', COMMANDS, 2_000, store);
		expect(readCachedSlashCommands('claude', '/w/a', store)?.fetchedAt).toBe(
			2_000,
		);
		const raw = store.getItem(SLASH_COMMANDS_CACHE_KEY) ?? '{"entries":[]}';
		expect(JSON.parse(raw).entries).toHaveLength(1);
	});

	test('a version mismatch resets the cache', () => {
		const store = fakeStorage({
			[SLASH_COMMANDS_CACHE_KEY]: JSON.stringify({
				entries: [
					{
						commands: COMMANDS,
						cwd: '/w/demo',
						fetchedAt: 1_000,
						provider: 'claude',
					},
				],
				version: SLASH_COMMANDS_CACHE_VERSION + 1,
			}),
		});
		expect(readCachedSlashCommands('claude', '/w/demo', store)).toBeUndefined();
	});

	test('corrupt JSON reads as no cache', () => {
		const store = fakeStorage({ [SLASH_COMMANDS_CACHE_KEY]: 'not json' });
		expect(readCachedSlashCommands('claude', '/w/demo', store)).toBeUndefined();
	});

	test('an entry with a blank command name is rejected', () => {
		const store = fakeStorage({
			[SLASH_COMMANDS_CACHE_KEY]: JSON.stringify({
				entries: [
					{
						commands: [{ autoSubmit: false, command: '', description: '' }],
						cwd: '/w/demo',
						fetchedAt: 1_000,
						provider: 'claude',
					},
				],
				version: SLASH_COMMANDS_CACHE_VERSION,
			}),
		});
		expect(readCachedSlashCommands('claude', '/w/demo', store)).toBeUndefined();
	});

	test('a failed write does not throw', () => {
		expect(() =>
			writeCachedSlashCommands(
				'claude',
				'/w/demo',
				COMMANDS,
				1_000,
				throwingStorage(),
			),
		).not.toThrow();
	});
});
