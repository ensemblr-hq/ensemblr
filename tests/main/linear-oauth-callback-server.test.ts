import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';

import {
	LinearOauthCallbackError,
	startLinearOauthCallbackServer,
} from '../../src/main/linear/linear-oauth-callback-server.ts';

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

		const response = await fetch(callback);
		assert.strictEqual(response.status, 200);

		const params = await server.waitForCallback();
		assert.strictEqual(params.get('code'), 'code-1');
		assert.strictEqual(params.get('state'), 'state-1');
	} finally {
		await server.close();
	}
});
