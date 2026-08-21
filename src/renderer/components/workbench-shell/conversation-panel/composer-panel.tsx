import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dictationKeyStatusQuery } from '@/renderer/api/ensemblr';
import { TextContextMenu } from '@/renderer/components/text-context-menu';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useComposerState } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { useDictation } from '@/renderer/hooks/workbench-shell/composer/use-dictation';
import { cn } from '@/renderer/lib/utils';
import { getNextThinkingId } from '@/renderer/lib/workbench/thinking-strength';
import { useConsumeComposerFocusRequest } from '@/renderer/state/composer';
import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import { dictationEnabledAtom } from '@/renderer/state/preferences';
import type {
	ComposerShellState,
	WorkspaceLinkedIssueSummary,
} from '@/renderer/types/workbench';
import { ComposerControls } from './composer/composer-controls';
import { ComposerNotices } from './composer/composer-notices';
import { ComposerEditor } from './composer/editor';
import { ComposerFocusHint } from './composer/focus-hint';
import { FollowUpQueueStack } from './composer/follow-up-queue-stack';
import { IssuePickerDialog } from './composer/issue-picker-dialog';
import { ConnectedLastUnreadButton } from './composer/last-unread-button';
import { LinkDirectoryDialog } from './composer/link-directory-dialog';
import { ComposerAutocompletePopover } from './composer/mention-popover';

/** Props for the composer panel and the per-chat body it mounts. */
interface ComposerPanelProps {
	chatTabId: string;
	composer: ComposerShellState;
	/** Plan review header rendered inside the composer card, above the textarea. */
	planReview?: ReactNode;
	/** Repository whose GitHub issues the attachment menu offers. */
	repositoryId: string;
	/** Issue an issue-created workspace came from, attached to the draft once. */
	seedLinkedIssue?: WorkspaceLinkedIssueSummary;
	/** Workspace whose dock hosts terminals the control row hands work off to. */
	workspaceId: string;
}

/**
 * Sticky bottom composer wired to pi's session service. Mirrors reference
 * design — tall textarea, model + thinking chips, paperclip menu, context
 * indicator, send button. Owns inline @ file-mention picker (Portal anchored
 * to textarea wrapper) and / slash-command palette. Domain state (value,
 * autocomplete, attachments, keymap) lives in `useComposerState`; this file
 * stays as a thin wiring/JSX layer.
 *
 * The body is keyed by chat tab here rather than at the call site, because
 * everything it holds outside the draft atoms — the editor's document, the
 * mirrored draft refs, the in-flight send flag, the pickers — belongs to one
 * chat, and `useComposerState` seeds the draft once per mount. The route reuses
 * this component across `$chatId` and `$workspaceId`, so a caller that had to
 * remember the key would seed the draft read at its first mount back into every
 * chat opened afterwards.
 */
export function ComposerPanel(props: ComposerPanelProps) {
	return <ComposerPanelBody {...props} key={props.chatTabId} />;
}

/** One chat's composer. Mounted afresh per chat tab; see {@link ComposerPanel}. */
function ComposerPanelBody({
	chatTabId,
	composer,
	planReview,
	repositoryId,
	seedLinkedIssue,
	workspaceId,
}: ComposerPanelProps) {
	const { t } = useTranslation();
	const state = useComposerState({
		chatTabId,
		composer,
		...(seedLinkedIssue ? { seedLinkedIssue } : {}),
	});
	const [focused, setFocused] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [issuePickerOpen, setIssuePickerOpen] = useState(false);
	const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);

	const focusEditor = useCallback(() => {
		state.editorRef.current?.focus();
	}, [state.editorRef]);
	useHotkey('composer.focus', focusEditor);
	useMenuCommand('composer.focus', focusEditor);
	useConsumeComposerFocusRequest(chatTabId, focusEditor);

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

	useMenuCommand(
		'composer.toggleModelPicker',
		toggleModelPicker,
		!pickersDisabled && composer.availableModels.length > 0,
	);
	useMenuCommand(
		'composer.cycleThinking',
		cycleThinking,
		!pickersDisabled && composer.availableThinkingLevels.length > 0,
	);
	// The mic is hidden rather than disabled when dictation is off or has no key:
	// a permanently dead control in the row teaches nothing, while its absence
	// sends the user to the settings row that can actually turn it on.
	const dictationEnabled = useAtomValue(dictationEnabledAtom);
	const { data: dictationKeyStatus } = useQuery({
		...dictationKeyStatusQuery,
		enabled: dictationEnabled,
	});
	const dictationVisible =
		dictationEnabled && (dictationKeyStatus?.configured ?? false);
	const dictation = useDictation({
		enabled: dictationVisible && !composer.disabled,
		onTranscript: state.insertDictatedText,
	});
	useHotkey('composer.toggleDictation', dictation.toggle, {
		enabled: dictationVisible && !composer.disabled,
	});

	useMenuCommand('composer.togglePlanMode', togglePlanMode, !pickersDisabled);
	useMenuCommandChecked('composer.togglePlanMode', composer.planMode);
	useMenuCommand(
		'composer.submit',
		() => void state.handleSubmit(),
		!composer.disabled && !state.isStreaming,
	);

	// Both queue controls hand an entry straight to the send pipeline, which
	// refuses one outright while the composer cannot take a send. Offering them
	// then would burn the queue's delivery attempts on a refusal the user can
	// neither see nor act on.
	const canDeliverQueued = !composer.disabled && !state.pending;

	const placeholder =
		composer.placeholder.length > 0
			? composer.placeholder
			: t(
					'workbench:composer.placeholder',
					'Ask to make changes, @mention files, run /commands',
				);

	const editorBlock = (
		<TextContextMenu>
			<div className='relative' ref={state.anchorRef}>
				<ComposerEditor
					ariaLabel={t('workbench:composer.aria-label', 'Agent composer')}
					disabled={composer.disabled}
					handleRef={state.editorRef}
					initialSeed={{
						attachments: state.initialDraft.attachments,
						text: state.initialDraft.text,
					}}
					initialSnapshot={state.initialDraft.snapshot}
					onBlur={() => setFocused(false)}
					onDraftChange={state.handleDraftChange}
					onDroppedTransfer={state.consumeDroppedTransfer}
					onFocus={() => setFocused(true)}
					onKeyDown={state.handleKeyDown}
					onPastedTransfer={state.consumePastedTransfer}
					placeholder={placeholder}
				/>
				<ComposerFocusHint
					focused={focused}
					hasChips={state.hasChips}
					value={state.value}
				/>
			</div>
		</TextContextMenu>
	);

	return (
		<footer className='shrink-0 bg-background px-4 pt-2 pb-5'>
			<div className='relative mx-auto w-full max-w-4xl'>
				<div className='pointer-events-none absolute -top-9 right-0 z-10 flex justify-end *:pointer-events-auto'>
					<ConnectedLastUnreadButton />
				</div>
				<FollowUpQueueStack
					entries={state.followUpQueue}
					onClear={state.clearQueue}
					onEdit={state.hasContent ? null : state.restoreQueued}
					onMove={state.moveQueued}
					onRemove={state.removeQueued}
					onReorder={state.reorderQueue}
					onSendNow={canDeliverQueued ? state.flushQueueNow : null}
					onSteer={canDeliverQueued ? state.steerQueued : null}
					pauseReason={state.queuePauseReason}
					stalled={state.queueStalled}
					streaming={state.isStreaming}
				/>
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

						<ComposerNotices
							dictationFailure={dictation.failure}
							state={state}
						/>

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
							{editorBlock}
						</ComposerAutocompletePopover>

						<ComposerControls
							composer={composer}
							dictation={dictation}
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
