import { useAtomValue } from 'jotai';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { LinearIssuePickerDialog } from '@/renderer/components/linear/linear-issue-picker-dialog';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useComposerState } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { formatLinearIssueContext } from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';
import {
	alwaysShowContextUsageAtom,
	sendShortcutAtom,
} from '@/renderer/state/preferences';
import type { ComposerShellState } from '@/renderer/types/workbench';
import { formatShortcut } from '@/shared/keymap';
import { AttachmentChip } from './composer/attachment-chip';
import { AttachmentMenu } from './composer/attachment-menu';
import { ContextIndicator } from './composer/context-indicator';
import { ComposerAutocompletePopover } from './composer/mention-popover';
import { ModelPicker } from './composer/model-picker';
import { getNextThinkingId, ThinkingPicker } from './composer/thinking-picker';

const FOCUS_SHORTCUT_HINT = formatShortcut('composer.focus');

/**
 * Sticky bottom composer wired to pi's session service. Mirrors reference
 * design — tall textarea, model + thinking chips, paperclip menu, context
 * indicator, send button. Owns inline @ file-mention picker (Portal anchored
 * to textarea wrapper) and / slash-command palette. Domain state (value,
 * autocomplete, attachments, keymap) lives in `useComposerState`; this file
 * stays as a thin wiring/JSX layer.
 */
export function ComposerPanel({
	chatTabId,
	composer,
	seedText,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	seedText?: string;
}) {
	const state = useComposerState({ chatTabId, composer, seedText });
	const [focused, setFocused] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [issuePickerOpen, setIssuePickerOpen] = useState(false);
	const sendShortcut = useAtomValue(sendShortcutAtom);
	const alwaysShowContext = useAtomValue(alwaysShowContextUsageAtom);
	// Context gauge is noise at low usage, so by default it appears only past
	// 70% of the window. The setting forces it always-on.
	const usage = composer.contextUsage;
	const contextPercent =
		usage && usage.maxTokens > 0
			? (usage.usedTokens / usage.maxTokens) * 100
			: 0;
	const showContextIndicator = alwaysShowContext || contextPercent > 70;
	const sendShortcutHint = formatShortcut(
		sendShortcut === 'mod+enter' ? 'composer.submitWithMod' : 'composer.submit',
	);

	const focusTextarea = useCallback(() => {
		state.textareaRef.current?.focus();
	}, [state.textareaRef]);
	useHotkey('composer.focus', focusTextarea);

	const pickersDisabled = composer.disabled || state.isStreaming;
	const toggleModelPicker = useCallback(() => {
		setModelPickerOpen((current) => !current);
	}, []);
	const cycleThinking = useCallback(() => {
		const nextId = getNextThinkingId(
			composer.availableThinkingLevels,
			composer.thinkingLevel,
		);
		if (nextId) {
			composer.onThinkingChange(nextId);
		}
	}, [
		composer.availableThinkingLevels,
		composer.onThinkingChange,
		composer.thinkingLevel,
	]);
	useHotkey('composer.toggleModelPicker', toggleModelPicker, {
		enabled: !pickersDisabled && composer.availableModels.length > 0,
	});
	useHotkey('composer.cycleThinking', cycleThinking, {
		enabled: !pickersDisabled && composer.availableThinkingLevels.length > 0,
	});

	const placeholder =
		composer.placeholder.length > 0
			? composer.placeholder
			: 'Ask to make changes, @mention files, run /commands';

	const submitButton = state.isStreaming ? (
		<Button
			aria-label='Stop'
			className='rounded-md'
			onClick={() => void composer.onStop()}
			size='icon-sm'
			type='button'
			variant='outline'
		>
			{state.pending ? <Spinner /> : <SquareIcon />}
		</Button>
	) : (
		<Button
			aria-label='Send'
			className={cn(
				'rounded-md',
				!state.canSubmit &&
					'bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground',
			)}
			disabled={!state.canSubmit}
			onClick={() => void state.handleSubmit()}
			size='icon-sm'
			type='button'
			variant={state.canSubmit ? 'default' : 'secondary'}
		>
			<ArrowUpIcon />
		</Button>
	);

	const submitTooltip =
		composer.disabled && composer.disabledReason
			? composer.disabledReason
			: state.isStreaming
				? null
				: 'send';
	const submitWithTooltip =
		submitTooltip === null ? (
			submitButton
		) : (
			<Tooltip>
				<TooltipTrigger asChild>
					<span>{submitButton}</span>
				</TooltipTrigger>
				<TooltipContent>
					{submitTooltip === 'send' ? (
						<>
							Send message
							<span className='ml-2 text-muted-foreground'>
								{sendShortcutHint}
							</span>
						</>
					) : (
						submitTooltip
					)}
				</TooltipContent>
			</Tooltip>
		);

	const textareaBlock = (
		<div className='relative' ref={state.anchorRef}>
			<Textarea
				aria-label='Pi composer'
				className='max-h-64 min-h-28 resize-none px-0 py-0 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0'
				disabled={composer.disabled}
				onBlur={() => setFocused(false)}
				onChange={state.handleChange}
				onFocus={() => setFocused(true)}
				onKeyDown={state.handleKeyDown}
				onPaste={state.handlePaste}
				onSelect={state.handleSelect}
				placeholder={placeholder}
				ref={state.textareaRef}
				value={state.value}
				variant='bare'
			/>
			{!focused && state.value.length === 0 && !state.hasChips ? (
				<span
					aria-hidden='true'
					className='pointer-events-none absolute top-0 right-0 text-muted-foreground/60 text-xs'
				>
					{/* Sans, not the kbd UA monospace — monospace renders ⌘/⌥ tiny. */}
					<kbd className='font-sans'>{FOCUS_SHORTCUT_HINT}</kbd>
					<span className='ml-1'>to focus</span>
				</span>
			) : null}
		</div>
	);

	return (
		<footer className='shrink-0 bg-background px-4 pt-2 pb-5'>
			<div
				className={cn(
					'relative mx-auto flex w-full max-w-4xl flex-col gap-2 rounded-xl border border-border bg-pane/80 px-4 pt-3 pb-2.5 shadow-panel transition-shadow',
					focused && 'ring-1 ring-ring/40',
				)}
			>
				<input
					accept='*/*'
					aria-label='Upload attachment'
					className='hidden'
					multiple
					onChange={state.handleFileChange}
					ref={state.fileInputRef}
					tabIndex={-1}
					type='file'
				/>

				{state.hasChips ? (
					<div className='flex flex-wrap gap-1.5'>
						{state.mentionAttachments.map((entry) => (
							<AttachmentChip
								file={entry}
								key={`mention:${entry.path}`}
								onRemove={() => state.removeMention(entry.path)}
							/>
						))}
						{state.uploadAttachments.map((file, index) => (
							<AttachmentChip
								file={{ kind: 'upload', name: file.name }}
								key={`upload:${file.name}:${file.size}:${index}`}
								onRemove={() => state.removeUpload(index)}
							/>
						))}
					</div>
				) : null}
				{state.attachmentError ? (
					<div className='text-destructive text-xs' role='alert'>
						{state.attachmentError}
					</div>
				) : null}
				{state.blockedNotice ? (
					<output className='text-muted-foreground text-xs'>
						Follow-ups are blocked while Pi is working — stop the turn or wait
						for it to finish.
					</output>
				) : null}

				<ComposerAutocompletePopover
					activeIndex={state.activeIndex}
					kind={state.autocomplete.kind}
					mentionMatches={state.mentionMatches}
					onHover={state.setActiveIndex}
					onMentionSelect={state.onMentionSelect}
					onOpenChange={(open) => {
						if (!open) {
							state.dismissAutocomplete();
						}
					}}
					onSlashSelect={state.onSlashSelect}
					slashMatches={state.slashMatches}
				>
					{textareaBlock}
				</ComposerAutocompletePopover>

				<div className='flex items-center justify-between gap-2'>
					<div className='flex min-w-0 items-center gap-1.5'>
						<ModelPicker
							disabled={pickersDisabled}
							onChange={composer.onModelChange}
							onOpenChange={setModelPickerOpen}
							open={modelPickerOpen}
							options={composer.availableModels}
							value={composer.modelId}
						/>
						<ThinkingPicker
							disabled={pickersDisabled}
							onChange={composer.onThinkingChange}
							options={composer.availableThinkingLevels}
							value={composer.thinkingLevel}
						/>
					</div>
					<div className='flex items-center gap-1'>
						{showContextIndicator ? (
							<ContextIndicator usage={composer.contextUsage} />
						) : null}
						<AttachmentMenu
							disabled={composer.disabled}
							onAddAttachment={state.handleAddAttachment}
							onLinkIssue={() => setIssuePickerOpen(true)}
						/>
						{submitWithTooltip}
					</div>
				</div>
			</div>
			<LinearIssuePickerDialog
				onOpenChange={setIssuePickerOpen}
				onSelect={(issue) => state.insertText(formatLinearIssueContext(issue))}
				open={issuePickerOpen}
			/>
		</footer>
	);
}
