import type { DatabaseSync } from 'node:sqlite';

import { classifyAgentFailure } from '../../shared/agent-failure.ts';
import type { AgentPersistedEnvelope } from '../../shared/ipc/contracts/agent-session';
import {
	type AgentEventRow,
	type AppendAgentEventInput,
	appendAgentEvent,
} from '../storage/repositories/index.ts';
import type { AgentEvent } from './agent-types.ts';

/**
 * Maps a `AgentEvent` to the tagged-union envelope persisted in
 * `agent_session_events.payload_json`. The envelope is stable across the IPC
 * boundary (see `AgentPersistedEnvelope` in `shared/ipc/contracts/agent-session.ts`)
 * so the renderer matches on `payload.kind` instead of sniffing raw runtime shapes.
 */
export function eventPayload(event: AgentEvent): AgentPersistedEnvelope {
	switch (event.type) {
		case 'context-usage':
			return {
				kind: 'context-usage',
				usage: {
					contextWindow: event.usage.contextWindow,
					percent: event.usage.percent,
					tokens: event.usage.tokens,
				},
			};
		case 'error':
			return {
				error: {
					code: event.error.code,
					detail: event.error.detail ?? null,
					failureClass: classifyAgentFailure(event.error),
					message: event.error.message,
					recoverable: event.error.recoverable,
					resetsAt: event.error.resetsAt ?? null,
				},
				kind: 'error',
			};
		case 'message':
			return {
				kind: 'message',
				...(event.parentToolCallId
					? { parentToolCallId: event.parentToolCallId }
					: {}),
				payload: event.payload,
				role: event.role,
			};
		case 'metadata':
			return {
				kind: 'metadata',
				metadata: {
					model: event.metadata.model,
					sessionId: event.metadata.sessionId,
					status: event.metadata.status,
				},
			};
		case 'plan-limit':
			return {
				kind: 'plan-limit',
				limit: {
					status: event.limit.status,
					window: { ...event.limit.window },
				},
			};
		case 'plan-windows':
			return {
				kind: 'plan-windows',
				windows: event.windows.map((window) => ({ ...window })),
			};
		case 'session-cost':
			return {
				cost: {
					models: event.cost.models.map((model) => ({ ...model })),
					totalCostUsd: event.cost.totalCostUsd,
				},
				kind: 'session-cost',
			};
		case 'shutdown':
			return { kind: 'shutdown', reason: event.reason };
		case 'status':
			return {
				kind: 'status',
				previous: event.previous,
				status: event.status,
			};
	}
}

/**
 * Persists a runtime event to `agent_session_events`. The stream discriminant
 * routes stderr-tagged errors to the `stderr` stream and everything else to
 * `protocol`. Returns the persisted row, or `null` when persistence failed
 * (best-effort on the live path; timeline rehydrates from whatever lands).
 */
export function persistRuntimeEvent({
	branchId,
	database,
	event,
	sessionId,
	turnId,
}: {
	branchId: string;
	database: DatabaseSync;
	event: AgentEvent;
	sessionId: string;
	turnId: string | null;
}): AgentEventRow | null {
	const input: AppendAgentEventInput = {
		branchId,
		createdAt: event.at,
		eventType: event.type,
		payload: eventPayload(event),
		stream:
			event.type === 'error' && event.error.message === 'Pi RPC stderr'
				? 'stderr'
				: 'protocol',
		turnId,
	};

	try {
		return appendAgentEvent({ database, input });
	} catch (error) {
		// Persistence is best-effort on the live path; the timeline rehydrates
		// from whatever events did land. Surface for observability.
		console.warn('[agent-session] failed to persist runtime event', {
			error,
			sessionId,
		});
		return null;
	}
}

/**
 * Appends a synthetic metadata event used by the chat-title service to
 * broadcast a tab rename to renderer subscribers.
 */
export function appendChatTitleMetadataEvent({
	branchId,
	database,
	title,
}: {
	branchId: string;
	database: DatabaseSync;
	title: string;
}): AgentEventRow {
	const envelope: AgentPersistedEnvelope = {
		kind: 'metadata',
		metadata: { chatTitle: title },
	};
	return appendAgentEvent({
		database,
		input: {
			branchId,
			eventType: 'metadata',
			payload: envelope,
			stream: 'protocol',
			turnId: null,
		},
	});
}

/**
 * Appends a synthetic assistant message to a branch's timeline, so app-authored
 * content the agent never produced — a submitted plan, most of all — still
 * lands as a persisted, broadcastable chat bubble. The envelope matches a
 * finalized assistant answer (`agent` role, a single `text` part) so the
 * renderer and the last-message recovery in agent-control read it exactly like
 * one the runtime emitted.
 * @param branchId - Branch whose timeline the message joins.
 * @param database - Open session database.
 * @param text - Markdown body of the message.
 * @returns The persisted event row.
 */
export function appendAgentMessageEvent({
	branchId,
	database,
	text,
}: {
	branchId: string;
	database: DatabaseSync;
	text: string;
}): AgentEventRow {
	const envelope: AgentPersistedEnvelope = {
		kind: 'message',
		payload: { kind: 'text', text },
		role: 'agent',
	};
	return appendAgentEvent({
		database,
		input: {
			branchId,
			eventType: 'message',
			payload: envelope,
			stream: 'protocol',
			turnId: null,
		},
	});
}

/**
 * Appends a synthetic metadata event signalling that an auto branch-naming
 * rename landed, so renderer subscribers refetch the workspace list.
 */
export function appendWorkspaceRenamedMetadataEvent({
	branchId,
	database,
}: {
	branchId: string;
	database: DatabaseSync;
}): AgentEventRow {
	const envelope: AgentPersistedEnvelope = {
		kind: 'metadata',
		metadata: { workspaceRenamed: true },
	};
	return appendAgentEvent({
		database,
		input: {
			branchId,
			eventType: 'metadata',
			payload: envelope,
			stream: 'protocol',
			turnId: null,
		},
	});
}
