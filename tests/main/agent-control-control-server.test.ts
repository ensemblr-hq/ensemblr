import { request } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

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
	invoke: async (command) => {
		calls.push(command);
		if (command.token !== 'good') {
			return { ok: false, code: 'denied-permission', error: 'bad token' };
		}
		return { ok: true, data: { echoed: command.op } };
	},
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
		expect(calls).toEqual([
			{ op: 'spawnChatTab', token: 'good', rawArgs: { title: 'hi' } },
		]);
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
});
