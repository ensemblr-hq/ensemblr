import { FileCodeIcon, SquareIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import type { ComposerShellState } from '@/renderer/types/workbench';

/** Sticky bottom composer with textarea, status badges and send/stop. */
export function ComposerPanel({ composer }: { composer: ComposerShellState }) {
	const [prompt, setPrompt] = useState('');
	const [pending, setPending] = useState(false);

	const submitDisabled =
		composer.disabled || pending || prompt.trim().length === 0;
	const showStop = composer.isStreaming || pending;

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (submitDisabled) {
			return;
		}
		setPending(true);
		try {
			await composer.onSubmit(prompt);
			setPrompt('');
		} finally {
			setPending(false);
		}
	};

	const handleStop = async () => {
		await composer.onStop();
		setPending(false);
	};

	return (
		<footer className='shrink-0 border-border border-t bg-background p-3'>
			<form
				className='rounded-md border border-border bg-pane p-2'
				onSubmit={handleSubmit}
			>
				<Textarea
					aria-label='Pi composer'
					className='min-h-24 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0'
					disabled={composer.disabled}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder={composer.placeholder}
					value={prompt}
				/>
				<div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
					<div className='flex flex-wrap items-center gap-1.5'>
						<ModelSelect composer={composer} />
						<ThinkingSelect composer={composer} />
					</div>
					<div className='flex items-center gap-1.5'>
						<Button disabled={composer.disabled} size='sm' variant='outline'>
							<FileCodeIcon data-icon='inline-start' />
							Attach
						</Button>
						{showStop ? (
							<Button
								onClick={handleStop}
								size='sm'
								type='button'
								variant='destructive'
							>
								<SquareIcon data-icon='inline-start' />
								Stop
							</Button>
						) : composer.disabled && composer.disabledReason ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span>
										<Button disabled size='sm' type='button'>
											Send
										</Button>
									</span>
								</TooltipTrigger>
								<TooltipContent>{composer.disabledReason}</TooltipContent>
							</Tooltip>
						) : (
							<Button disabled={submitDisabled} size='sm' type='submit'>
								Send
							</Button>
						)}
					</div>
				</div>
			</form>
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
