import type { Session } from 'electron';

import { contentSecurityPolicy } from '../../shared/content-security-policy.ts';

/** Header names that already carry a policy, in the casings Chromium emits. */
const EXISTING_POLICY_HEADERS = [
	'content-security-policy',
	'content-security-policy-report-only',
];

/**
 * Whether a response already declares a policy of its own, which this must not
 * replace — the Linear asset protocol and any future `protocol.handle` surface
 * get to state their own.
 * @param responseHeaders - The headers Chromium is about to apply
 * @returns True when a policy header is already present
 */
function declaresOwnPolicy(
	responseHeaders: Record<string, string[]> | undefined,
): boolean {
	return Object.keys(responseHeaders ?? {}).some((name) =>
		EXISTING_POLICY_HEADERS.includes(name.toLowerCase()),
	);
}

/**
 * Attaches the renderer's Content-Security-Policy to every document response in
 * `session`.
 *
 * Only the top-level document is stamped: a policy on a subresource governs
 * nothing, and the document's own policy already covers everything it loads.
 *
 * This is one of two delivery paths and the only one that reaches the dev
 * server; the packaged `file:` document is served by Electron's protocol
 * handler rather than through the network stack, so the renderer build also
 * stamps the same policy into `index.html` as a `<meta http-equiv>`.
 *
 * @param session - The session whose responses to stamp.
 * @param devServerOrigin - The Vite dev-server origin, or `null` for the packaged build.
 */
export function installContentSecurityPolicy(
	session: Session,
	devServerOrigin: string | null,
): void {
	const policy = contentSecurityPolicy(devServerOrigin);

	session.webRequest.onHeadersReceived((details, callback) => {
		if (details.resourceType !== 'mainFrame') {
			callback({});
			return;
		}

		if (declaresOwnPolicy(details.responseHeaders)) {
			callback({});
			return;
		}

		callback({
			responseHeaders: {
				...details.responseHeaders,
				'Content-Security-Policy': [policy],
			},
		});
	});
}
