import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useComposerState } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { cn } from '@/renderer/lib/utils';
import { useConsumeComposerFocusRequest } from '@/renderer/state/composer';
import type { ComposerShellState } from '@/renderer/types/workbench';
import { ComposerControls } from './composer/composer-controls';
import { ComposerNotices } from './composer/composer-notices';
import { ComposerFocusHint } from './composer/focus-hint';
import { IssuePickerDialog } from './composer/issue-picker-dialog';
import { ConnectedLastUnreadButton } from './composer/last-unread-button';
import { LinkDirectoryDialog } from './composer/link-directory-dialog';
import { ComposerAutocompletePopover } from './composer/mention-popover';
import { getNextThinkingId } from './composer/thinking-picker';

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
	planReview,
	repositoryId,
	seedText,
	workspaceId,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	/** Plan review header rendered inside the composer card, above the textarea. */
	planReview?: ReactNode;
	/** Repository whose GitHub issues the attachment menu offers. */
	repositoryId: string;
	seedText?: string;
	/** Workspace whose dock hosts terminals the control row hands work off to. */
	workspaceId: string;
}) {
	const { t } = useTranslation();
	const state = useComposerState({ chatTabId, composer, seedText });
	const [focused, setFocused] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [issuePickerOpen, setIssuePickerOpen] = useState(false);
	const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);

	const focusTextarea = useCallback(() => {
		state.textareaRef.current?.focus();
	}, [state.textareaRef]);
	useHotkey('composer.focus', focusTextarea);
	useConsumeComposerFocusRequest(chatTabId, focusTextarea);

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
	const togglePlanMode = useCallback(() => {
		composer.onPlanModeChange(!composer.planMode);
	}, [composer.onPlanModeChange, composer.planMode]);
	useHotkey('composer.togglePlanMode', togglePlanMode, {
		enabled: !pickersDisabled,
	});

	const placeholder =
		composer.placeholder.length > 0
			? composer.placeholder
			: t(
					'workbench:composer.placeholder',
					'Ask to make changes, @mention files, run /commands',
				);

	const textareaBlock = (
		<div className='relative' ref={state.anchorRef}>
			<Textarea
				aria-label={t('workbench:composer.aria-label', 'Agent composer')}
				className='sleek-scrollbar max-h-64 min-h-28 resize-none px-0 py-0 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0'
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
			<ComposerFocusHint
				focused={focused}
				hasChips={state.hasChips}
				value={state.value}
			/>
		</div>
	);

	return (
		<footer className='shrink-0 bg-background px-4 pt-2 pb-5'>
			<div className='relative mx-auto w-full max-w-4xl'>
				<div className='pointer-events-none absolute -top-9 right-0 z-10 flex justify-end *:pointer-events-auto'>
					<ConnectedLastUnreadButton />
				</div>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a passive file target, not a keyboard/pointer control */}
				<div
					className={cn(
						'relative flex w-full flex-col overflow-hidden rounded-xl border border-border bg-pane/80 shadow-panel transition-shadow',
						composer.planMode
							? 'border-accent-strong/50 border-dashed'
							: focused && 'ring-1 ring-ring/40',
					)}
					onDragOver={state.handleDragOver}
					onDrop={state.handleDrop}
				>
					{planReview}
					<div className='flex flex-col gap-2 px-4 pt-3 pb-2.5'>
						<input
							accept='*/*'
							aria-label={t(
								'workbench:composer.upload-input.aria-label',
								'Upload attachment',
							)}
							className='hidden'
							multiple
							onChange={state.handleFileChange}
							ref={state.fileInputRef}
							tabIndex={-1}
							type='file'
						/>

						<ComposerNotices state={state} />

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
							slashLoading={state.slashLoading}
							slashMatches={state.slashMatches}
						>
							{textareaBlock}
						</ComposerAutocompletePopover>

						<ComposerControls
							composer={composer}
							modelPickerOpen={modelPickerOpen}
							onLinkDirectory={() => setDirectoryPickerOpen(true)}
							onLinkIssue={() => setIssuePickerOpen(true)}
							onModelPickerOpenChange={setModelPickerOpen}
							pickersDisabled={pickersDisabled}
							state={state}
							workspaceId={workspaceId}
						/>
					</div>
				</div>
			</div>
			<LinkDirectoryDialog
				linkedDirectories={state.linkedDirectories}
				onLink={state.linkDirectory}
				onOpenChange={setDirectoryPickerOpen}
				onUnlink={state.unlinkDirectory}
				open={directoryPickerOpen}
			/>
			<IssuePickerDialog
				onOpenChange={setIssuePickerOpen}
				onSelect={(picked) => {
					void (picked.provider === 'linear'
						? state.attachLinearIssue(picked.issue)
						: state.attachGithubIssue(picked.issue));
				}}
				open={issuePickerOpen}
				repositoryId={repositoryId}
			/>
		</footer>
	);
}
