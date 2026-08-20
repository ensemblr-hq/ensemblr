import { describe, expect, it } from 'vitest';

import {
	DISPATCH_TIMEOUT_MS,
	withDispatchDeadline,
} from '../../src/main/agent-control/index.ts';

const never = () => new Promise<never>(() => {});

describe('withDispatchDeadline', () => {
	it('is generous enough that no ordinary op can trip it', () => {
		expect(DISPATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
	});

	it('hands back whatever the op resolved, untouched', async () => {
		const result = await withDispatchDeadline(
			'listWorkspaces',
			async () => ({ ok: true, data: { workspaces: [] } }),
			50,
		);

		expect(result).toEqual({ ok: true, data: { workspaces: [] } });
	});

	// The client-side ceiling is a day, so without this a wedged port hangs the
	// agent for a day: the app has to answer for an op that never will.
	it('answers a wedged op with a timeout envelope naming it', async () => {
		const result = await withDispatchDeadline('getWorkspaceDiff', never, 20);

		expect(result).toMatchObject({ code: 'timeout', ok: false });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('getWorkspaceDiff');
		}
	});

	// The side effect may already have landed, so a retry is not obviously safe.
	it('tells the agent the app may still be working on it', async () => {
		const result = await withDispatchDeadline('startTerminal', never, 20);

		if (!result.ok) {
			expect(result.error).toMatch(/still/i);
		}
	});

	it('lets an op that blocks on the user run past the deadline', async () => {
		let answer: (value: { ok: true; data: string }) => void = () => {};
		const held = new Promise<{ ok: true; data: string }>((resolve) => {
			answer = resolve;
		});

		const call = withDispatchDeadline('askUserQuestion', () => held, 20);
		await new Promise((tick) => setTimeout(tick, 60));
		answer({ ok: true, data: 'answered' });

		expect(await call).toEqual({ ok: true, data: 'answered' });
	});

	it('lets a wait that blocks on a child run past the deadline', async () => {
		const call = withDispatchDeadline(
			'waitForAgents',
			async () => {
				await new Promise((tick) => setTimeout(tick, 60));
				return { ok: true, data: 'settled' };
			},
			20,
		);

		expect(await call).toEqual({ ok: true, data: 'settled' });
	});

	// `invoke` maps a throw onto its own `internal` envelope; swallowing it here
	// would turn every port crash into a silent timeout.
	it('passes a rejection through rather than converting it', async () => {
		const call = withDispatchDeadline(
			'listWorkspaces',
			async () => {
				throw new Error('port exploded');
			},
			50,
		);

		await expect(call).rejects.toThrow('port exploded');
	});
});
