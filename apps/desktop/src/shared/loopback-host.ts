/**
 * The one predicate that decides whether a hostname names this machine.
 *
 * Several places accept `http:` only against loopback, because that is the one
 * case where cleartext carries no on-path exposure: the Infisical instance URL
 * (which would otherwise send a Machine Identity client secret in the clear),
 * the dictation endpoint (the stored transcription key and the recorded audio),
 * and the agent-control server's own address. Each held its own copy of the
 * rule, so a spelling one copy missed was a bypass the others refused — this
 * module is what they share instead.
 *
 * The shipped Pi extension keeps a fourth copy by necessity: it cannot import
 * from `src/` at runtime.
 */

/** Loopback hostnames that carry no address literal to range-check. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
	'localhost',
	'::1',
	'0:0:0:0:0:0:0:1',
]);

/** The whole `127.0.0.0/8` block, not `127.0.0.1` alone. */
const IPV4_LOOPBACK_BLOCK = /^127(?:\.\d{1,3}){3}$/;

/**
 * Reports whether a hostname names this machine.
 *
 * `URL` keeps an IPv6 literal in brackets, so `::1` arrives as `[::1]` and the
 * brackets come off before the comparison.
 * @param hostname - Hostname from a parsed URL, bracketed or not.
 * @returns True for a loopback host.
 */
export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

	return LOOPBACK_HOSTNAMES.has(host) || IPV4_LOOPBACK_BLOCK.test(host);
}
