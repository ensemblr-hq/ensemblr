import type { PiAgentSessionStatus } from '../pi-agent-types.ts';
import { extractMessageId } from '../pi-wire-normalizer.ts';

/**
 * Type guard for a valid Pi agent session status string.
 * @param value - Value to test.
 * @returns True when the value is a known session status.
 */
export function isSessionStatus(value: unknown): value is PiAgentSessionStatus {
	return (
		value === 'closed' ||
		value === 'errored' ||
		value === 'idle' ||
		value === 'starting' ||
		value === 'streaming'
	);
}

/**
 * Extracts the `contextUsage` block from a pi `get_session_stats` response.
 * Returns null when the response doesn't include usage data (e.g. right after
 * compaction). Tolerates both top-level and nested shapes for forward
 * compatibility.
 */
export function extractContextUsage(data: unknown): {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
} | null {
	if (!data || typeof data !== 'object') {
		return null;
	}
	const root = data as Record<string, unknown>;
	const candidate =
		root.contextUsage && typeof root.contextUsage === 'object'
			? (root.contextUsage as Record<string, unknown>)
			: root;
	const contextWindow =
		typeof candidate.contextWindow === 'number' ? candidate.contextWindow : 0;
	if (contextWindow <= 0) {
		return null;
	}
	const tokens = typeof candidate.tokens === 'number' ? candidate.tokens : null;
	const percent =
		typeof candidate.percent === 'number' ? candidate.percent : null;
	return { contextWindow, percent, tokens };
}

/** Reads the turnId off a Pi RPC frame, falling back to nested message ids. */
export function extractTurnId(typed: Record<string, unknown>): string | null {
	if (typeof typed.turnId === 'string' && typed.turnId.length > 0) {
		return typed.turnId;
	}
	if (typed.message && typeof typed.message === 'object') {
		const id = extractMessageId(typed.message);
		if (id) {
			return id;
		}
	}
	if (
		typed.assistantMessageEvent &&
		typeof typed.assistantMessageEvent === 'object'
	) {
		const inner = typed.assistantMessageEvent as Record<string, unknown>;
		if (typeof inner.turnId === 'string' && inner.turnId.length > 0) {
			return inner.turnId;
		}
	}
	return null;
}

/**
 * Parses a `message_update` frame into normalized delta payloads following
 * Pi RPC's documented `assistantMessageEvent` schema:
 *
 *   {
 *     type: 'message_update',
 *     message: {...},
 *     assistantMessageEvent: {
 *       type: 'text_delta' | 'thinking_delta' | ...,
 *       delta: 'chunk text',
 *       ...
 *     }
 *   }
 *
 * Non-delta events (`start`, `text_start`, `text_end`, etc.) carry no chunk
 * and are ignored so the renderer only sees actual streaming payloads.
 */
export function extractMessageUpdateDeltas(
	typed: Record<string, unknown>,
): Array<
	| { kind: 'text-delta'; text: string }
	| { kind: 'reasoning-delta'; text: string }
> {
	if (
		!typed.assistantMessageEvent ||
		typeof typed.assistantMessageEvent !== 'object'
	) {
		return [];
	}
	const evt = typed.assistantMessageEvent as Record<string, unknown>;
	const evtType = typeof evt.type === 'string' ? evt.type : '';
	const delta = typeof evt.delta === 'string' ? evt.delta : '';
	if (delta.length === 0) {
		return [];
	}
	if (evtType === 'text_delta') {
		return [{ kind: 'text-delta', text: delta }];
	}
	if (evtType === 'thinking_delta') {
		return [{ kind: 'reasoning-delta', text: delta }];
	}
	return [];
}
