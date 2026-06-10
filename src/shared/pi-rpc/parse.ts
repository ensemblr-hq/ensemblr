/**
 * Total, never-throwing parser for Pi RPC stdout lines. Unknown or malformed
 * frames return a typed fallback instead of an error so a new pi version can
 * never crash the timeline — callers log unknowns and render nothing.
 */

import { type PiRpcEvent, piRpcEventSchema } from './schemas.ts';

/** Result of parsing one raw stdout line from `pi --mode rpc`. */
export type PiRpcParseResult =
	| { ok: true; event: PiRpcEvent }
	| {
			ok: false;
			/** Raw line (or parsed JSON value) that did not match any schema. */
			raw: unknown;
			/** `invalid-json` for non-JSON lines, `unknown-frame` otherwise. */
			reason: 'invalid-json' | 'unknown-frame';
			/** Frame `type` when one was present, for diagnostics. */
			frameType: string | null;
	  };

/**
 * Parses one verbatim stdout line into a known Pi RPC event, or a typed
 * unknown-frame fallback. Never throws.
 *
 * @param line - One LF-delimited line from pi stdout (without the newline).
 * @returns The parsed event or an unknown-frame descriptor.
 */
export function parsePiRpcLine(line: string): PiRpcParseResult {
	let json: unknown;
	try {
		json = JSON.parse(line);
	} catch {
		return { ok: false, raw: line, reason: 'invalid-json', frameType: null };
	}
	return parsePiRpcFrame(json);
}

/**
 * Parses an already-JSON-decoded frame into a known Pi RPC event, or a typed
 * unknown-frame fallback. Never throws.
 *
 * @param frame - One decoded stdout frame.
 * @returns The parsed event or an unknown-frame descriptor.
 */
export function parsePiRpcFrame(frame: unknown): PiRpcParseResult {
	const result = piRpcEventSchema.safeParse(frame);
	if (result.success) {
		return { ok: true, event: result.data };
	}
	const frameType =
		frame !== null &&
		typeof frame === 'object' &&
		'type' in frame &&
		typeof (frame as { type: unknown }).type === 'string'
			? (frame as { type: string }).type
			: null;
	return { ok: false, raw: frame, reason: 'unknown-frame', frameType };
}
