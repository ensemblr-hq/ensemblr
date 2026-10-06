import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createSecretValuesPort,
	nameSecretValues,
} from '../../src/main/agent-control/secret-values-port.ts';

const ASSEMBLY = {
	env: { B_TOKEN: 'shared-value', A_TOKEN: 'shared-value', PLAIN: 'p' },
	redactValues: ['shared-value', 'orphan-value'],
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('nameSecretValues', () => {
	it('names each value after the first key in sorted order, SECRET when none carries it', () => {
		expect(nameSecretValues(ASSEMBLY)).toEqual([
			{ name: 'A_TOKEN', value: 'shared-value' },
			{ name: 'SECRET', value: 'orphan-value' },
		]);
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

	it('assembles again once the window has passed, and per workspace', async () => {
		const assemble = vi.fn().mockResolvedValue(ASSEMBLY);
		let clock = 0;
		const port = createSecretValuesPort({ assemble, now: () => clock });

		await port.readSecretValues('ws');
		await port.readSecretValues('other');
		clock = 60_001;
		await port.readSecretValues('ws');

		expect(assemble.mock.calls).toEqual([['ws'], ['other'], ['ws']]);
	});

	it('answers no values for a failed assembly, logs no message, and retries after a short wait', async () => {
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
});
