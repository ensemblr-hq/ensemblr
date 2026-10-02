import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';

import {
	LinearOauthCallbackError,
	startLinearOauthCallbackServer,
} from '../../src/main/linear/linear-oauth-callback-server.ts';

/**
 * Fetches a URL the way a real OAuth redirect arrives: a top-level browser
 * navigation, which is what earns `sec-fetch-mode: navigate`. Built on
 * `http.request` rather than the global `fetch`, whose undici implementation
 * silently forces `sec-fetch-mode: cors` on every outgoing request, discarding
 * any value a caller sets — verified directly against this runtime.
 */
function fetchAsNavigation(
	url: string | URL,
): Promise<{ body: string; status: number }> {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const req = httpRequest(
			target,
			{ headers: { 'sec-fetch-mode': 'navigate' }, method: 'GET' },
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () =>
					resolve({
						body: Buffer.concat(chunks).toString('utf8'),
						status: res.statusCode ?? 0,
					}),
				);
			},
		);
		req.on('error', reject);
		req.end();
	});
}

async function occupyLoopbackPort(t: TestContext): Promise<number> {
	const blocker: Server = createServer();

	await new Promise<void>((resolve, reject) => {
		blocker.once('error', reject);
		blocker.listen(0, '127.0.0.1', resolve);
	});

	t.after(
		() =>
			new Promise<void>((resolve) => {
				blocker.close(() => resolve());
			}),
	);

	return (blocker.address() as AddressInfo).port;
}

test('startLinearOauthCallbackServer: binds the first free port from the list', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		assert.ok(server.port > 0);
		assert.strictEqual(
			server.redirectUri,
			`http://127.0.0.1:${server.port}/callback`,
		);
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: skips occupied ports', async (t) => {
	const busyPort = await occupyLoopbackPort(t);

	const server = await startLinearOauthCallbackServer({ ports: [busyPort, 0] });

	try {
		assert.notStrictEqual(server.port, busyPort);
		assert.ok(server.port > 0);
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: fails when every port is busy', async (t) => {
	const busyPort = await occupyLoopbackPort(t);

	await assert.rejects(
		startLinearOauthCallbackServer({ ports: [busyPort] }),
		(error: unknown) => {
			assert.ok(error instanceof LinearOauthCallbackError);
			assert.strictEqual(error.code, 'server-error');
			assert.match(error.message, new RegExp(String(busyPort)));
			return true;
		},
	);
});

test('startLinearOauthCallbackServer: resolves callback params for the callback path', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const callback = new URL(server.redirectUri);
		callback.searchParams.set('code', 'code-1');
		callback.searchParams.set('state', 'state-1');

		const response = await fetchAsNavigation(callback);
		assert.strictEqual(response.status, 200);

		const params = await server.waitForCallback();
		assert.strictEqual(params.get('code'), 'code-1');
		assert.strictEqual(params.get('state'), 'state-1');
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: binds 127.0.0.1, not every interface', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const address = new URL(server.redirectUri);
		assert.strictEqual(address.hostname, '127.0.0.1');
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: a non-callback path 404s without settling', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const probe = new URL(server.redirectUri);
		probe.pathname = '/not-the-callback';
		const response = await fetch(probe);
		assert.strictEqual(response.status, 404);

		const callback = new URL(server.redirectUri);
		callback.searchParams.set('code', 'code-1');
		callback.searchParams.set('state', 'state-1');
		await fetchAsNavigation(callback);

		const params = await server.waitForCallback();
		assert.strictEqual(params.get('code'), 'code-1');
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: a second request does not re-settle the callback', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const first = new URL(server.redirectUri);
		first.searchParams.set('code', 'code-1');
		first.searchParams.set('state', 'state-1');
		await fetchAsNavigation(first);

		const second = new URL(server.redirectUri);
		second.searchParams.set('code', 'code-2');
		second.searchParams.set('state', 'state-2');
		await fetchAsNavigation(second);

		const params = await server.waitForCallback();
		assert.strictEqual(params.get('code'), 'code-1');
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: the timeout rejects with callback-timeout', async () => {
	const server = await startLinearOauthCallbackServer({
		ports: [0],
		timeoutMs: 10,
	});

	try {
		await assert.rejects(server.waitForCallback(), (error: unknown) => {
			assert.ok(error instanceof LinearOauthCallbackError);
			assert.strictEqual(error.code, 'callback-timeout');
			return true;
		});
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: no query parameter reaches the rendered HTML', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const callback = new URL(server.redirectUri);
		callback.searchParams.set('code', '<script>window.pwned=1</script>');
		callback.searchParams.set('state', 'state-1');

		const response = await fetchAsNavigation(callback);
		assert.ok(!response.body.includes('<script>window.pwned'));
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: refuses anything but GET', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const callback = new URL(server.redirectUri);
		callback.searchParams.set('code', 'code-1');
		callback.searchParams.set('state', 'state-1');

		const response = await fetch(callback, { method: 'POST' });
		assert.strictEqual(response.status, 405);

		await assert.rejects(
			Promise.race([
				server.waitForCallback(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('still unsettled')), 20),
				),
			]),
		);
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: refuses a sec-fetch-mode other than navigate', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const callback = new URL(server.redirectUri);
		callback.searchParams.set('code', 'code-1');
		callback.searchParams.set('state', 'state-1');

		const response = await fetch(callback, {
			headers: { 'sec-fetch-mode': 'cors' },
		});
		assert.strictEqual(response.status, 403);
	} finally {
		await server.close();
	}
});

test('startLinearOauthCallbackServer: does not settle a request with no state', async () => {
	const server = await startLinearOauthCallbackServer({ ports: [0] });

	try {
		const probe = new URL(server.redirectUri);
		probe.searchParams.set('error', 'access_denied');
		const response = await fetchAsNavigation(probe);
		assert.strictEqual(response.status, 400);

		const callback = new URL(server.redirectUri);
		callback.searchParams.set('code', 'code-1');
		callback.searchParams.set('state', 'state-1');
		await fetchAsNavigation(callback);

		const params = await server.waitForCallback();
		assert.strictEqual(params.get('code'), 'code-1');
	} finally {
		await server.close();
	}
});
