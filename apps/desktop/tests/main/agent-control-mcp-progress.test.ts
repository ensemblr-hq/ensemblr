import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { withProgressHeartbeat } from '../../src/main/agent-control/index.ts';

/** A deferred whose resolution the test controls, standing in for a held call. */
const deferred = () => {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve: () => resolve() };
};

describe('withProgressHeartbeat', () => {
	it('beats until the call settles, then stops', async () => {
		const sent: ServerNotification[] = [];
		const held = deferred();

		const run = withProgressHeartbeat(
			{
				intervalMs: 5,
				progressToken: 'tok',
				sendNotification: async (notification) => {
					sent.push(notification);
				},
				toolName: 'ensemblr_ask_user_question',
			},
			async () => {
				await held.promise;
				return 'answered';
			},
		);
		await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(3));
		held.resolve();

		expect(await run).toBe('answered');
		const settledAt = sent.length;
		await new Promise((tick) => setTimeout(tick, 30));
		expect(sent).toHaveLength(settledAt);
	});

	// The spec has no way to address progress at a request that sent no token,
	// and a client handed one it never asked for logs it as an error.
	it('sends nothing when the caller supplied no progress token', async () => {
		const sent: ServerNotification[] = [];
		const held = deferred();

		const run = withProgressHeartbeat(
			{
				intervalMs: 5,
				progressToken: undefined,
				sendNotification: async (notification) => {
					sent.push(notification);
				},
				toolName: 'ensemblr_ask_user_question',
			},
			async () => {
				await held.promise;
				return 'answered';
			},
		);
		await new Promise((tick) => setTimeout(tick, 30));
		held.resolve();

		expect(await run).toBe('answered');
		expect(sent).toEqual([]);
	});

	// The stream is gone, but the user may still be mid-answer: give up on the
	// wire, never on the call.
	it('stops beating when a send fails, and lets the call finish', async () => {
		let attempts = 0;
		const held = deferred();

		const run = withProgressHeartbeat(
			{
				intervalMs: 5,
				progressToken: 7,
				sendNotification: async () => {
					attempts += 1;
					throw new Error('No connection established for request ID: 1');
				},
				toolName: 'ensemblr_list_workspaces',
			},
			async () => {
				await held.promise;
				return 'done';
			},
		);
		await vi.waitFor(() => expect(attempts).toBe(1));
		await new Promise((tick) => setTimeout(tick, 40));
		held.resolve();

		expect(await run).toBe('done');
		expect(attempts).toBe(1);
	});

	it('clears the heartbeat when the call throws', async () => {
		const sent: ServerNotification[] = [];
		const held = deferred();

		const run = withProgressHeartbeat(
			{
				intervalMs: 5,
				progressToken: 'tok',
				sendNotification: async (notification) => {
					sent.push(notification);
				},
				toolName: 'ensemblr_list_workspaces',
			},
			async () => {
				await held.promise;
				throw new Error('boom');
			},
		);
		await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
		held.resolve();

		await expect(run).rejects.toThrow('boom');
		const settledAt = sent.length;
		await new Promise((tick) => setTimeout(tick, 30));
		expect(sent).toHaveLength(settledAt);
	});
});
