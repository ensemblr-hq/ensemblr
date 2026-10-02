/**
 * Hosts whose plain-`http:` traffic never leaves the machine, so an unencrypted
 * endpoint there carries no key over the network.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** How a configured transcription endpoint rates for carrying the API key. */
export type EndpointSafety = 'insecure' | 'invalid' | 'ok';

/**
 * Rates the endpoint the API key will be sent to, so the settings screen can
 * say so before the first clip rather than after the key has been on the wire.
 *
 * A local `whisper-server` over `http://localhost` is a supported target and
 * rates `ok`; plain `http:` to anything else puts `Authorization: Bearer <key>`
 * in cleartext and rates `insecure`.
 * @param baseUrl - The configured API root, as typed
 * @returns Whether the endpoint is usable, and whether it protects the key
 */
export function endpointSafety(baseUrl: string): EndpointSafety {
	const parsed = URL.parse(baseUrl.trim());

	if (!parsed) {
		return 'invalid';
	}
	if (parsed.protocol === 'https:') {
		return 'ok';
	}
	if (parsed.protocol !== 'http:') {
		return 'invalid';
	}

	return LOOPBACK_HOSTNAMES.has(parsed.hostname) ? 'ok' : 'insecure';
}
