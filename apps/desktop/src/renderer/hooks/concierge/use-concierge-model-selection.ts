import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { agentModelsQuery } from '@/renderer/api/ensemblr';
import { toComposerModelOptions } from '@/renderer/lib/workbench';
import { thinkingLevelLabel } from '@/renderer/lib/workbench/thinking-labels';
import {
	conciergeModelAtom,
	conciergeProviderAtom,
	conciergeThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerModelOption,
	ComposerThinkingOption,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import { listThinkingLevels } from '@/shared/agent-thinking';

/** What the Concierge composer needs to render and drive its two pickers. */
export interface ConciergeModelSelection {
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	modelId: string | null;
	/** Runtime the selected model belongs to, for the thinking ladder's labels. */
	provider: AgentProviderId;
	setModel: (modelId: string) => void;
	setThinkingLevel: (thinkingLevel: string) => void;
	thinkingLevel: string | null;
}

/**
 * Model the Concierge falls back to when the user has picked none of its own.
 *
 * Deliberately not the app-wide default: that one belongs to whichever runtime
 * the user last chose for a *chat*, and reading a runtime back off it would open
 * the Concierge on the runtime `app.concierge.provider` does not name — which the
 * first turn after a restart resolves by reopening the session fresh, throwing
 * the resumed conversation away with no memory pass and nothing said. So the
 * app-wide default is taken only where it sits on the Concierge's own runtime,
 * and null hands the choice to that runtime rather than to the other one.
 * @param options - Every model the catalogue offers.
 * @param provider - The runtime `app.concierge.provider` names.
 * @param appDefaultModelId - The catalogue's own default, if it published one.
 * @returns The model to open on, or null to take the runtime's default.
 */
function defaultModelOn(
	options: readonly ComposerModelOption[],
	provider: AgentProviderId,
	appDefaultModelId: string | null | undefined,
): string | null {
	const onProvider = options.filter(
		(option) => option.agentProvider === provider,
	);
	return (
		onProvider.find((option) => option.id === appDefaultModelId)?.id ??
		onProvider[0]?.id ??
		null
	);
}

/**
 * Resolves the model and thinking level the Concierge runs at, and the options
 * its pickers offer.
 *
 * Unlike a workspace chat there is no per-tab override to layer on: the
 * Concierge is one conversation, so the pickers write straight through to
 * `app.concierge` in `config.json` and that setting *is* the selection.
 *
 * Deliberately no `lockedProvider`: a workspace chat pins its runtime because
 * its session outlives the picker, while clearing the Concierge's context opens
 * a fresh session on whatever is selected — so switching runtime is a thing the
 * user can actually do here, and greying the other half of the list would say
 * otherwise.
 * @returns The Concierge model selection.
 */
export function useConciergeModelSelection(): ConciergeModelSelection {
	const { t } = useTranslation();
	const { data: models } = useQuery(agentModelsQuery);
	const [selectedModel, setSelectedModel] = useAtom(conciergeModelAtom);
	const [thinking, setThinking] = useAtom(conciergeThinkingLevelAtom);
	const [configuredProvider, setProvider] = useAtom(conciergeProviderAtom);

	const availableModels = useMemo<readonly ComposerModelOption[]>(
		() => toComposerModelOptions(models),
		[models],
	);

	const modelId =
		selectedModel ??
		defaultModelOn(availableModels, configuredProvider, models?.defaultModelId);

	const providerOfSelection: AgentProviderId =
		availableModels.find((option) => option.id === modelId)?.agentProvider ??
		configuredProvider;

	const availableThinkingLevels = useMemo<readonly ComposerThinkingOption[]>(
		() =>
			listThinkingLevels(providerOfSelection).map((level) => ({
				id: level,
				label: thinkingLevelLabel(t, level),
			})),
		[providerOfSelection, t],
	);

	const setModel = useCallback(
		(nextModelId: string) => {
			setSelectedModel(nextModelId);
			// The runtime rides along with the model rather than being a second
			// setting the user has to keep in step: a model belongs to exactly one
			// runtime, and a pair that disagrees is refused at session open.
			const provider = availableModels.find(
				(option) => option.id === nextModelId,
			)?.agentProvider;
			if (provider) {
				setProvider(provider);
			}
		},
		[availableModels, setProvider, setSelectedModel],
	);

	return {
		availableModels,
		availableThinkingLevels,
		modelId,
		provider: providerOfSelection,
		setModel,
		setThinkingLevel: setThinking,
		thinkingLevel: thinking ?? models?.defaultThinkingLevel ?? null,
	};
}
