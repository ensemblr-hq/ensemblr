import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { agentModelsQuery } from '@/renderer/api/ensemblr';
import { ModelVisibilityList } from '@/renderer/components/settings/model-visibility-list';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { Spinner } from '@/renderer/components/ui/spinner';
import { thinkingLevelLabel } from '@/renderer/lib/workbench/thinking-labels';
import {
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	hiddenModelsAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '@/renderer/state/preferences';
import {
	type AgentProviderId,
	normalizeAgentProviderId,
} from '@/shared/agent-provider';
import { getThinkingAxis } from '@/shared/agent-thinking';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

/** Route for the Models settings section; renders the models panel populated from agent capability discovery. */
export const Route = createFileRoute('/_workbench/settings/models')({
	component: ModelsSettings,
});

/** Models settings panel for choosing default chat and review models, their thinking levels, and which models are visible. */
function ModelsSettings() {
	const { t } = useTranslation();
	const {
		data: modelsData,
		error: modelsError,
		isLoading: modelsLoading,
	} = useQuery(agentModelsQuery);
	const [defaultModel, setDefaultModel] = useAtom(defaultChatModelAtom);
	const [defaultThinking, setDefaultThinking] = useAtom(
		defaultChatThinkingLevelAtom,
	);
	const [reviewModel, setReviewModel] = useAtom(reviewModelAtom);
	const [reviewThinking, setReviewThinking] = useAtom(reviewThinkingLevelAtom);

	const hidden = useAtomValue(hiddenModelsAtom);
	const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
	const allModels = useMemo(() => modelsData?.models ?? [], [modelsData]);
	// Hidden models drop out of the default/review selects too, not just the
	// composer picker.
	const list = useMemo(
		() => allModels.filter((model) => !hiddenSet.has(model.id)),
		[allModels, hiddenSet],
	);
	const agentDefaultModelId = modelsData?.defaultModelId ?? null;

	// If the model selected for the default or review slot gets hidden, fall back
	// to the first visible model so the select never points at a hidden id. The
	// list always has ≥1 entry (the visibility editor blocks hiding the last).
	useEffect(() => {
		const firstVisibleId = list[0]?.id;
		if (!firstVisibleId) {
			return;
		}
		const effectiveDefault = defaultModel ?? agentDefaultModelId;
		if (effectiveDefault && hiddenSet.has(effectiveDefault)) {
			setDefaultModel(firstVisibleId);
		}
		const effectiveReview = reviewModel ?? agentDefaultModelId;
		if (effectiveReview && hiddenSet.has(effectiveReview)) {
			setReviewModel(firstVisibleId);
		}
	}, [
		list,
		hiddenSet,
		defaultModel,
		reviewModel,
		agentDefaultModelId,
		setDefaultModel,
		setReviewModel,
	]);

	const resolvedDefault = defaultModel ?? agentDefaultModelId;
	const resolvedReview = reviewModel ?? agentDefaultModelId;
	const defaultLevels = thinkingLevelsFor(list, resolvedDefault);
	const reviewLevels = thinkingLevelsFor(list, resolvedReview);
	const defaultProvider = providerFor(list, resolvedDefault);
	const reviewProvider = providerFor(list, resolvedReview);

	return (
		<SettingsSection
			description={t(
				'settings:models.description',
				"Agent models and thinking-level defaults for new chats and reviews. Sourced from each configured runtime's capability discovery.",
			)}
			title={t('settings:models.title', 'Models')}
		>
			{modelsLoading ? (
				<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
					<Spinner className='size-4' />{' '}
					{t('settings:models.loading', 'Loading models…')}
				</div>
			) : null}

			{modelsError ? (
				<div className='py-6 text-sm text-status-danger'>
					{t(
						'settings:models.discovery-failed',
						'Model discovery failed: {{error}}.',
						{ error: String(modelsError) },
					)}
				</div>
			) : null}

			<SettingRow
				control={
					<div className='flex items-center gap-2'>
						<ModelSelect
							ariaLabel={t(
								'settings:models.default-model.aria-label',
								'Default chat model',
							)}
							models={list}
							onChange={setDefaultModel}
							placeholder={
								modelsData?.defaultModelId ??
								t('settings:models.no-models', 'No models')
							}
							value={resolvedDefault}
						/>
						<ThinkingLevelSelect
							ariaLabel={t(
								'settings:models.default-model.thinking-aria-label',
								'Default thinking level',
							)}
							levels={defaultLevels}
							onChange={setDefaultThinking}
							provider={defaultProvider}
							value={defaultThinking ?? modelsData?.defaultThinkingLevel}
						/>
					</div>
				}
				description={t(
					'settings:models.default-model.description',
					'Model used when you start a new chat. Falls back to the agent-reported default when unset.',
				)}
				label={t('settings:models.default-model.label', 'Default model')}
			/>

			<SettingRow
				control={
					<div className='flex items-center gap-2'>
						<ModelSelect
							ariaLabel={t(
								'settings:models.review-model.aria-label',
								'Review model',
							)}
							models={list}
							onChange={setReviewModel}
							placeholder={
								modelsData?.defaultModelId ??
								t('settings:models.no-models', 'No models')
							}
							value={resolvedReview}
						/>
						<ThinkingLevelSelect
							ariaLabel={t(
								'settings:models.review-model.thinking-aria-label',
								'Review thinking level',
							)}
							levels={reviewLevels}
							onChange={setReviewThinking}
							provider={reviewProvider}
							value={reviewThinking ?? modelsData?.defaultThinkingLevel}
						/>
					</div>
				}
				description={t(
					'settings:models.review-model.description',
					'Model used for the Review action on a workspace.',
				)}
				label={t('settings:models.review-model.label', 'Review model')}
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

/** Select dropdown for choosing a model from the visible list; disabled when no models are available. */
function ModelSelect({
	ariaLabel,
	models,
	onChange,
	placeholder,
	value,
}: {
	ariaLabel: string;
	models: readonly AgentModelOption[];
	onChange: (next: string | null) => void;
	placeholder: string;
	value: string | null;
}) {
	const disabled = models.length === 0;
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => onChange(next || null)}
			value={value ?? ''}
		>
			<SelectTrigger aria-label={ariaLabel} className='w-44' size='sm'>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{models.map((model) => (
					<SelectItem key={model.id} value={model.id}>
						{model.displayName}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Select dropdown for choosing a thinking level; renders nothing when the model exposes no levels. */
function ThinkingLevelSelect({
	ariaLabel,
	levels,
	onChange,
	provider,
	value,
}: {
	ariaLabel: string;
	levels: readonly string[];
	onChange: (next: string | null) => void;
	/** Runtime whose vocabulary labels the levels; Claude's dial is effort, pi's is thinking. */
	provider: AgentProviderId;
	value: string | null | undefined;
}) {
	const { t } = useTranslation();

	if (levels.length === 0) {
		return null;
	}
	const placeholder =
		getThinkingAxis(provider) === 'effort'
			? t('settings:models.thinking.effort-placeholder', 'Effort level')
			: t('settings:models.thinking.thinking-placeholder', 'Thinking level');
	return (
		<Select
			onValueChange={(next) => onChange(next || null)}
			value={value ?? ''}
		>
			<SelectTrigger aria-label={ariaLabel} className='w-40' size='sm'>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{levels.map((level) => (
					<SelectItem key={level} value={level}>
						{thinkingLevelLabel(t, level)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * Resolve the thinking levels a given model supports.
 * @param list - Available agent model options
 * @param modelId - ID of the model to look up, or null
 * @returns The model's thinking levels, or an empty list when none match
 */
function thinkingLevelsFor(
	list: readonly AgentModelOption[],
	modelId: string | null,
): readonly string[] {
	if (!modelId) return [];
	return list.find((m) => m.id === modelId)?.thinkingLevels ?? [];
}

/**
 * Resolve which agent runtime drives a given model, so its thinking levels are
 * labelled in that runtime's vocabulary.
 * @param list - Available agent model options
 * @param modelId - ID of the model to look up, or null
 * @returns The model's runtime, defaulting to pi when no model matches
 */
function providerFor(
	list: readonly AgentModelOption[],
	modelId: string | null,
): AgentProviderId {
	return normalizeAgentProviderId(
		modelId ? list.find((m) => m.id === modelId)?.agentProvider : undefined,
	);
}
