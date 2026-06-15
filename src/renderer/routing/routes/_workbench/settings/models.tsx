import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

import { piModelsQuery } from '@/renderer/api/ensemble';
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
import { Switch } from '@/renderer/components/ui/switch';
import {
	defaultChatModeAtom,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	piPersonalityAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type { PiModelOptionWire } from '@/shared/ipc/contracts/pi-session';

export const Route = createFileRoute('/_workbench/settings/models')({
	component: ModelsSettings,
});

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
	const [personality, setPersonality] = useAtom(piPersonalityAtom);
	const [chatMode, setChatMode] = useAtom(defaultChatModeAtom);

	const list = modelsData?.models ?? [];
	const resolvedDefault = defaultModel ?? modelsData?.defaultModelId ?? null;
	const resolvedReview = reviewModel ?? modelsData?.defaultModelId ?? null;
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
			/>

			<SettingRow
				control={
					<Select
						onValueChange={(v) => setPersonality(v as typeof personality)}
						value={personality}
					>
						<SelectTrigger className='w-44' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='pragmatic'>Pragmatic (default)</SelectItem>
							<SelectItem value='thorough'>Thorough</SelectItem>
							<SelectItem value='concise'>Concise</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Style preset injected when a new chat starts. Prompt-side only; does not modify Pi runtime.'
				label='Pi personality for new chats'
			/>

			<SettingRow
				control={
					<Switch
						checked={chatMode === 'plan'}
						onCheckedChange={(v) => setChatMode(v ? 'plan' : 'none')}
					/>
				}
				description='Start new chats in plan mode (Pi proposes a plan before acting).'
				label='Default to plan mode'
			/>

			<SettingRow
				control={
					<Switch
						checked={chatMode === 'fast'}
						onCheckedChange={(v) => setChatMode(v ? 'fast' : 'none')}
					/>
				}
				description='Start new chats in fast mode where supported by the model.'
				label='Default to fast mode'
			/>
		</SettingsSection>
	);
}

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

function thinkingLevelsFor(
	list: readonly PiModelOptionWire[],
	modelId: string | null,
): readonly string[] {
	if (!modelId) return [];
	return list.find((m) => m.id === modelId)?.thinkingLevels ?? [];
}

function prettyThinkingLevel(level: string): string {
	switch (level) {
		case 'extra-high':
			return 'Thinking extra high';
		case 'high':
			return 'Thinking high';
		case 'medium':
			return 'Thinking medium';
		case 'low':
			return 'Thinking low';
		case 'off':
			return 'No thinking';
		default:
			return level;
	}
}
