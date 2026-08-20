import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	subscribeAgentSessionEvents,
} from '@/renderer/api/ensemblr-queries';
import {
	type PlanUsageReading,
	toPlanUsageReading,
} from '@/renderer/state/composer/plan-usage';
import type { ComposerContextUsage } from '@/renderer/types/workbench';
import type { AgentPersistedEnvelope } from '@/shared/ipc/contracts/agent-message-payloads';

/** Live context usage, tagged with the session it was measured on. */
export interface TaggedContextUsage {
	sessionId: string;
	usage: ComposerContextUsage;
}

/** One live plan-usage reading, tagged with the session it came from. */
export type TaggedPlanUsage = PlanUsageReading & { sessionId: string };

/**
 * Converts the runtime's usage wire payload into the composer meter model.
 * @param usage - Context-window figures as the runtime reports them
 * @returns Used and maximum token counts for the composer gauge
 */
export function toComposerContextUsage(usage: {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
}): ComposerContextUsage {
	const maxTokens = Math.max(0, usage.contextWindow);
	const usedTokens =
		usage.tokens ??
		(usage.percent === null
			? 0
			: Math.round(maxTokens * (usage.percent / 100)));
	return {
		maxTokens,
		usedTokens,
	};
}

/**
 * Detects the metadata event emitted when the main process finishes tab titling.
 * @param payload - The persisted event envelope carried by the broadcast
 * @returns True when the event names a freshly generated chat title
 */
function hasChatTitleMetadata(payload: AgentPersistedEnvelope | null): boolean {
	if (payload?.kind !== 'metadata') {
		return false;
	}
	return typeof payload.metadata.chatTitle === 'string';
}

/**
 * Detects the metadata event emitted after an auto branch-naming rename.
 * @param payload - The persisted event envelope carried by the broadcast
 * @returns True when the event reports the workspace was renamed
 */
function hasWorkspaceRenamedMetadata(
	payload: AgentPersistedEnvelope | null,
): boolean {
	if (payload?.kind !== 'metadata') {
		return false;
	}
	return payload.metadata.workspaceRenamed === true;
}

/**
 * Subscribes to agent session broadcasts for one workspace and folds them back
 * into cached state: live context usage for the gauge, a chat-tab refetch when a
 * title lands, a navigation refetch after an auto-rename, and a session refetch
 * on any status change. Broadcasts for another workspace or another session are
 * ignored.
 *
 * A usage reading refetches nothing. The timeline already merges every
 * broadcast into the event cache itself, so re-reading the branch here would
 * both re-map the whole transcript mid-stream and overwrite the deltas that
 * landed while that read was in flight.
 * @param activeSessionId - Session the composer is bound to, or null while new
 * @param onContextUsage - Records the newest usage reading for the gauge
 * @param onPlanUsage - Records a plan-window move, a polled read of every window, or a sealed turn's cost
 * @param workspaceId - Workspace whose broadcasts are relevant here
 */
export function useAgentSessionEventSync({
	activeSessionId,
	onContextUsage,
	onPlanUsage,
	workspaceId,
}: {
	activeSessionId: string | null;
	onContextUsage: (usage: TaggedContextUsage) => void;
	onPlanUsage: (usage: TaggedPlanUsage) => void;
	workspaceId: string;
}): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		const unsubscribe = subscribeAgentSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			if (activeSessionId && broadcast.sessionId !== activeSessionId) {
				return;
			}
			const payload = broadcast.event.payload;
			if (payload?.kind === 'context-usage') {
				onContextUsage({
					sessionId: broadcast.sessionId,
					usage: toComposerContextUsage(payload.usage),
				});
				return;
			}
			const planReading = toPlanUsageReading(payload);
			if (planReading) {
				onPlanUsage({ ...planReading, sessionId: broadcast.sessionId });
				return;
			}
			if (broadcast.event.eventType === 'metadata') {
				if (hasChatTitleMetadata(broadcast.event.payload)) {
					void queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
					});
				}
				if (hasWorkspaceRenamedMetadata(broadcast.event.payload)) {
					void queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
					});
				}
				return;
			}
			if (broadcast.event.eventType !== 'status') {
				return;
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
			});
		});
		return unsubscribe;
	}, [activeSessionId, onContextUsage, onPlanUsage, queryClient, workspaceId]);
}
