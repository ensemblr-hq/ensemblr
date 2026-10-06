import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createSecretValuesPort,
	nameDistinctiveSecretValues,
	type SecretEnvironmentAssembly,
} from '../../src/main/agent-control/secret-values-port.ts';

const ASSEMBLY = {
	env: { B_TOKEN: 'shared-value', A_TOKEN: 'shared-value', PLAIN: 'p' },
	redactValues: ['shared-value', 'orphan:7f3k9q2m'],
};

const ROTATED = {
	env: { A_TOKEN: 'rotated-value' },
	redactValues: ['rotated-value'],
};

/**
 * A promise and the functions that settle it, so a test controls when an
 * assembly finishes.
 */
const deferred = () => {
	let resolve: (value: SecretEnvironmentAssembly) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<SecretEnvironmentAssembly>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, reject, resolve };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('nameDistinctiveSecretValues', () => {
	it('names each value after the first key in sorted order, SECRET when none carries it', () => {
		expect(nameDistinctiveSecretValues(ASSEMBLY)).toEqual([
			{ name: 'A_TOKEN', value: 'shared-value' },
			{ name: 'SECRET', value: 'orphan:7f3k9q2m' },
		]);
	});

	it('drops plain configuration, and keeps a secret-named value even when a plain key shares it', () => {
		expect(
			nameDistinctiveSecretValues({
				env: {
					AWS_REGION: 'us-east-1',
					LOG_LEVEL: 'debug',
					NODE_ENV: 'production',
					PORT: '3000',
					API_TOKEN: 'swordfish',
					ALIAS: 'swordfish',
				},
				redactValues: ['us-east-1', 'debug', 'production', '3000', 'swordfish'],
			}),
		).toEqual([{ name: 'ALIAS', value: 'swordfish' }]);
	});
});

describe('createSecretValuesPort', () => {
	it('serves a workspace from the cache inside the window and shares one in-flight assembly', async () => {
		const assemble = vi.fn().mockResolvedValue(ASSEMBLY);
		let clock = 0;
		const port = createSecretValuesPort({ assemble, now: () => clock });

		const [first, second] = await Promise.all([
			port.readSecretValues('ws'),
			port.readSecretValues('ws'),
		]);
		clock = 59_000;
		await port.readSecretValues('ws');

		expect(assemble).toHaveBeenCalledTimes(1);
		expect(first).toEqual(second);
	});

	it('serves the expired table at once while one background refresh replaces it', async () => {
		const pending = deferred();
		const assemble = vi
			.fn()
			.mockResolvedValueOnce(ASSEMBLY)
			.mockReturnValueOnce(pending.promise);
		let clock = 0;
		const port = createSecretValuesPort({ assemble, now: () => clock });

		const first = await port.readSecretValues('ws');
		clock = 60_001;
		const stale = await Promise.all([
			port.readSecretValues('ws'),
			port.readSecretValues('ws'),
		]);
		pending.resolve(ROTATED);

		expect(stale).toEqual([first, first]);
		await vi.waitFor(async () =>
			expect(await port.readSecretValues('ws')).toEqual([
				{ name: 'A_TOKEN', value: 'rotated-value' },
			]),
		);
		expect(assemble).toHaveBeenCalledTimes(2);
	});

	it('assembles per workspace', async () => {
		const assemble = vi.fn().mockResolvedValue(ASSEMBLY);
		const port = createSecretValuesPort({ assemble, now: () => 0 });

		await port.readSecretValues('ws');
		await port.readSecretValues('other');

		expect(assemble.mock.calls).toEqual([['ws'], ['other']]);
	});

	it('keeps the last good table through a failed refresh and retries after a short wait', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const assemble = vi
			.fn()
			.mockResolvedValueOnce(ASSEMBLY)
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue(ROTATED);
		let clock = 0;
		const port = createSecretValuesPort({ assemble, now: () => clock });

		const first = await port.readSecretValues('ws');
		clock = 60_001;
		expect(await port.readSecretValues('ws')).toEqual(first);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
		clock = 62_000;
		expect(await port.readSecretValues('ws')).toEqual(first);
		expect(assemble).toHaveBeenCalledTimes(2);
		clock = 66_000;
		expect(await port.readSecretValues('ws')).toEqual(first);

		await vi.waitFor(() => expect(assemble).toHaveBeenCalledTimes(3));
	});

	it('answers no values for a failed first assembly, logs no message, and retries after a short wait', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const assemble = vi
			.fn()
			.mockRejectedValueOnce(new Error('value=hunter2-secret leaked'))
			.mockResolvedValue(ASSEMBLY);
		let clock = 0;
		const port = createSecretValuesPort({ assemble, now: () => clock });

		expect(await port.readSecretValues('ws')).toEqual([]);
		clock = 1_000;
		expect(await port.readSecretValues('ws')).toEqual([]);
		clock = 6_000;
		expect(await port.readSecretValues('ws')).toHaveLength(2);

		expect(assemble).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(warn.mock.calls)).not.toContain('hunter2');
	});

	it('drops a workspace no read has touched for the idle window, so its next read waits again', async () => {
		const pending = deferred();
		const assemble = vi
			.fn()
			.mockResolvedValueOnce(ASSEMBLY)
			.mockReturnValueOnce(pending.promise);
		let clock = 0;
		const port = createSecretValuesPort({ assemble, now: () => clock });

		await port.readSecretValues('archived');
		clock = 10 * 60_000 + 1;
		const next = port.readSecretValues('archived');
		let settled = false;
		void next.then(() => {
			settled = true;
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(settled).toBe(false);
		pending.resolve(ROTATED);
		expect(await next).toEqual([{ name: 'A_TOKEN', value: 'rotated-value' }]);
	});
});
