import { request } from 'node:http';
import { connect } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
	AgentControlCommand,
	AgentControlService,
} from '../../src/main/agent-control/index.ts';
import {
	type ControlServer,
	startControlServer,
} from '../../src/main/agent-control/index.ts';

const calls: AgentControlCommand[] = [];
let server: ControlServer | null = null;

const stubService: AgentControlService = {
	describeAudience: async () => ({ hasChatTab: false, role: 'orchestrator' }),
	invoke: async (command) => {
		calls.push(command);
		if (command.token !== 'good') {
			return { ok: false, code: 'denied-permission', error: 'bad token' };
		}
		return { ok: true, data: { echoed: command.op } };
	},
	readSessionBriefNudge: async () => null,
	releaseSession: () => {},
};

const post = (url: string, token: string | null, body: unknown) =>
	fetch(`${url}/invoke`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});

afterEach(async () => {
	calls.length = 0;
	await server?.close();
	server = null;
});

describe('control server', () => {
	it('answers a health check', async () => {
		server = await startControlServer(stubService);
		const response = await fetch(`${server.url}/health`);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it('rejects a request with no token', async () => {
		server = await startControlServer(stubService);
		const response = await post(server.url, null, {
			op: 'listTabs',
			args: {},
		});
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it('rejects an unknown op before touching the service', async () => {
		server = await startControlServer(stubService);
		const response = await post(server.url, 'good', { op: 'nope', args: {} });
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	it('forwards a valid command with its token and args', async () => {
		server = await startControlServer(stubService);
		const response = await post(server.url, 'good', {
			op: 'spawnChatTab',
			args: { title: 'hi' },
		});
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			data: { echoed: 'spawnChatTab' },
		});
		expect(calls).toMatchObject([
			{ op: 'spawnChatTab', token: 'good', rawArgs: { title: 'hi' } },
		]);
		expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('relays a service denial as a 403 with the error envelope', async () => {
		server = await startControlServer(stubService);
		const response = await post(server.url, 'bad', {
			op: 'spawnChatTab',
			args: {},
		});
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			code: 'denied-permission',
		});
	});

	it('404s an unknown route', async () => {
		server = await startControlServer(stubService);
		const response = await fetch(`${server.url}/nope`);
		expect(response.status).toBe(404);
	});

	it('400s a malformed JSON body without touching the service', async () => {
		server = await startControlServer(stubService);
		const response = await fetch(`${server.url}/invoke`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer good',
			},
			body: '{ not json',
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			code: 'invalid-args',
		});
		expect(calls).toHaveLength(0);
	});

	it('400s an oversized body before dispatching', async () => {
		server = await startControlServer(stubService);
		const huge = 'x'.repeat(1_000_001);
		const response = await fetch(`${server.url}/invoke`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer good',
			},
			body: JSON.stringify({ op: 'spawnChatTab', args: { title: huge } }),
		});
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	it('403s a request whose Host is not the loopback interface (DNS-rebind guard)', async () => {
		server = await startControlServer(stubService);
		const { port } = new URL(server.url);
		const status = await new Promise<number>((resolve, reject) => {
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path: '/invoke',
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						authorization: 'Bearer good',
						host: 'evil.example.com',
					},
				},
				(res) => {
					res.resume();
					resolve(res.statusCode ?? 0);
				},
			);
			req.on('error', reject);
			req.end(JSON.stringify({ op: 'spawnChatTab', args: {} }));
		});
		expect(status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	it('answers a request it held far longer than its own request timeout', async () => {
		const holdingService: AgentControlService = {
			invoke: async (command) => {
				calls.push(command);
				await new Promise((resolve) => setTimeout(resolve, 600));
				return { ok: true, data: { echoed: command.op } };
			},
			describeAudience: async () => ({
				hasChatTab: false,
				role: 'orchestrator',
			}),
			readSessionBriefNudge: async () => null,
			releaseSession: () => {},
		};
		server = await startControlServer(holdingService, {
			requestTimeoutMs: 200,
		});
		const startedAt = Date.now();
		const response = await post(server.url, 'good', {
			op: 'askUserQuestion',
			args: {},
		});
		expect(response.status).toBe(200);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(550);
	});

	// Pins the wiring, not just the value: Node only honours `requestTimeout` off
	// the constructor options, so assigning it to the server afterwards leaves the
	// test above passing for the wrong reason.
	it('still cuts off a caller that stalls part-way through its body', async () => {
		server = await startControlServer(stubService, { requestTimeoutMs: 150 });
		const socket = connect(
			Number(new URL(server.url).port),
			'127.0.0.1',
			() => {
				socket.write(
					[
						'POST /invoke HTTP/1.1',
						'Host: 127.0.0.1',
						'authorization: Bearer good',
						'content-type: application/json',
						'content-length: 200',
						'',
						'{"op":"listTabs"',
					].join('\r\n'),
				);
			},
		);
		try {
			const reply = await new Promise<string>((resolve) => {
				socket.on('data', (chunk: Buffer) =>
					resolve(chunk.toString().split('\r\n')[0]),
				);
				socket.on('close', () => resolve('closed with no reply'));
				socket.setTimeout(3_000, () => resolve('held open past its timeout'));
			});
			expect(reply).toContain('408');
			expect(calls).toHaveLength(0);
		} finally {
			socket.destroy();
		}
	});

	it('cancels the op when the caller hangs up before the answer', async () => {
		let seen: AbortSignal | undefined;
		const holdingService: AgentControlService = {
			invoke: async (command) => {
				calls.push(command);
				seen = command.signal;
				await new Promise((resolve) => setTimeout(resolve, 400));
				return { ok: true, data: { echoed: command.op } };
			},
			describeAudience: async () => ({
				hasChatTab: false,
				role: 'orchestrator',
			}),
			readSessionBriefNudge: async () => null,
			releaseSession: () => {},
		};
		server = await startControlServer(holdingService);
		const aborter = new AbortController();
		const inFlight = fetch(`${server.url}/invoke`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer good',
			},
			body: JSON.stringify({ op: 'askUserQuestion', args: {} }),
			signal: aborter.signal,
		});
		await vi.waitFor(() => expect(seen).toBeDefined());
		expect(seen?.aborted).toBe(false);

		aborter.abort();
		await expect(inFlight).rejects.toThrow();
		await vi.waitFor(() => expect(seen?.aborted).toBe(true));
	});
});
