/**
 * Recursion guardrails for agent spawning. Stops fork-bombs and runaway
 * delegation chains: caps nesting depth, a monotonic per-root-tree lifetime
 * spawn quota, and a rolling spawn rate, and refuses blocking waits that would
 * deadlock a lineage. Spawn capacity is reserved synchronously before creation
 * so concurrent requests cannot overshoot it, then refunded only when creation
 * fails.
 *
 * Starting a terminal is guarded separately, because a PTY is not delegation:
 * it spawns nothing and cannot recurse, so what has to be bounded is how many
 * are open at once and how fast they are opened, neither of which is a lifetime
 * count. Charging one against the lifetime spawn quota made a terminal an agent
 * opened and closed an hour ago go on costing it the budget it needed to
 * delegate.
 */
import type { DatabaseSync } from 'node:sqlite';

import type { AgentControlErrorCode } from '../../shared/agent-control.ts';
import {
	refundAgentControlSpawn,
	reserveAgentControlSpawn,
} from '../storage/repositories/agent-control-spawn-repository.ts';
import type { AgentControlOrigin } from './ports.ts';

/** Tunable limits; defaults are conservative and overridable in tests/config. */
export interface GuardrailConfig {
	maxSpawnDepth: number;
	/** Lifetime spawns shared by every session in one rooted delegation tree. */
	maxSpawnsPerSession: number;
	maxSpawnsPerMinute: number;
	/**
	 * Terminals one root tree may have open at once. Concurrent rather than
	 * lifetime: the resource is the live PTY and the dock tab it holds, both of
	 * which a close gives back.
	 */
	maxOpenTerminals: number;
	maxTerminalStartsPerMinute: number;
	/**
	 * Messages one session may send up to the Concierge, ever. The loop this
	 * bounds is Concierge → orchestrator → Concierge: each message can start a
	 * Concierge turn, and each of those can brief the orchestrator again.
	 */
	maxConciergeMessagesPerSession: number;
	maxConciergeMessagesPerMinute: number;
	waitTimeoutMs: number;
}

/** Default guardrail limits applied when the composition root passes none. */
export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
	maxSpawnDepth: 2,
	maxSpawnsPerSession: 20,
	maxSpawnsPerMinute: 10,
	maxOpenTerminals: 8,
	maxTerminalStartsPerMinute: 10,
	maxConciergeMessagesPerSession: 10,
	maxConciergeMessagesPerMinute: 3,
	waitTimeoutMs: 300_000,
};

const RATE_WINDOW_MS = 60_000;

/** A refused guardrail check: a stable denial code plus the reason to report. */
export type GuardrailDenial = {
	ok: false;
	code: AgentControlErrorCode;
	reason: string;
};

/** Result of a guardrail check: pass, or a stable denial code plus reason. */
export type GuardrailResult = { ok: true } | GuardrailDenial;

/** Capacity held by one spawn attempt until creation succeeds or fails. */
export type SpawnReservation =
	| { ok: true; refund: () => void }
	| { ok: false; code: AgentControlErrorCode; reason: string };

/** Guardrail surface consumed by the agent-control service. */
export interface Guardrails {
	readonly waitTimeoutMs: number;
	/** Atomically reserves depth, lifetime, and rate capacity for a spawn attempt. */
	reserveSpawn: (origin: AgentControlOrigin) => SpawnReservation;
	/**
	 * Checks depth and the concurrent-terminal cap, then reserves rate capacity
	 * for one terminal start. The open count is observed rather than reserved —
	 * it is derived from terminals that exist, so two starts racing each other
	 * can both read the same number and overshoot the cap by one; the rate limit
	 * is what bounds a burst.
	 * @param origin - Resolved caller identity.
	 * @param openTerminals - How many terminals this root tree already has open.
	 */
	reserveTerminalStart: (
		origin: AgentControlOrigin,
		openTerminals: number,
	) => SpawnReservation;
	/** Quota + rate check for a message to the Concierge; does not mutate counters. */
	evaluateConciergeMessage: (sessionId: string) => GuardrailResult;
	/** Record a message to the Concierge once it has actually been delivered. */
	recordConciergeMessage: (sessionId: string) => void;
	/** Drops only per-session message counters; root-tree spawn budgets are lifetime. */
	release: (sessionId: string) => void;
	/** Refuse a blocking wait whose target is an ancestor of the caller. */
	evaluateWaitTarget: (
		targetSessionId: string,
		ancestorSessionIds: readonly string[],
	) => GuardrailResult;
}

/**
 * Builds the {@link Guardrails} with a rolling per-root-tree spawn log.
 * @param config - Limit overrides merged over {@link DEFAULT_GUARDRAIL_CONFIG}.
 * @param now - Clock injection for deterministic rate-window tests.
 * @param resolveDatabase - Live database resolver; production passes this so spawn budgets survive restarts.
 * @returns A guardrails instance with mutable message counters and durable spawn counters when storage is supplied.
 */
export function createGuardrails(
	config: Partial<GuardrailConfig> = {},
	now: () => number = () => Date.now(),
	resolveDatabase?: () => DatabaseSync,
): Guardrails {
	const limits: GuardrailConfig = { ...DEFAULT_GUARDRAIL_CONFIG, ...config };
	const spawnTimestamps = new Map<string, readonly number[]>();
	const lifetimeSpawns = new Map<string, number>();
	const terminalTimestamps = new Map<string, readonly number[]>();
	const messageTimestamps = new Map<string, readonly number[]>();
	const lifetimeMessages = new Map<string, number>();

	/**
	 * Drops the timestamps that have aged out of the rolling window and reports
	 * what is left, so a rate check reads the window rather than the whole log.
	 * @param log - The per-session timestamp map to prune.
	 * @param sessionId - The session whose log to prune.
	 * @returns The timestamps still inside the window.
	 */
	const withinWindow = (
		log: Map<string, readonly number[]>,
		sessionId: string,
	): readonly number[] => {
		const cutoff = now() - RATE_WINDOW_MS;
		const kept = (log.get(sessionId) ?? []).filter((at) => at >= cutoff);
		log.set(sessionId, kept);
		return kept;
	};

	/**
	 * Appends one attempt to a rolling log and hands back the undo for it, so a
	 * creation that fails does not leave its attempt inside the rate window.
	 * @param log - The per-session timestamp map to charge.
	 * @param sessionId - The session the attempt belongs to.
	 * @param at - When the attempt was made.
	 * @returns The undo for exactly this attempt.
	 */
	const chargeRate = (
		log: Map<string, readonly number[]>,
		sessionId: string,
		at: number,
	): (() => void) => {
		log.set(sessionId, [...(log.get(sessionId) ?? []), at]);
		return () => {
			const timestamps = log.get(sessionId) ?? [];
			const charged = timestamps.indexOf(at);
			if (charged < 0) {
				return;
			}
			log.set(sessionId, [
				...timestamps.slice(0, charged),
				...timestamps.slice(charged + 1),
			]);
		};
	};

	/**
	 * Wraps a refund so the caller can invoke it on every failure path without
	 * having to know whether an earlier one already ran.
	 * @param refund - The undo to run at most once.
	 * @returns An idempotent refund.
	 */
	const once = (refund: () => void): (() => void) => {
		let refunded = false;
		return () => {
			if (refunded) {
				return;
			}
			refunded = true;
			refund();
		};
	};

	/**
	 * Resolves the root tree an attempt is charged against, refusing a caller
	 * that has reached the nesting limit or holds no verified delegation root —
	 * the precondition every guarded creation op shares.
	 * @param origin - Resolved caller identity.
	 * @returns The root tree's session id, or the denial that stops the attempt.
	 */
	const resolveChargeableRoot = (
		origin: AgentControlOrigin,
	): GuardrailDenial | { ok: true; rootSessionId: string } => {
		if (origin.rootSessionId !== null && origin.depth < limits.maxSpawnDepth) {
			return { ok: true, rootSessionId: origin.rootSessionId };
		}
		return {
			ok: false,
			code: 'denied-depth',
			reason:
				origin.rootSessionId === null
					? 'Spawn denied because this session has no verified delegation root.'
					: `Spawn depth ${origin.depth} reaches the limit of ${limits.maxSpawnDepth}.`,
		};
	};

	const recentSpawns = (sessionId: string): readonly number[] =>
		withinWindow(spawnTimestamps, sessionId);

	const recentTerminalStarts = (sessionId: string): readonly number[] =>
		withinWindow(terminalTimestamps, sessionId);

	const recentMessages = (sessionId: string): readonly number[] =>
		withinWindow(messageTimestamps, sessionId);

	const totalSpawns = (sessionId: string): number =>
		lifetimeSpawns.get(sessionId) ?? 0;

	const reserveSpawn = (origin: AgentControlOrigin): SpawnReservation => {
		const charged = resolveChargeableRoot(origin);
		if (!charged.ok) {
			return charged;
		}
		const rootSessionId = charged.rootSessionId;
		if (resolveDatabase) {
			const reservedAt = now();
			const durable = reserveAgentControlSpawn({
				at: reservedAt,
				database: resolveDatabase(),
				maxRecent: limits.maxSpawnsPerMinute,
				maxTotal: limits.maxSpawnsPerSession,
				rootSessionId,
				windowStart: reservedAt - RATE_WINDOW_MS,
				workspaceId: origin.workspaceId,
			});
			if (durable.status !== 'reserved') {
				return {
					ok: false,
					code: durable.status === 'quota' ? 'denied-quota' : 'denied-rate',
					reason:
						durable.status === 'quota'
							? `Root-tree spawn quota of ${limits.maxSpawnsPerSession} exhausted.`
							: `Root-tree spawn rate limit of ${limits.maxSpawnsPerMinute}/min exceeded.`,
				};
			}
			let refunded = false;
			return {
				ok: true,
				refund: () => {
					if (refunded) {
						return;
					}
					refunded = true;
					refundAgentControlSpawn({
						database: resolveDatabase(),
						reservationId: durable.reservationId,
					});
				},
			};
		}
		if (totalSpawns(rootSessionId) >= limits.maxSpawnsPerSession) {
			return {
				ok: false,
				code: 'denied-quota',
				reason: `Root-tree spawn quota of ${limits.maxSpawnsPerSession} exhausted.`,
			};
		}
		if (recentSpawns(rootSessionId).length >= limits.maxSpawnsPerMinute) {
			return {
				ok: false,
				code: 'denied-rate',
				reason: `Root-tree spawn rate limit of ${limits.maxSpawnsPerMinute}/min exceeded.`,
			};
		}
		const reservedAt = now();
		const uncharge = chargeRate(spawnTimestamps, rootSessionId, reservedAt);
		lifetimeSpawns.set(rootSessionId, totalSpawns(rootSessionId) + 1);
		return {
			ok: true,
			refund: once(() => {
				uncharge();
				const remaining = Math.max(0, totalSpawns(rootSessionId) - 1);
				if (remaining === 0) {
					lifetimeSpawns.delete(rootSessionId);
				} else {
					lifetimeSpawns.set(rootSessionId, remaining);
				}
			}),
		};
	};

	const reserveTerminalStart = (
		origin: AgentControlOrigin,
		openTerminals: number,
	): SpawnReservation => {
		const charged = resolveChargeableRoot(origin);
		if (!charged.ok) {
			return charged;
		}
		if (openTerminals >= limits.maxOpenTerminals) {
			return {
				ok: false,
				code: 'denied-quota',
				reason: `This delegation tree already has ${openTerminals} terminals open, which is the limit of ${limits.maxOpenTerminals}. Only what is still open counts against it, so close a spawn terminal you have finished with (\`ensemblr_stop_terminal\` with \`close: true\`) or stop a script you no longer need, and the slot is yours again.`,
			};
		}
		if (
			recentTerminalStarts(charged.rootSessionId).length >=
			limits.maxTerminalStartsPerMinute
		) {
			return {
				ok: false,
				code: 'denied-rate',
				reason: `Terminal start rate limit of ${limits.maxTerminalStartsPerMinute}/min exceeded.`,
			};
		}
		return {
			ok: true,
			refund: once(
				chargeRate(terminalTimestamps, charged.rootSessionId, now()),
			),
		};
	};

	const evaluateConciergeMessage = (sessionId: string): GuardrailResult => {
		if (
			(lifetimeMessages.get(sessionId) ?? 0) >=
			limits.maxConciergeMessagesPerSession
		) {
			return {
				code: 'denied-quota',
				ok: false,
				reason: `This conversation has already sent the Concierge ${limits.maxConciergeMessagesPerSession} messages, which is its lifetime allowance. Anything further belongs in your last message, which the Concierge can read with \`ensemblr_get_last_message\`.`,
			};
		}
		if (
			recentMessages(sessionId).length >= limits.maxConciergeMessagesPerMinute
		) {
			return {
				code: 'denied-rate',
				ok: false,
				reason: `Message rate limit of ${limits.maxConciergeMessagesPerMinute}/min to the Concierge exceeded. It is one conversation supervising several workspaces, and a burst from one of them crowds out the rest — get on with the work and say the rest in one message later.`,
			};
		}
		return { ok: true };
	};

	const recordConciergeMessage = (sessionId: string): void => {
		const log = messageTimestamps.get(sessionId) ?? [];
		messageTimestamps.set(sessionId, [...log, now()]);
		lifetimeMessages.set(sessionId, (lifetimeMessages.get(sessionId) ?? 0) + 1);
	};

	const release = (sessionId: string): void => {
		messageTimestamps.delete(sessionId);
		lifetimeMessages.delete(sessionId);
	};

	const evaluateWaitTarget = (
		targetSessionId: string,
		ancestorSessionIds: readonly string[],
	): GuardrailResult => {
		if (ancestorSessionIds.includes(targetSessionId)) {
			return {
				ok: false,
				code: 'denied-deadlock',
				reason: 'Refusing to wait on an ancestor session (would deadlock).',
			};
		}
		return { ok: true };
	};

	return {
		waitTimeoutMs: limits.waitTimeoutMs,
		reserveSpawn,
		reserveTerminalStart,
		evaluateConciergeMessage,
		recordConciergeMessage,
		release,
		evaluateWaitTarget,
	};
}
