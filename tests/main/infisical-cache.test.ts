import { describe, expect, test, vi } from 'vitest';

import { createInfisicalCache } from '../../src/main/infisical/infisical-cache';
import type { SecretStore } from '../../src/main/secrets/secret-store';

/** In-memory secret store standing in for the Keychain backend. */
function fakeSecretStore(overrides: Partial<SecretStore> = {}): SecretStore {
	const values = new Map<string, string>();

	return {
		create: vi.fn(async ({ key, scopeId, value }) => {
			values.set(`${scopeId}:${key}`, value);
			return {} as never;
		}),
		delete: vi.fn(async ({ key, scopeId }) => {
			values.delete(`${scopeId}:${key}`);
		}),
		listMetadata: vi.fn(async () => []),
		maskSecret: (value: string) => value,
		read: vi.fn(
			async ({ key, scopeId }) => values.get(`${scopeId}:${key}`) ?? null,
		),
		update: vi.fn(async ({ key, scopeId, value }) => {
			values.set(`${scopeId}:${key}`, value);
			return {} as never;
		}),
		...overrides,
	};
}

const SCOPE = { scope: 'repository' as const, scopeId: 'repo-1' };

describe('createInfisicalCache', () => {
	test('stamps each write so a fallback can be dated', async () => {
		const cache = createInfisicalCache({
			now: () => new Date('2026-01-01T00:00:00.000Z'),
			secretStore: fakeSecretStore(),
		});

		const entry = await cache.write({ ...SCOPE, values: {} });

		expect(entry.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
	});

	test('round-trips values through the secret store', async () => {
		const cache = createInfisicalCache({ secretStore: fakeSecretStore() });

		await cache.write({ ...SCOPE, values: { API_KEY: 'sk-1' } });

		expect((await cache.read(SCOPE))?.values).toEqual({ API_KEY: 'sk-1' });
	});

	test('reads as a miss when the stored payload is corrupted', async () => {
		const store = fakeSecretStore({ read: vi.fn(async () => '{ not json') });
		const cache = createInfisicalCache({ secretStore: store });

		expect(await cache.read(SCOPE)).toBeNull();
	});

	test('drops non-string values from a tampered payload', async () => {
		const store = fakeSecretStore({
			read: vi.fn(async () =>
				JSON.stringify({
					fetchedAt: '2026-01-01T00:00:00.000Z',
					values: { GOOD: 'yes', NESTED: { a: 1 }, NUMERIC: 7 },
				}),
			),
		});
		const cache = createInfisicalCache({ secretStore: store });

		expect((await cache.read(SCOPE))?.values).toEqual({ GOOD: 'yes' });
	});

	test('reads as a miss when the secret store throws', async () => {
		const store = fakeSecretStore({
			read: vi.fn(async () => {
				throw new Error('keychain locked');
			}),
		});
		const cache = createInfisicalCache({ secretStore: store });

		expect(await cache.read(SCOPE)).toBeNull();
	});

	test('still returns the entry when the store cannot persist it', async () => {
		const store = fakeSecretStore({
			create: vi.fn(async () => {
				throw new Error('keychain locked');
			}),
			update: vi.fn(async () => {
				throw new Error('keychain locked');
			}),
		});
		const cache = createInfisicalCache({ secretStore: store });

		const entry = await cache.write({ ...SCOPE, values: { API_KEY: 'sk-1' } });

		expect(entry.values).toEqual({ API_KEY: 'sk-1' });
	});

	test('falls back to create when the entry does not exist yet', async () => {
		const store = fakeSecretStore({
			update: vi.fn(async () => {
				throw new Error('not-found');
			}),
		});
		const cache = createInfisicalCache({ secretStore: store });

		await cache.write({ ...SCOPE, values: { API_KEY: 'sk-1' } });

		expect(store.create).toHaveBeenCalled();
	});

	test('degrades to a miss with no secret store at all', async () => {
		const cache = createInfisicalCache({ secretStore: null });

		await cache.write({ ...SCOPE, values: { API_KEY: 'sk-1' } });

		expect(await cache.read(SCOPE)).toBeNull();
	});

	test('clearing an absent entry does not throw', async () => {
		const store = fakeSecretStore({
			delete: vi.fn(async () => {
				throw new Error('not-found');
			}),
		});
		const cache = createInfisicalCache({ secretStore: store });

		await expect(cache.clear(SCOPE)).resolves.toBeUndefined();
	});
});
