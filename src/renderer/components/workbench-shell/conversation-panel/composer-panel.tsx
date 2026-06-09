import type { ChatStatus } from 'ai';
import { FileCodeIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import {
	PromptInput,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from '@/renderer/components/ai-elements/prompt-input';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import type { ComposerShellState } from '@/renderer/types/workbench';

/**
 * Sticky bottom composer powered by ai-elements' `PromptInput`. The outer
 * footer chrome (border, padding, background) matches the surrounding
 * conversation panel; the inner controls inherit ai-elements affordances
 * (input group, Cmd+Enter, submit/stop status).
 */
export function ComposerPanel({ composer }: { composer: ComposerShellState }) {
	const [pending, setPending] = useState(false);

	const handleSubmit = async (
		message: PromptInputMessage,
		event: FormEvent<HTMLFormElement>,
	) => {
		event.preventDefault();
		const text = message.text.trim();
		if (composer.disabled || pending || text.length === 0) {
			return;
		}
		setPending(true);
		try {
			await composer.onSubmit(text);
		} finally {
			setPending(false);
		}
	};

	const handleStop = async () => {
		await composer.onStop();
		setPending(false);
	};

	const status: ChatStatus = pending
		? 'submitted'
		: composer.isStreaming
			? 'streaming'
			: 'ready';

	const showDisabledTooltip =
		composer.disabled && composer.disabledReason && !composer.isStreaming;

	return (
		<footer className='shrink-0 border-border border-t bg-background p-3'>
			<PromptInput
				className='rounded-md border border-border bg-pane'
				onSubmit={handleSubmit}
			>
				<PromptInputTextarea
					aria-label='Pi composer'
					disabled={composer.disabled}
					placeholder={composer.placeholder}
				/>
				<PromptInputFooter>
					<PromptInputTools className='flex-wrap'>
						<ModelSelect composer={composer} />
						<ThinkingSelect composer={composer} />
						<Button disabled={composer.disabled} size='sm' variant='outline'>
							<FileCodeIcon data-icon='inline-start' />
							Attach
						</Button>
					</PromptInputTools>
					{showDisabledTooltip ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<span>
									<PromptInputSubmit disabled size='sm' status='ready' />
								</span>
							</TooltipTrigger>
							<TooltipContent>{composer.disabledReason}</TooltipContent>
						</Tooltip>
					) : (
						<PromptInputSubmit
							disabled={composer.disabled}
							onStop={handleStop}
							size='sm'
							status={status}
						/>
					)}
				</PromptInputFooter>
			</PromptInput>
		</footer>
	);
}

/** Minimal model picker — native select keeps the bundle lean for THE-129 MVP. */
function ModelSelect({ composer }: { composer: ComposerShellState }) {
	if (composer.availableModels.length === 0) {
		return <StatusBadge tone='muted'>{composer.modelLabel}</StatusBadge>;
	}
	return (
		<label className='flex items-center gap-1 text-muted-foreground text-xs'>
			<span className='sr-only'>Model</span>
			<select
				aria-label='Pi model'
				className='rounded border border-border bg-background px-1.5 py-0.5 text-xs'
				disabled={composer.disabled || composer.isStreaming}
				onChange={(event) => composer.onModelChange(event.target.value)}
				value={composer.modelId ?? ''}
			>
				{composer.availableModels.map((option) => (
					<option key={option.id} value={option.id}>
						{option.displayName}
					</option>
				))}
			</select>
		</label>
	);
}

/** Minimal thinking-level picker; renders read-only badge when no options. */
function ThinkingSelect({ composer }: { composer: ComposerShellState }) {
	if (composer.availableThinkingLevels.length === 0) {
		return <StatusBadge tone='muted'>{composer.thinkingLabel}</StatusBadge>;
	}
	return (
		<label className='flex items-center gap-1 text-muted-foreground text-xs'>
			<span className='sr-only'>Thinking level</span>
			<select
				aria-label='Pi thinking level'
				className='rounded border border-border bg-background px-1.5 py-0.5 text-xs'
				disabled={composer.disabled || composer.isStreaming}
				onChange={(event) => composer.onThinkingChange(event.target.value)}
				value={composer.thinkingLevel ?? ''}
			>
				{composer.availableThinkingLevels.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}
