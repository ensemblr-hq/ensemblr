import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { agentSessionEventsQuery } from '@/renderer/api/ensemblr-queries';
import { resolveContextUsage } from '@/renderer/lib/workbench';
import {
	type TaggedContextUsage,
	type TaggedPlanUsage,
	toComposerContextUsage,
	useAgentSessionEventSync,
} from '@/renderer/state/composer/agent-session-event-sync';
import {
	foldTaggedPlanUsage,
	planUsageFromEvents,
	resolvePlanUsage,
	type TaggedComposerPlanUsage,
} from '@/renderer/state/composer/plan-usage';
import type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerPlanUsage,
} from '@/renderer/types/workbench';
import type {
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
} from '@/shared/ipc/contracts/agent-session';

/** Both gauges a chat can show, as its session currently reports them. */
export interface SessionUsage {
	contextUsage: ComposerContextUsage | null;
	planUsage: ComposerPlanUsage | null;
}

/** What a session's stored events say about its two gauges, before the live half is layered on. */
interface PersistedSessionUsage {
	contextUsage: ComposerContextUsage | null;
	planUsage: ComposerPlanUsage | null;
}

/**
 * Replays a session's stored events into the two gauge readings and nothing
 * else.
 *
 * This runs as the query's `select` rather than as a `useMemo` over the raw
 * event list, and that is a rendering constraint rather than a tidiness one. The
 * timeline merges every streamed token into this same cache, so an observer of
 * the raw list wakes once per token — and this hook is reached from the workspace
 * route, so waking it re-rendered the entire screen (tabs, composer, dock, review
 * panel, every message row and every popover inside them) on every token. Query
 * structurally shares a `select` result, so a fold that comes back deeply equal
 * keeps its previous reference and notifies nobody, which is what keeps a
 * streaming turn off the shell's render path.
 * @param result - The session's stored events, oldest first.
 * @returns The gauge readings the events replay to.
 */
function selectPersistedUsage(
	result: ListAgentSessionEventsResult,
): PersistedSessionUsage {
	return {
		contextUsage: latestContextUsageFromEvents(result.events),
		planUsage: planUsageFromEvents(result.events),
	};
}

/**
 * Reconciles what a chat's session has reported live against what its stored
 * events replay, and keeps the subscription that feeds the live half.
 *
 * Both readings are tagged by session id, so a snapshot left over from the chat
 * the composer was previously bound to is treated as absent rather than shown
 * against the wrong session — which is what lets this run without a
 * reset-on-change effect.
 * @param input - The bound session and branch, the selected model, and the workspace.
 * @returns The context and plan gauges to render.
 */
export function useLiveSessionUsage({
	activeSessionId,
	branchId,
	model,
	workspaceId,
}: {
	activeSessionId: string | null;
	branchId: string;
	model: ComposerModelOption | undefined;
	workspaceId: string;
}): SessionUsage {
	const [liveContextUsage, setLiveContextUsage] =
		useState<TaggedContextUsage | null>(null);
	const [livePlanUsage, setLivePlanUsage] =
		useState<TaggedComposerPlanUsage | null>(null);

	/** Folds a live plan reading into this chat's running snapshot. */
	const onPlanUsage = useCallback((reading: TaggedPlanUsage) => {
		setLivePlanUsage((previous) => foldTaggedPlanUsage(previous, reading));
	}, []);

	useAgentSessionEventSync({
		activeSessionId,
		onContextUsage: setLiveContextUsage,
		onPlanUsage,
		workspaceId,
	});

	const { data: persistedUsage } = useQuery({
		...agentSessionEventsQuery(branchId),
		select: selectPersistedUsage,
	});
	const persistedContextUsage = persistedUsage?.contextUsage ?? null;
	const persistedPlanUsage = persistedUsage?.planUsage ?? null;

	const boundContextUsage =
		liveContextUsage?.sessionId === activeSessionId
			? (liveContextUsage?.usage ?? null)
			: null;

	return {
		contextUsage: resolveContextUsage(
			boundContextUsage ?? persistedContextUsage,
			model,
		),
		planUsage: resolvePlanUsage({
			live: livePlanUsage,
			persisted: persistedPlanUsage,
			sessionId: activeSessionId,
		}),
	};
}

/**
 * Finds the newest persisted context-usage event for the active session.
 * @param events - The session's persisted events, oldest first.
 * @returns The newest reading, or null when the session reported none.
 */
function latestContextUsageFromEvents(
	events: readonly AgentSessionEventWire[],
): ComposerContextUsage | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const payload = events[index]?.payload;
		if (payload?.kind === 'context-usage') {
			return toComposerContextUsage(payload.usage);
		}
	}
	return null;
}
