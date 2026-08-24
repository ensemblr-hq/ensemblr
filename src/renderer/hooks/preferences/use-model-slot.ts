import { type PrimitiveAtom, useAtom } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';

import {
	type AgentProviderId,
	normalizeAgentProviderId,
} from '@/shared/agent-provider';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/**
 * The catalogue state every model slot on the Models pane reads, resolved once
 * by the pane and handed to each slot rather than recomputed per slot.
 */
export interface ModelCatalogue {
	/** Model the runtime picks when a slot has no explicit choice. */
	agentDefaultModelId: string | null;
	/** Ids the user has hidden, which no slot may point at. */
	hiddenSet: ReadonlySet<string>;
	/** Models still visible, in catalogue order. */
	list: readonly AgentModelOption[];
}

/** One configured model slot: what it points at now, and how to move it. */
export interface ModelSlot {
	choose: (modelId: string | null) => void;
	levels: readonly string[];
	modelId: string | null;
	provider: AgentProviderId;
	setThinking: (level: string | null) => void;
	thinking: string | null;
}

/**
 * Resolves which agent runtime drives a model, so its thinking levels are
 * labelled in that runtime's vocabulary.
 * @param list - Available agent model options.
 * @param modelId - Id of the model to look up, or null.
 * @returns The owning runtime, normalized.
 */
function providerFor(
	list: readonly AgentModelOption[],
	modelId: string | null,
): AgentProviderId {
	return normalizeAgentProviderId(
		modelId ? list.find((m) => m.id === modelId)?.agentProvider : undefined,
	);
}

/**
 * Reads the thinking levels a model offers.
 * @param list - Available agent model options.
 * @param modelId - Id of the model to look up, or null.
 * @returns Its levels, or none when no model is resolved.
 */
function thinkingLevelsFor(
	list: readonly AgentModelOption[],
	modelId: string | null,
): readonly string[] {
	if (!modelId) {
		return [];
	}
	return list.find((m) => m.id === modelId)?.thinkingLevels ?? [];
}

/**
 * Binds one model-slot atom pair to the catalogue, resolving the slot's model,
 * levels and runtime, and moving it off a model the user has just hidden.
 *
 * `onChoose` exists for the Concierge slot, which persists the model's runtime
 * as a second atom: a slot's model and its provider have to move together,
 * because a pair that disagrees is refused when that session opens.
 * @param catalogue - The shared catalogue state the pane resolved.
 * @param modelAtom - Atom holding this slot's chosen model id.
 * @param thinkingAtom - Atom holding this slot's thinking level.
 * @param onChoose - Extra persistence to run whenever the model changes.
 * @returns The resolved slot and its setters.
 */
export function useModelSlot(
	catalogue: ModelCatalogue,
	modelAtom: PrimitiveAtom<string | null>,
	thinkingAtom: PrimitiveAtom<string | null>,
	onChoose?: (modelId: string | null, provider: AgentProviderId) => void,
): ModelSlot {
	const { agentDefaultModelId, hiddenSet, list } = catalogue;
	const [model, setModel] = useAtom(modelAtom);
	const [thinking, setThinking] = useAtom(thinkingAtom);

	const choose = useCallback(
		(modelId: string | null) => {
			setModel(modelId);
			onChoose?.(modelId, providerFor(list, modelId));
		},
		[list, onChoose, setModel],
	);

	const modelId = model ?? agentDefaultModelId;

	// The visibility editor blocks hiding the last model, so there is always one
	// to fall back to; without this the select points at an id it no longer lists.
	useEffect(() => {
		const firstVisibleId = list[0]?.id;
		if (firstVisibleId && modelId && hiddenSet.has(modelId)) {
			choose(firstVisibleId);
		}
	}, [choose, hiddenSet, list, modelId]);

	return useMemo(
		() => ({
			choose,
			levels: thinkingLevelsFor(list, modelId),
			modelId,
			provider: providerFor(list, modelId),
			setThinking,
			thinking,
		}),
		[choose, list, modelId, setThinking, thinking],
	);
}
