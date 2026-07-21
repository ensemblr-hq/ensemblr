/**
 * Loopback HTTP transport for the agent-control service. Both agent species
 * reach the app through this one server: the Pi extension's tools `fetch`
 * `POST /invoke`, and the harness MCP bridge forwards tool calls to the same
 * endpoint. It binds to 127.0.0.1 on an ephemeral port and authenticates each
 * request by the per-session token minted in the origin registry — the server
 * never resolves identity itself, it hands the token to the service.
 */
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';

import {
	AGENT_CONTROL_OPS,
	type AgentControlOp,
} from '../../shared/agent-control.ts';
import type { AgentControlService } from './agent-control-service.ts';
import { handleMcpRequest } from './mcp-endpoint.ts';

/** A running control server plus the address agents connect to. */
export interface ControlServer {
	/** Base URL agents post to, e.g. `http://127.0.0.1:53219`. */
	url: string;
	close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const OP_SET: ReadonlySet<string> = new Set(AGENT_CONTROL_OPS);

/** Host names that may address the loopback control server. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	'127.0.0.1',
	'localhost',
	'::1',
	'[::1]',
]);

/**
 * Extracts the bearer token from a request's Authorization header.
 * @param req - Incoming request.
 * @returns The token, or null when absent/malformed.
 */
function readToken(req: IncomingMessage): string | null {
	const header = req.headers.authorization;
	if (typeof header !== 'string') {
		return null;
	}
	const match = header.match(/^Bearer\s+(.+)$/i);
	return match ? match[1].trim() : null;
}

/**
 * Guards against DNS-rebinding by rejecting any request whose `Host` header does
 * not name the loopback interface. A malicious page that rebinds its domain to
 * 127.0.0.1 still sends its own hostname here, so this closes the browser-driven
 * attack path even before the bearer token is checked.
 * @param req - Incoming request.
 * @returns True when the Host header addresses the loopback interface.
 */
function isLoopbackHost(req: IncomingMessage): boolean {
	const host = req.headers.host;
	if (typeof host !== 'string') {
		return false;
	}
	const hostname = host.replace(/:\d+$/, '').toLowerCase();
	return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Maps a control error code to the HTTP status that best conveys it, so
 * HTTP-level clients see a real status while the JSON envelope carries detail.
 * @param code - Stable control error code.
 * @returns The matching HTTP status.
 */
function statusForError(code: string): number {
	if (code === 'invalid-args') {
		return 400;
	}
	if (code === 'not-found') {
		return 404;
	}
	if (code === 'internal') {
		return 500;
	}
	if (code.startsWith('denied')) {
		return 403;
	}
	return 400;
}

/**
 * Reads and JSON-parses a request body, rejecting oversized payloads.
 * @param req - Incoming request.
 * @returns The parsed body object, or null on parse failure / size overflow.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > MAX_BODY_BYTES) {
			throw new Error('Request body too large.');
		}
		chunks.push(chunk as Buffer);
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	if (!raw) {
		return {};
	}
	return JSON.parse(raw) as unknown;
}

/**
 * Writes a JSON response with the given status.
 * @param res - Server response.
 * @param status - HTTP status code.
 * @param body - Serializable payload.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(payload),
	});
	res.end(payload);
}

/**
 * Handles a single `POST /invoke` request end to end.
 * @param req - Incoming request.
 * @param res - Server response.
 * @param service - Agent-control service the request delegates to.
 */
async function handleInvoke(
	req: IncomingMessage,
	res: ServerResponse,
	service: AgentControlService,
): Promise<void> {
	const token = readToken(req);
	if (!token) {
		sendJson(res, 401, {
			ok: false,
			code: 'denied-permission',
			error: 'Missing token.',
		});
		return;
	}
	let body: unknown;
	try {
		body = await readJsonBody(req);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		sendJson(res, 400, { ok: false, code: 'invalid-args', error: detail });
		return;
	}
	const record = (body ?? {}) as {
		op?: unknown;
		args?: unknown;
		callerModel?: unknown;
	};
	if (typeof record.op !== 'string' || !OP_SET.has(record.op)) {
		sendJson(res, 400, {
			ok: false,
			code: 'invalid-args',
			error: 'Unknown or missing op.',
		});
		return;
	}
	const result = await service.invoke({
		op: record.op as AgentControlOp,
		token,
		rawArgs: record.args,
		callerModel:
			typeof record.callerModel === 'string' ? record.callerModel : undefined,
	});
	sendJson(res, result.ok ? 200 : statusForError(result.code), result);
}

/**
 * Handles an MCP streamable-HTTP request: authenticates the bearer token, parses
 * the JSON-RPC body for POSTs, and delegates to the MCP endpoint.
 * @param req - Incoming request.
 * @param res - Server response.
 * @param service - Agent-control service the MCP tools delegate to.
 */
async function handleMcp(
	req: IncomingMessage,
	res: ServerResponse,
	service: AgentControlService,
): Promise<void> {
	const token = readToken(req);
	if (!token) {
		sendJson(res, 401, {
			ok: false,
			code: 'denied-permission',
			error: 'Missing token.',
		});
		return;
	}
	let body: unknown;
	if (req.method === 'POST') {
		try {
			body = await readJsonBody(req);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			sendJson(res, 400, { ok: false, code: 'invalid-args', error: detail });
			return;
		}
	}
	await handleMcpRequest(req, res, body, service, token);
}

/**
 * Starts the loopback control server bound to 127.0.0.1 on an ephemeral port.
 * @param service - Agent-control service every request delegates to.
 * @returns A promise resolving to the running server and its URL.
 */
export function startControlServer(
	service: AgentControlService,
): Promise<ControlServer> {
	const server: Server = createServer((req, res) => {
		if (!isLoopbackHost(req)) {
			sendJson(res, 403, {
				ok: false,
				code: 'denied-permission',
				error: 'Requests must address the loopback interface.',
			});
			return;
		}
		if (req.method === 'GET' && req.url === '/health') {
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === 'POST' && req.url === '/invoke') {
			handleInvoke(req, res, service).catch((error) => {
				const detail = error instanceof Error ? error.message : String(error);
				sendJson(res, 500, { ok: false, code: 'internal', error: detail });
			});
			return;
		}
		if (req.url === '/mcp') {
			handleMcp(req, res, service).catch((error) => {
				const detail = error instanceof Error ? error.message : String(error);
				if (!res.headersSent) {
					sendJson(res, 500, { ok: false, code: 'internal', error: detail });
				}
			});
			return;
		}
		sendJson(res, 404, {
			ok: false,
			code: 'not-found',
			error: 'No such route.',
		});
	});

	return new Promise<ControlServer>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				reject(new Error('Control server bound to an unexpected address.'));
				return;
			}
			resolve({
				url: `http://127.0.0.1:${address.port}`,
				close: () =>
					new Promise<void>((done, fail) => {
						server.close((err) => (err ? fail(err) : done()));
					}),
			});
		});
	});
}
