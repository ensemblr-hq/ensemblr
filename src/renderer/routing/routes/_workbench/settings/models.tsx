import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { agentModelsQuery } from '@/renderer/api/ensemblr';
import { ModelVisibilityList } from '@/renderer/components/settings/model-visibility-list';
import { ModelSelect } from '@/renderer/components/settings/models/model-select';
import { ThinkingLevelSelect } from '@/renderer/components/settings/models/thinking-level-select';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import {
	SettingsErrorState,
	SettingsLoadingState,
} from '@/renderer/components/settings/settings-async-state';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	type ModelSlot,
	useModelSlot,
} from '@/renderer/hooks/preferences/use-model-slot';
import {
	conciergeModelAtom,
	conciergeProviderAtom,
	conciergeThinkingLevelAtom,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	hiddenModelsAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type { AgentProviderId } from '@/shared/agent-provider';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/** Route for the Models settings section; renders the models panel populated from agent capability discovery. */
export const Route = createFileRoute('/_workbench/settings/models')({
	component: ModelsSettings,
});

/** The copy one model-slot row needs, resolved by the pane so the row stays presentational. */
interface ModelSlotRowLabels {
	description: string;
	label: string;
	modelAriaLabel: string;
	thinkingAriaLabel: string;
}

/**
 * One model-slot row: a model select paired with its thinking-level select.
 *
 * The three slots differ only in their copy and which atoms they read, so they
 * share a row rather than repeating the pairing three times — which is what let
 * the Concierge slot ship without the visibility fallback its siblings had.
 */
function ModelSlotRow({
	defaultThinkingLevel,
	labels,
	models,
	placeholder,
	slot,
}: {
	defaultThinkingLevel?: string | null;
	labels: ModelSlotRowLabels;
	models: readonly AgentModelOption[];
	placeholder: string;
	slot: ModelSlot;
}) {
	return (
		<SettingRow
			control={
				<div className='flex items-center gap-2'>
					<ModelSelect
						ariaLabel={labels.modelAriaLabel}
						models={models}
						onChange={slot.choose}
						placeholder={placeholder}
						value={slot.modelId}
					/>
					<ThinkingLevelSelect
						ariaLabel={labels.thinkingAriaLabel}
						levels={slot.levels}
						onChange={slot.setThinking}
						provider={slot.provider}
						value={slot.thinking ?? defaultThinkingLevel}
					/>
				</div>
			}
			description={labels.description}
			label={labels.label}
		/>
	);
}

/** Models settings panel for choosing the default chat, review, and Concierge models, their thinking levels, and which models are visible. */
function ModelsSettings() {
	const { t } = useTranslation();
	const {
		data: modelsData,
		error: modelsError,
		isLoading: modelsLoading,
	} = useQuery(agentModelsQuery);
	const setConciergeProvider = useSetAtom(conciergeProviderAtom);
	const hidden = useAtomValue(hiddenModelsAtom);

	const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
	const allModels = useMemo(() => modelsData?.models ?? [], [modelsData]);
	// Hidden models drop out of the default/review/Concierge selects too, not
	// just the composer picker.
	const list = useMemo(
		() => allModels.filter((model) => !hiddenSet.has(model.id)),
		[allModels, hiddenSet],
	);
	const catalogue = useMemo(
		() => ({
			agentDefaultModelId: modelsData?.defaultModelId ?? null,
			hiddenSet,
			list,
		}),
		[hiddenSet, list, modelsData],
	);

	// The runtime rides along with the model rather than being a second setting
	// to keep in step: a model belongs to exactly one runtime, and a pair that
	// disagrees is refused when the Concierge session opens.
	const persistConciergeProvider = useCallback(
		(_modelId: string | null, provider: AgentProviderId) => {
			setConciergeProvider(provider);
		},
		[setConciergeProvider],
	);

	const defaultSlot = useModelSlot(
		catalogue,
		defaultChatModelAtom,
		defaultChatThinkingLevelAtom,
	);
	const reviewSlot = useModelSlot(
		catalogue,
		reviewModelAtom,
		reviewThinkingLevelAtom,
	);
	const conciergeSlot = useModelSlot(
		catalogue,
		conciergeModelAtom,
		conciergeThinkingLevelAtom,
		persistConciergeProvider,
	);

	const placeholder =
		modelsData?.defaultModelId ?? t('settings:models.no-models', 'No models');

	return (
		<SettingsSection
			description={t(
				'settings:models.description',
				"Agent models and thinking-level defaults for new chats, reviews, and the Concierge. Sourced from each configured runtime's capability discovery.",
			)}
			title={t('settings:models.title', 'Models')}
		>
			{modelsLoading ? (
				<SettingsLoadingState
					label={t('settings:models.loading', 'Loading models…')}
				/>
			) : null}

			{modelsError ? (
				<SettingsErrorState
					message={t(
						'settings:models.discovery-failed',
						'Model discovery failed: {{error}}.',
						{ error: String(modelsError) },
					)}
				/>
			) : null}

			<ModelSlotRow
				defaultThinkingLevel={modelsData?.defaultThinkingLevel}
				labels={{
					description: t(
						'settings:models.default-model.description',
						'Model used when you start a new chat. Falls back to the agent-reported default when unset.',
					),
					label: t('settings:models.default-model.label', 'Default model'),
					modelAriaLabel: t(
						'settings:models.default-model.aria-label',
						'Default chat model',
					),
					thinkingAriaLabel: t(
						'settings:models.default-model.thinking-aria-label',
						'Default thinking level',
					),
				}}
				models={list}
				placeholder={placeholder}
				slot={defaultSlot}
			/>

			<ModelSlotRow
				defaultThinkingLevel={modelsData?.defaultThinkingLevel}
				labels={{
					description: t(
						'settings:models.review-model.description',
						'Model used for the Review action on a workspace.',
					),
					label: t('settings:models.review-model.label', 'Review model'),
					modelAriaLabel: t(
						'settings:models.review-model.aria-label',
						'Review model',
					),
					thinkingAriaLabel: t(
						'settings:models.review-model.thinking-aria-label',
						'Review thinking level',
					),
				}}
				models={list}
				placeholder={placeholder}
				slot={reviewSlot}
			/>

			<ModelSlotRow
				defaultThinkingLevel={modelsData?.defaultThinkingLevel}
				labels={{
					description: t(
						'settings:models.concierge-model.description',
						'Model the Concierge runs on. It works above every project rather than inside one, so it can differ from the chat default. Changing it takes effect on the next turn.',
					),
					label: t('settings:models.concierge-model.label', 'Concierge model'),
					modelAriaLabel: t(
						'settings:models.concierge-model.aria-label',
						'Concierge model',
					),
					thinkingAriaLabel: t(
						'settings:models.concierge-model.thinking-aria-label',
						'Concierge thinking level',
					),
				}}
				models={list}
				placeholder={placeholder}
				slot={conciergeSlot}
			/>

			<SettingRow
				description={t(
					'settings:models.visibility.description',
					'Hide models you don’t use from the model picker and the default/review selects. Hiding the selected default or review model switches it to the first available.',
				)}
				label={t('settings:models.visibility.label', 'Model visibility')}
				stack
			>
				<ModelVisibilityList />
			</SettingRow>
		</SettingsSection>
	);
}
