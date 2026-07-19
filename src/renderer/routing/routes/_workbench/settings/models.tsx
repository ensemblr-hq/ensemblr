import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo } from 'react';

import { piModelsQuery } from '@/renderer/api/ensemblr';
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
import {
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	hiddenModelsAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type { PiModelOptionWire } from '@/shared/ipc/contracts/pi-session';

/** Route for the Models settings section; renders the models panel populated from Pi capability discovery. */
export const Route = createFileRoute('/_workbench/settings/models')({
	component: ModelsSettings,
});

/** Models settings panel for choosing default chat and review models, their thinking levels, and which models are visible. */
function ModelsSettings() {
	const {
		data: modelsData,
		error: modelsError,
		isLoading: modelsLoading,
	} = useQuery(piModelsQuery);
	const [defaultModel, setDefaultModel] = useAtom(defaultChatModelAtom);
	const [defaultThinking, setDefaultThinking] = useAtom(
		defaultChatThinkingLevelAtom,
	);
	const [reviewModel, setReviewModel] = useAtom(reviewModelAtom);
	const [reviewThinking, setReviewThinking] = useAtom(reviewThinkingLevelAtom);

	const hidden = useAtomValue(hiddenModelsAtom);
	const setHidden = useSetAtom(hiddenModelsAtom);
	const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
	const allModels = useMemo(() => modelsData?.models ?? [], [modelsData]);
	// Hidden models drop out of the default/review selects too, not just the
	// composer picker.
	const list = useMemo(
		() => allModels.filter((model) => !hiddenSet.has(model.id)),
		[allModels, hiddenSet],
	);
	const piDefaultModelId = modelsData?.defaultModelId ?? null;

	// If the model selected for the default or review slot gets hidden, fall back
	// to the first visible model so the select never points at a hidden id. The
	// list always has ≥1 entry (the visibility editor blocks hiding the last).
	useEffect(() => {
		const firstVisibleId = list[0]?.id;
		if (!firstVisibleId) {
			return;
		}
		const effectiveDefault = defaultModel ?? piDefaultModelId;
		if (effectiveDefault && hiddenSet.has(effectiveDefault)) {
			setDefaultModel(firstVisibleId);
		}
		const effectiveReview = reviewModel ?? piDefaultModelId;
		if (effectiveReview && hiddenSet.has(effectiveReview)) {
			setReviewModel(firstVisibleId);
		}
	}, [
		list,
		hiddenSet,
		defaultModel,
		reviewModel,
		piDefaultModelId,
		setDefaultModel,
		setReviewModel,
	]);

	const resolvedDefault = defaultModel ?? piDefaultModelId;
	const resolvedReview = reviewModel ?? piDefaultModelId;
	const defaultLevels = thinkingLevelsFor(list, resolvedDefault);
	const reviewLevels = thinkingLevelsFor(list, resolvedReview);

	return (
		<SettingsSection
			description='Pi models and thinking-level defaults for new chats and reviews. Sourced from Pi CLI capability discovery.'
			title='Models'
		>
			{modelsLoading ? (
				<div className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
					<Spinner className='size-4' /> Loading Pi models…
				</div>
			) : null}

			{modelsError ? (
				<div className='py-6 text-sm text-status-danger'>
					Pi model discovery failed: {String(modelsError)}.
				</div>
			) : null}

			<SettingRow
				control={
					<div className='flex items-center gap-2'>
						<ModelSelect
							ariaLabel='Default chat model'
							models={list}
							onChange={setDefaultModel}
							placeholder={modelsData?.defaultModelId ?? 'No models'}
							value={resolvedDefault}
						/>
						<ThinkingLevelSelect
							ariaLabel='Default thinking level'
							levels={defaultLevels}
							onChange={setDefaultThinking}
							value={defaultThinking ?? modelsData?.defaultThinkingLevel}
						/>
					</div>
				}
				description='Model used when you start a new chat. Falls back to the Pi-reported default when unset.'
				label='Default model'
				modified={defaultModel !== null || defaultThinking !== null}
				onReset={() => {
					setDefaultModel(null);
					setDefaultThinking(null);
				}}
			/>

			<SettingRow
				control={
					<div className='flex items-center gap-2'>
						<ModelSelect
							ariaLabel='Review model'
							models={list}
							onChange={setReviewModel}
							placeholder={modelsData?.defaultModelId ?? 'No models'}
							value={resolvedReview}
						/>
						<ThinkingLevelSelect
							ariaLabel='Review thinking level'
							levels={reviewLevels}
							onChange={setReviewThinking}
							value={reviewThinking ?? modelsData?.defaultThinkingLevel}
						/>
					</div>
				}
				description='Model used for the Review action on a workspace.'
				label='Review model'
				modified={reviewModel !== null || reviewThinking !== null}
				onReset={() => {
					setReviewModel(null);
					setReviewThinking(null);
				}}
			/>

			<SettingRow
				description='Hide models you don’t use from the model picker and the default/review selects. Hiding the selected default or review model switches it to the first available.'
				label='Model visibility'
				modified={hidden.length > 0}
				onReset={() => setHidden([])}
				stack
			>
				<ModelVisibilityList />
			</SettingRow>
		</SettingsSection>
	);
}

/** Select dropdown for choosing a Pi model from the visible list; disabled when no models are available. */
function ModelSelect({
	ariaLabel,
	models,
	onChange,
	placeholder,
	value,
}: {
	ariaLabel: string;
	models: readonly PiModelOptionWire[];
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
	value,
}: {
	ariaLabel: string;
	levels: readonly string[];
	onChange: (next: string | null) => void;
	value: string | null | undefined;
}) {
	if (levels.length === 0) {
		return null;
	}
	return (
		<Select
			onValueChange={(next) => onChange(next || null)}
			value={value ?? ''}
		>
			<SelectTrigger aria-label={ariaLabel} className='w-40' size='sm'>
				<SelectValue placeholder='Thinking level' />
			</SelectTrigger>
			<SelectContent>
				{levels.map((level) => (
					<SelectItem key={level} value={level}>
						{prettyThinkingLevel(level)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * Resolve the thinking levels a given model supports.
 * @param list - Available Pi model options
 * @param modelId - ID of the model to look up, or null
 * @returns The model's thinking levels, or an empty list when none match
 */
function thinkingLevelsFor(
	list: readonly PiModelOptionWire[],
	modelId: string | null,
): readonly string[] {
	if (!modelId) return [];
	return list.find((m) => m.id === modelId)?.thinkingLevels ?? [];
}

/**
 * Map a thinking-level id to its user-facing label.
 * @param level - Raw thinking-level identifier
 * @returns The display label, or the raw level when unrecognized
 */
function prettyThinkingLevel(level: string): string {
	switch (level) {
		case 'off':
			return 'No thinking';
		case 'minimal':
			return 'Minimal';
		case 'low':
			return 'Low';
		case 'medium':
			return 'Medium';
		case 'high':
			return 'High';
		case 'xhigh':
			return 'Extra high';
		default:
			return level;
	}
}
