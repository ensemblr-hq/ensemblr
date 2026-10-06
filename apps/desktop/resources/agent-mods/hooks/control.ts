/**
 * The mods' one channel back to the Ensemblr app: its loopback control server.
 *
 * Ensemblr injects the server's URL and the session's bearer token into every
 * agent process it starts, and the mods reach the app with them over `/invoke`,
 * the route the Pi extension already uses. Nothing secret travels toward the
 * mod: the ops it calls answer with redacted text or with issue metadata.
 *
 * Pure helpers only: the engine follows `$` into functions of the file that
 * holds the hook and never across an import, so each mod makes its own
 * `$.env.get` and `$.http.fetch` calls around these.
 */
import type { HttpInit } from 'claude-code';

/**
 * How long a mod waits for the app before going on without it. A hook's `$`
 * calls do not count against its own budget, so without this a busy main
 * process would hold every conversation row for as long as it took to answer.
 */
export const CONTROL_DEADLINE_MS = 4_000;

/** Where the control server lives and how this session authenticates to it. */
export interface ControlEndpoint {
	token: string;
	url: string;
}

/** The envelope every control op answers with. */
type ControlEnvelope =
	| { data: unknown; ok: true }
	| { code: string; error: string; ok: false };

/**
 * Pairs the injected URL and token into an endpoint.
 * @param url - `ENSEMBLR_CONTROL_URL`, if set.
 * @param token - `ENSEMBLR_CONTROL_TOKEN`, if set.
 * @returns The endpoint, or null outside an Ensemblr session.
 */
export function toControlEndpoint(
	url: string | undefined,
	token: string | undefined,
): ControlEndpoint | null {
	return url && token ? { token, url } : null;
}

/**
 * Builds the request that invokes one control op.
 * @param endpoint - The session's control endpoint.
 * @param op - The op name, as `AGENT_CONTROL_OPS` spells it.
 * @param args - The op's arguments.
 * @returns The URL and the fetch options.
 */
export function buildInvokeRequest(
	endpoint: ControlEndpoint,
	op: string,
	args: Record<string, unknown>,
): { init: HttpInit; url: string } {
	return {
		init: {
			body: JSON.stringify({ args, op }),
			headers: {
				authorization: `Bearer ${endpoint.token}`,
				'content-type': 'application/json',
			},
			method: 'POST',
		},
		url: `${endpoint.url}/invoke`,
	};
}

/**
 * Narrows a parsed response body to the control envelope.
 * @param body - The parsed JSON body.
 * @returns True when the body has the envelope's shape.
 */
function isEnvelope(body: unknown): body is ControlEnvelope {
	return (
		typeof body === 'object' &&
		body !== null &&
		typeof (body as { ok?: unknown }).ok === 'boolean'
	);
}

/**
 * Reads an op's payload out of the server's reply.
 * @param responseText - The reply body.
 * @returns The op's `data`, or null when the op failed or the reply is not an envelope.
 */
export function readInvokeData(responseText: string): unknown {
	try {
		const body: unknown = JSON.parse(responseText);
		return isEnvelope(body) && body.ok ? body.data : null;
	} catch {
		return null;
	}
}
