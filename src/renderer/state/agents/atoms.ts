import { atom } from 'jotai';

import {
	type AgentActivityState,
	createAgentActivityState,
	reduceAgentActivity,
} from '@/shared/agent-activity';
import type {
	AgentPersistedEnvelope,
	AgentSessionContextSnapshotWire,
	AgentSessionSnapshotWire,
	AgentSessionStatusWire,
} from '@/shared/ipc/contracts/agent-session';

/** Compact live state for one workspace conversation, keyed by Ensemblr session id. */
export interface AgentConversationLiveState {
	activity: AgentActivityState;
	branchId: string;
	contextUsage: AgentSessionContextSnapshotWire | null;
	lastEventOrdinal: number;
	runtimeIdentity: string;
	snapshotUpdatedAt: string;
	status: AgentSessionStatusWire;
}

/** Compact agent activity grouped first by workspace and then by session id. */
export const agentConversationLiveStateAtom = atom<
	Readonly<Record<string, Readonly<Record<string, AgentConversationLiveState>>>>
>({});

/** Builds the identity whose change retires activity from a replaced runtime. */
function runtimeIdentityOf(session: AgentSessionSnapshotWire): string {
	return `${session.provider}:${session.runtimeSessionId ?? ''}`;
}

/** Seeds one workspace from its lightweight session snapshots. */
export const seedAgentConversationSnapshotsAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessions: readonly AgentSessionSnapshotWire[];
			workspaceId: string;
		},
	) => {
		const current = get(agentConversationLiveStateAtom);
		const previousWorkspace = current[input.workspaceId] ?? {};
		const nextWorkspace: Record<string, AgentConversationLiveState> = {};
		for (const session of input.sessions) {
			const runtimeIdentity = runtimeIdentityOf(session);
			const previous = previousWorkspace[session.id];
			const sameRuntime =
				previous?.runtimeIdentity === runtimeIdentity &&
				previous.branchId === session.branchId;
			const snapshotOrdinal = session.activityOrdinal ?? -1;
			const preserveLiveState =
				sameRuntime &&
				(session.activityOrdinal === undefined
					? previous.snapshotUpdatedAt === session.updatedAt
					: previous.lastEventOrdinal > snapshotOrdinal);
			nextWorkspace[session.id] = {
				activity: preserveLiveState
					? previous.activity
					: createAgentActivityState(session.currentTools),
				branchId: session.branchId,
				contextUsage: preserveLiveState
					? previous.contextUsage
					: (session.contextUsage ?? null),
				lastEventOrdinal: preserveLiveState
					? previous.lastEventOrdinal
					: snapshotOrdinal,
				runtimeIdentity,
				snapshotUpdatedAt: session.updatedAt,
				status: preserveLiveState ? previous.status : session.status,
			};
		}
		set(agentConversationLiveStateAtom, {
			...current,
			[input.workspaceId]: nextWorkspace,
		});
	},
);

/** Applies a non-token session event to the compact workspace projection. */
export const applyAgentConversationEventAtom = atom(
	null,
	(
		get,
		set,
		input: {
			branchId: string;
			envelope: AgentPersistedEnvelope;
			ordinal: number;
			sessionId: string;
			workspaceId: string;
		},
	) => {
		const current = get(agentConversationLiveStateAtom);
		const workspace = current[input.workspaceId];
		const previous = workspace?.[input.sessionId];
		if (
			!previous ||
			previous.branchId !== input.branchId ||
			input.ordinal <= previous.lastEventOrdinal
		) {
			return;
		}
		const contextUsage =
			input.envelope.kind === 'context-usage'
				? { reading: 'live' as const, usage: input.envelope.usage }
				: previous.contextUsage;
		const status =
			input.envelope.kind === 'status'
				? input.envelope.status
				: previous.status;
		const activity = reduceAgentActivity(previous.activity, input.envelope);
		set(agentConversationLiveStateAtom, {
			...current,
			[input.workspaceId]: {
				...workspace,
				[input.sessionId]: {
					...previous,
					activity,
					contextUsage,
					lastEventOrdinal: input.ordinal,
					status,
				},
			},
		});
	},
);
