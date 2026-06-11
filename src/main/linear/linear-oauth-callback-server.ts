import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const DEFAULT_CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const LOOPBACK_HOST = '127.0.0.1';

const CALLBACK_RESPONSE_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Ensemble</title>
		<style>
			body { align-items: center; background: #101012; color: #e4e4e7; display: flex; font-family: -apple-system, system-ui, sans-serif; height: 100vh; justify-content: center; margin: 0; }
			main { text-align: center; }
			p { color: #a1a1aa; }
		</style>
	</head>
	<body>
		<main>
			<h1>Linear connected</h1>
			<p>You can close this tab and return to Ensemble.</p>
		</main>
	</body>
</html>`;

/** Error thrown when the loopback callback flow ends without a callback. */
export class LinearOauthCallbackError extends Error {
	readonly code: 'callback-canceled' | 'callback-timeout' | 'server-error';

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description.
	 */
	constructor(
		code: 'callback-canceled' | 'callback-timeout' | 'server-error',
		message: string,
	) {
		super(message);
		this.name = 'LinearOauthCallbackError';
		this.code = code;
	}
}

/** Running loopback HTTP server awaiting a single OAuth redirect. */
export interface LinearOauthCallbackServer {
	close: () => Promise<void>;
	port: number;
	redirectUri: string;
	waitForCallback: () => Promise<URLSearchParams>;
}

/** Options for {@link startLinearOauthCallbackServer}. */
export interface StartLinearOauthCallbackServerOptions {
	callbackPath?: string;
	timeoutMs?: number;
}

/**
 * Starts a temporary loopback HTTP server on a random port that resolves the
 * first request hitting the callback path. The server only ever serves one
 * login attempt and must be closed by the caller in every outcome.
 * @param options - Optional callback path and timeout overrides.
 * @returns A {@link LinearOauthCallbackServer} bound to `127.0.0.1`.
 */
export async function startLinearOauthCallbackServer({
	callbackPath = DEFAULT_CALLBACK_PATH,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}: StartLinearOauthCallbackServerOptions = {}): Promise<LinearOauthCallbackServer> {
	let settled = false;
	let resolveCallback: (params: URLSearchParams) => void = () => {};
	let rejectCallback: (error: LinearOauthCallbackError) => void = () => {};

	const callbackPromise = new Promise<URLSearchParams>((resolve, reject) => {
		resolveCallback = resolve;
		rejectCallback = reject;
	});
	// Pre-attach so a timeout/cancel before waitForCallback() never surfaces as
	// an unhandled rejection.
	callbackPromise.catch(() => {});

	const server: Server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);

		if (url.pathname !== callbackPath) {
			response.writeHead(404, { 'content-type': 'text/plain' });
			response.end('Not found');
			return;
		}

		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end(CALLBACK_RESPONSE_HTML);

		if (!settled) {
			settled = true;
			resolveCallback(url.searchParams);
		}
	});

	const timeout = setTimeout(() => {
		if (!settled) {
			settled = true;
			rejectCallback(
				new LinearOauthCallbackError(
					'callback-timeout',
					`No OAuth callback arrived within ${Math.round(timeoutMs / 1000)}s.`,
				),
			);
		}
	}, timeoutMs);
	timeout.unref();

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, LOOPBACK_HOST, resolve);
	});

	const port = (server.address() as AddressInfo).port;

	return {
		close: () => {
			clearTimeout(timeout);

			if (!settled) {
				settled = true;
				rejectCallback(
					new LinearOauthCallbackError(
						'callback-canceled',
						'The Linear login attempt was canceled.',
					),
				);
			}

			return new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			});
		},
		port,
		redirectUri: `http://${LOOPBACK_HOST}:${port}${callbackPath}`,
		waitForCallback: () => callbackPromise,
	};
}
