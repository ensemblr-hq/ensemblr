import type { DatabaseSync } from 'node:sqlite';

import type { PiPersistedEnvelope } from '../../shared/ipc/contracts/pi-session';
import {
	type AppendPiEventInput,
	appendPiEvent,
	type PiEventRow,
} from '../storage/repositories/index.ts';
import type { PiAgentEvent } from './pi-agent-types.ts';

/**
 * Maps a `PiAgentEvent` to the tagged-union envelope persisted in
 * `pi_session_events.payload_json`. The envelope is stable across the IPC
 * boundary (see `PiPersistedEnvelope` in `shared/ipc/contracts/pi-session.ts`)
 * so the renderer matches on `payload.kind` instead of sniffing raw Pi shapes.
 */
export function eventPayload(event: PiAgentEvent): PiPersistedEnvelope {
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
					message: event.error.message,
					recoverable: event.error.recoverable,
				},
				kind: 'error',
			};
		case 'message':
			return { kind: 'message', payload: event.payload, role: event.role };
		case 'metadata':
			return {
				kind: 'metadata',
				metadata: {
					model: event.metadata.model,
					sessionId: event.metadata.sessionId,
					status: event.metadata.status,
				},
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
 * Persists a runtime event to `pi_session_events`. The stream discriminant
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
	event: PiAgentEvent;
	sessionId: string;
	turnId: string | null;
}): PiEventRow | null {
	const input: AppendPiEventInput = {
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
		return appendPiEvent({ database, input });
	} catch (error) {
		// Persistence is best-effort on the live path; the timeline rehydrates
		// from whatever events did land. Surface for observability.
		console.warn('[pi-session] failed to persist runtime event', {
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
}): PiEventRow {
	const envelope: PiPersistedEnvelope = {
		kind: 'metadata',
		metadata: { chatTitle: title },
	};
	return appendPiEvent({
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
 * Appends a synthetic metadata event signalling that an auto branch-naming
 * rename landed, so renderer subscribers refetch the workspace list.
 */
export function appendWorkspaceRenamedMetadataEvent({
	branchId,
	database,
}: {
	branchId: string;
	database: DatabaseSync;
}): PiEventRow {
	const envelope: PiPersistedEnvelope = {
		kind: 'metadata',
		metadata: { workspaceRenamed: true },
	};
	return appendPiEvent({
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
