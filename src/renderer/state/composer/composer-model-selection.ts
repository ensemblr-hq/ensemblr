import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useMemo } from 'react';

import { agentModelsQuery } from '@/renderer/api/ensemblr-queries';
import {
	chatModelOverrideAtomFamily,
	chatThinkingOverrideAtomFamily,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerModelOption,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';
import { normalizeAgentProviderId } from '@/shared/agent-provider';
import {
	getThinkingLevelLabel,
	listThinkingLevels,
} from '@/shared/agent-thinking';

/** The persisted session fields the model and thinking ladders resolve against. */
interface PersistedSelection {
	model?: string | null;
	thinkingLevel?: string | null;
}

/**
 * Level a chat lands on when the one it resolved belongs to the other runtime's
 * vocabulary. It is the one rung both ladders publish, so the chip always names
 * something the selected model accepts.
 */
const FALLBACK_THINKING_LEVEL = 'medium';

/**
 * Keeps the resolved level inside the selected model's own ladder. The chain
 * below crosses runtimes freely — the Settings default is one value for the
 * whole app, and a spawned child's session was written by another agent — so a
 * Claude chat's `max` can land on a Pi model, which the picker cannot name and
 * the runtime would reject. Left alone while the catalog has not placed the
 * model, since an unknown ladder is no reason to overrule the user's pick.
 * @param requested - The level the resolution chain produced.
 * @param options - The levels the selected model accepts, empty when unknown.
 * @returns The level to run at, or null when none of them fit.
 */
function clampToLadder(
	requested: string | null,
	options: readonly ComposerThinkingOption[],
): string | null {
	if (options.length === 0 || options.some((level) => level.id === requested)) {
		return requested;
	}
	return (
		options.find((level) => level.id === FALLBACK_THINKING_LEVEL)?.id ?? null
	);
}

/**
 * Resolves which model and thinking level a chat runs at, and the options the
 * pickers offer.
 *
 * Both axes resolve the same way: explicit per-chat pick → persisted session
 * value → Settings default → runtime-reported default. Existing chats keep what
 * their session was started with when the default changes; only fresh chats
 * inherit the latest configured default. The persisted rung matters most for a
 * spawned sub-agent, which has no per-chat override of its own — without it the
 * tab would report the user's default rather than what the child is really
 * running.
 * @param chatTabId - Chat tab the per-chat overrides are keyed by
 * @param persistedActiveSession - The chat's persisted session, once loaded
 * @returns The resolved picks, the options, and the override setters
 */
export function useComposerModelSelection({
	chatTabId,
	persistedActiveSession,
}: {
	chatTabId: string;
	persistedActiveSession: PersistedSelection | undefined;
}) {
	const { data: models } = useQuery(agentModelsQuery);

	// Per-chat overrides win when set; otherwise a new chat inherits the
	// Settings → Default model/thinking. Keying the override atoms by chat-tab
	// id keeps one chat's pick from leaking into another.
	const [chatModelOverride, setChatModelOverride] = useAtom(
		chatModelOverrideAtomFamily(chatTabId),
	);
	const [chatThinkingOverride, setChatThinkingOverride] = useAtom(
		chatThinkingOverrideAtomFamily(chatTabId),
	);
	const [defaultModelId] = useAtom(defaultChatModelAtom);
	const [defaultThinkingLevel] = useAtom(defaultChatThinkingLevelAtom);

	const availableModels = useMemo<readonly ComposerModelOption[]>(() => {
		if (!models) {
			return [];
		}
		return models.models.map((model) => ({
			agentProvider: normalizeAgentProviderId(model.agentProvider),
			contextWindow: model.contextWindow,
			displayName: model.displayName,
			id: model.id,
			isDefault: model.id === models.defaultModelId,
			vendor: model.vendor,
		}));
	}, [models]);

	const modelId =
		chatModelOverride ??
		persistedActiveSession?.model ??
		defaultModelId ??
		models?.defaultModelId ??
		availableModels[0]?.id ??
		null;
	const availableThinkingLevels = useMemo<
		readonly ComposerThinkingOption[]
	>(() => {
		if (!models) {
			return [];
		}
		const selectedModel = models.models.find((model) => model.id === modelId);
		const provider = normalizeAgentProviderId(selectedModel?.agentProvider);
		// A model's own list is authoritative — Claude publishes exactly the efforts
		// it accepts, and offering one it would reject is worse than offering fewer.
		// The runtime's canonical ladder stands in only when nothing was published,
		// which is how a pi build that doesn't enumerate levels still gets a picker.
		const supplied = selectedModel?.thinkingLevels ?? [];
		const levels =
			supplied.length > 0 ? supplied : listThinkingLevels(provider);
		return levels.map((level) => ({
			id: level,
			label: getThinkingLevelLabel(provider, level),
		}));
	}, [models, modelId]);

	const thinkingLevel = clampToLadder(
		chatThinkingOverride ??
			persistedActiveSession?.thinkingLevel ??
			defaultThinkingLevel ??
			models?.defaultThinkingLevel ??
			null,
		availableThinkingLevels,
	);

	return {
		availableModels,
		availableThinkingLevels,
		modelId,
		setChatModelOverride,
		setChatThinkingOverride,
		thinkingLevel,
	};
}
