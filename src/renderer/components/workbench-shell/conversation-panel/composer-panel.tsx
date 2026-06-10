import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import {
	type ChangeEvent,
	type KeyboardEvent,
	useCallback,
	useRef,
	useState,
} from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { cn } from '@/renderer/lib/utils';
import { formatMentionAttachmentText } from '@/renderer/lib/workbench/mention-payload';
import type {
	ComposerShellState,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import { AttachmentChip } from './composer/attachment-chip';
import { AttachmentMenu } from './composer/attachment-menu';
import { ContextIndicator } from './composer/context-indicator';
import { ComposerAutocompletePopover } from './composer/mention-popover';
import { ModelPicker } from './composer/model-picker';
import { getNextThinkingId, ThinkingPicker } from './composer/thinking-picker';
import {
	type AutocompleteState,
	detectAutocomplete,
	useFuzzyMatches,
} from './composer/use-autocomplete';
import { useMentionMatches } from './composer/use-mention-matches';
import { useSlashCommands } from './composer/use-slash-commands';

const FOCUS_SHORTCUT_HINT = '⌘L';

/**
 * Sticky bottom composer wired to pi's session service. Mirrors reference
 * design — tall textarea, model + thinking chips, paperclip menu, context
 * indicator, send button. Owns inline @ file-mention picker (Portal anchored
 * to textarea wrapper) and / slash-command palette.
 */
export function ComposerPanel({ composer }: { composer: ComposerShellState }) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [value, setValue] = useState('');
	const [pending, setPending] = useState(false);
	const [focused, setFocused] = useState(false);
	const [autocomplete, setAutocomplete] = useState<AutocompleteState>({
		kind: null,
		query: '',
		tokenStart: 0,
		tokenEnd: 0,
	});
	const [activeIndex, setActiveIndex] = useState(0);
	const [uploadAttachments, setUploadAttachments] = useState<File[]>([]);
	const [mentionAttachments, setMentionAttachments] = useState<
		WorkspaceFileSummary[]
	>([]);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);

	const mentionMatches = useMentionMatches(
		composer.workspaceFiles,
		autocomplete.kind === 'mention' ? autocomplete.query : '',
	);

	const slashCommands = useSlashCommands(composer.workspaceCwd);
	const slashMatches = useFuzzyMatches(
		slashCommands,
		autocomplete.kind === 'slash' ? autocomplete.query : '',
		(entry) => entry.command,
		80,
	);

	const mentionOpen = autocomplete.kind === 'mention';
	const slashOpen = autocomplete.kind === 'slash';

	const focusTextarea = useCallback(() => {
		textareaRef.current?.focus();
	}, []);

	useHotkey('l', { meta: true }, focusTextarea);
	useHotkey('l', { ctrl: true }, focusTextarea);

	const updateAutocomplete = useCallback((nextValue: string, caret: number) => {
		setAutocomplete(detectAutocomplete(nextValue, caret));
		setActiveIndex(0);
	}, []);

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			const nextValue = event.target.value;
			setValue(nextValue);
			const caret = event.target.selectionStart ?? nextValue.length;
			updateAutocomplete(nextValue, caret);
		},
		[updateAutocomplete],
	);

	const handleSelect = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		const caret = textarea.selectionStart ?? textarea.value.length;
		updateAutocomplete(textarea.value, caret);
	}, [updateAutocomplete]);

	const dismissAutocomplete = useCallback(() => {
		setAutocomplete({ kind: null, query: '', tokenStart: 0, tokenEnd: 0 });
		setActiveIndex(0);
	}, []);

	const replaceToken = useCallback(
		(insert: string, keepTrailingSpace = true) => {
			const { tokenStart, tokenEnd } = autocomplete;
			const before = value.slice(0, tokenStart);
			const after = value.slice(tokenEnd);
			const trailing = keepTrailingSpace ? ' ' : '';
			const next = `${before}${insert}${trailing}${after}`;
			setValue(next);
			dismissAutocomplete();
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) {
					return;
				}
				const newCaret = before.length + insert.length + trailing.length;
				textarea.focus();
				textarea.setSelectionRange(newCaret, newCaret);
			});
		},
		[autocomplete, dismissAutocomplete, value],
	);

	const submitText = useCallback(
		async (rawText: string, mentions: readonly WorkspaceFileSummary[]) => {
			const trimmed = rawText.trim();
			if (
				composer.disabled ||
				pending ||
				(trimmed.length === 0 && mentions.length === 0)
			) {
				return;
			}
			setPending(true);
			setAttachmentError(null);
			try {
				const attachmentText = await formatMentionAttachmentText({
					mentions,
					workspaceCwd: composer.workspaceCwd,
				});
				const payload = [attachmentText, trimmed].filter(Boolean).join('\n\n');
				await composer.onSubmit(payload);
				setValue('');
				setUploadAttachments([]);
				setMentionAttachments([]);
			} catch (cause) {
				setAttachmentError(
					cause instanceof Error
						? cause.message
						: 'Failed to attach selected file.',
				);
			} finally {
				setPending(false);
			}
		},
		[composer, pending],
	);

	const handleSubmit = useCallback(
		() => submitText(value, mentionAttachments),
		[submitText, value, mentionAttachments],
	);

	const onMentionSelect = useCallback(
		(entry: WorkspaceFileSummary) => {
			// Drop the @query token from textarea, push file onto chip list
			setAttachmentError(null);
			const { tokenStart, tokenEnd } = autocomplete;
			const before = value.slice(0, tokenStart);
			const after = value.slice(tokenEnd);
			const nextValue = `${before.trimEnd()}${before.trimEnd().length > 0 ? ' ' : ''}${after.trimStart()}`;
			setValue(nextValue);
			setMentionAttachments((prev) => {
				if (prev.some((existing) => existing.path === entry.path)) {
					return prev;
				}
				return [...prev, entry];
			});
			dismissAutocomplete();
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) {
					return;
				}
				const newCaret = before.trimEnd().length + 1;
				textarea.focus();
				textarea.setSelectionRange(newCaret, newCaret);
			});
		},
		[autocomplete, dismissAutocomplete, value],
	);

	const onSlashSelect = useCallback(
		(command: string, autoSubmit: boolean) => {
			const { tokenStart, tokenEnd } = autocomplete;
			const before = value.slice(0, tokenStart);
			const after = value.slice(tokenEnd);
			const slashText = `/${command}`;
			if (
				autoSubmit &&
				before.trim().length === 0 &&
				after.trim().length === 0
			) {
				dismissAutocomplete();
				setValue('');
				void submitText(slashText, mentionAttachments);
				return;
			}
			replaceToken(slashText);
		},
		[
			autocomplete,
			dismissAutocomplete,
			mentionAttachments,
			replaceToken,
			submitText,
			value,
		],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (mentionOpen || slashOpen) {
				const kind = mentionOpen ? 'mention' : 'slash';
				const total =
					kind === 'mention' ? mentionMatches.length : slashMatches.length;
				if (total > 0) {
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						setActiveIndex((prev) => (prev + 1) % total);
						return;
					}
					if (event.key === 'ArrowUp') {
						event.preventDefault();
						setActiveIndex((prev) => (prev - 1 + total) % total);
						return;
					}
					if (event.key === 'Enter' || event.key === 'Tab') {
						event.preventDefault();
						if (kind === 'mention') {
							const match = mentionMatches[activeIndex];
							if (match) {
								onMentionSelect(match);
							}
						} else {
							const match = slashMatches[activeIndex];
							if (match) {
								onSlashSelect(match.command, match.autoSubmit);
							}
						}
						return;
					}
				}
				if (event.key === 'Escape') {
					event.preventDefault();
					dismissAutocomplete();
					return;
				}
			}

			if (
				event.key === 'Backspace' &&
				value.length === 0 &&
				mentionAttachments.length > 0
			) {
				event.preventDefault();
				setMentionAttachments((prev) => prev.slice(0, -1));
				return;
			}

			if (
				event.key === 'Enter' &&
				!event.shiftKey &&
				!event.nativeEvent.isComposing
			) {
				event.preventDefault();
				void handleSubmit();
			}
		},
		[
			activeIndex,
			dismissAutocomplete,
			handleSubmit,
			mentionAttachments.length,
			mentionMatches,
			mentionOpen,
			onMentionSelect,
			onSlashSelect,
			slashMatches,
			slashOpen,
			value.length,
		],
	);

	const handleAddAttachment = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const files = event.target.files ? [...event.target.files] : [];
			if (files.length > 0) {
				setUploadAttachments((prev) => [...prev, ...files]);
			}
			event.target.value = '';
		},
		[],
	);

	const removeUpload = useCallback((index: number) => {
		setUploadAttachments((prev) => prev.filter((_, idx) => idx !== index));
	}, []);

	const removeMention = useCallback((path: string) => {
		setAttachmentError(null);
		setMentionAttachments((prev) =>
			prev.filter((entry) => entry.path !== path),
		);
	}, []);

	const isStreaming = composer.isStreaming || pending;
	const canSubmit =
		!composer.disabled &&
		!isStreaming &&
		(value.trim().length > 0 || mentionAttachments.length > 0);

	const pickersDisabled = composer.disabled || isStreaming;
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
	useHotkey('p', { alt: true }, toggleModelPicker, {
		enabled: !pickersDisabled && composer.availableModels.length > 0,
	});
	useHotkey('t', { alt: true }, cycleThinking, {
		enabled: !pickersDisabled && composer.availableThinkingLevels.length > 0,
	});
	const placeholder =
		composer.placeholder.length > 0
			? composer.placeholder
			: 'Ask to make changes, @mention files, run /commands';

	const submitButton = isStreaming ? (
		<Button
			aria-label='Stop'
			className='rounded-md'
			onClick={() => void composer.onStop()}
			size='icon-sm'
			type='button'
			variant='outline'
		>
			{pending ? <Spinner /> : <SquareIcon />}
		</Button>
	) : (
		<Button
			aria-label='Send'
			className={cn(
				'rounded-md',
				!canSubmit &&
					'bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground',
			)}
			disabled={!canSubmit}
			onClick={() => void handleSubmit()}
			size='icon-sm'
			type='button'
			variant={canSubmit ? 'default' : 'secondary'}
		>
			<ArrowUpIcon />
		</Button>
	);

	const submitWithTooltip =
		composer.disabled && composer.disabledReason ? (
			<Tooltip>
				<TooltipTrigger asChild>
					<span>{submitButton}</span>
				</TooltipTrigger>
				<TooltipContent>{composer.disabledReason}</TooltipContent>
			</Tooltip>
		) : (
			submitButton
		);

	const hasChips =
		uploadAttachments.length > 0 || mentionAttachments.length > 0;

	const textareaBlock = (
		<div className='relative' ref={anchorRef}>
			<Textarea
				aria-label='Pi composer'
				className='max-h-64 min-h-28 resize-none px-0 py-0 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0'
				disabled={composer.disabled}
				onBlur={() => setFocused(false)}
				onChange={handleChange}
				onFocus={() => setFocused(true)}
				onKeyDown={handleKeyDown}
				onSelect={handleSelect}
				placeholder={placeholder}
				ref={textareaRef}
				value={value}
				variant='bare'
			/>
			{!focused && value.length === 0 && !hasChips ? (
				<span
					aria-hidden='true'
					className='pointer-events-none absolute top-0 right-0 text-muted-foreground/60 text-xs'
				>
					<kbd className='font-mono'>{FOCUS_SHORTCUT_HINT}</kbd>
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
					onChange={handleFileChange}
					ref={fileInputRef}
					tabIndex={-1}
					type='file'
				/>

				{hasChips ? (
					<div className='flex flex-wrap gap-1.5'>
						{mentionAttachments.map((entry) => (
							<AttachmentChip
								file={entry}
								key={`mention:${entry.path}`}
								onRemove={() => removeMention(entry.path)}
							/>
						))}
						{uploadAttachments.map((file, index) => (
							<AttachmentChip
								file={{ kind: 'upload', name: file.name }}
								key={`upload:${file.name}:${file.size}:${index}`}
								onRemove={() => removeUpload(index)}
							/>
						))}
					</div>
				) : null}
				{attachmentError ? (
					<div className='text-destructive text-xs' role='alert'>
						{attachmentError}
					</div>
				) : null}

				<ComposerAutocompletePopover
					activeIndex={activeIndex}
					kind={autocomplete.kind}
					mentionMatches={mentionMatches}
					onHover={setActiveIndex}
					onMentionSelect={onMentionSelect}
					onOpenChange={(open) => {
						if (!open) {
							dismissAutocomplete();
						}
					}}
					onSlashSelect={onSlashSelect}
					slashMatches={slashMatches}
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
						<ContextIndicator usage={composer.contextUsage} />
						<AttachmentMenu
							disabled={composer.disabled}
							onAddAttachment={handleAddAttachment}
						/>
						{submitWithTooltip}
					</div>
				</div>
			</div>
		</footer>
	);
}
