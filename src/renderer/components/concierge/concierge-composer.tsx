import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dictationKeyStatusQuery } from '@/renderer/api/ensemblr';
import { TextContextMenu } from '@/renderer/components/text-context-menu';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { AttachmentMenu } from '@/renderer/components/workbench-shell/conversation-panel/composer/attachment-menu';
import { ContextIndicator } from '@/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';
import { DictationButton } from '@/renderer/components/workbench-shell/conversation-panel/composer/dictation-button';
import { ComposerEditor } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { ComposerFocusHint } from '@/renderer/components/workbench-shell/conversation-panel/composer/focus-hint';
import { McpServersPanel } from '@/renderer/components/workbench-shell/conversation-panel/composer/mcp-servers-panel';
import { ComposerAutocompletePopover } from '@/renderer/components/workbench-shell/conversation-panel/composer/mention-popover';
import { ModelPicker } from '@/renderer/components/workbench-shell/conversation-panel/composer/model-picker';
import { ThinkingPicker } from '@/renderer/components/workbench-shell/conversation-panel/composer/thinking-picker';
import {
	type ConciergeSendSelection,
	useConciergeComposer,
} from '@/renderer/hooks/concierge/use-concierge-composer';
import { useDictation } from '@/renderer/hooks/workbench-shell/composer/use-dictation';
import { cn } from '@/renderer/lib/utils';
import { dictationEnabledAtom } from '@/renderer/state/preferences';

/** What the Concierge composer is handed by the panel that hosts it. */
interface ConciergeComposerProps {
	/** Constrains the composer to a readable column, as the maximized panel needs. */
	centered: boolean;
	/** The Concierge home, which every attachment and command resolves against. */
	cwd: string;
	disabled: boolean;
	isStreaming: boolean;
	onStop: () => void;
	onSubmit: (prompt: string, selection: ConciergeSendSelection) => void;
}

/**
 * The Concierge's composer.
 *
 * Built from the workspace composer's own parts — the Lexical editor, the model
 * and thinking pickers, the attachment menu, the MCP roster, the context gauge,
 * dictation, and the slash-command popover — pointed at the Concierge home
 * instead of a worktree. `attachPastedFiles` and `serializeComposerDraft` both
 * take a cwd rather than a workspace, and the slash catalogue is resolved per
 * runtime and cwd, so almost none of it needed a Concierge-specific path. What
 * drives those parts is resolved by `useConciergeComposer`, leaving this to
 * render it.
 *
 * It is the same *card* as the workspace composer too, not just the same
 * controls: bordered, raised off the surface behind it, and ringed while
 * focused. That card is what separates a composer from the transcript above it —
 * maximized, the two share a background and a column, so without it the panel
 * ended in an unbounded strip of controls with nothing to say where the
 * transcript stopped.
 *
 * `@` is the one control that means something different here. A workspace
 * composer ranks it against that workspace's file list; the Concierge has no
 * workspace, so its `@` names the things it actually talks about — every
 * project, workspace, and chat in the app — and a pick becomes a chip carrying
 * the ids the Concierge's own ops take. Files it still reaches by absolute path.
 *
 * Plan Mode is deliberately absent: the Concierge does not plan on anyone's
 * behalf; an orchestrator it spawns with `planMode: true` submits its own plan,
 * in the workspace the plan is about.
 */
export function ConciergeComposer({
	centered,
	cwd,
	disabled,
	isStreaming,
	onStop,
	onSubmit,
}: ConciergeComposerProps) {
	const { t } = useTranslation();
	const [focused, setFocused] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const composer = useConciergeComposer({ cwd, disabled, onSubmit });
	const { draft, selection } = composer;

	// Hidden rather than disabled when dictation is off or has no key, exactly as
	// the workspace composer hides it: a permanently dead control in a row this
	// narrow costs more than it teaches.
	const dictationEnabled = useAtomValue(dictationEnabledAtom);
	const { data: dictationKeyStatus } = useQuery({
		...dictationKeyStatusQuery,
		enabled: dictationEnabled,
	});
	const dictation = useDictation({
		enabled:
			dictationEnabled &&
			(dictationKeyStatus?.configured ?? false) &&
			!disabled,
		onTranscript: draft.insertDictatedText,
	});

	return (
		<footer
			className={cn(
				'shrink-0 bg-background',
				centered ? 'px-4 pt-2 pb-5' : 'px-3 pt-2 pb-3',
			)}
		>
			<div className={cn('relative mx-auto w-full', centered && 'max-w-4xl')}>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a passive file target, not a keyboard/pointer control */}
				<div
					className={cn(
						'relative flex w-full flex-col overflow-hidden rounded-xl border border-border bg-pane/80 shadow-panel transition-shadow',
						focused && 'ring-1 ring-ring/40',
					)}
					onDragOver={composer.handleDragOver}
					onDrop={composer.handleDrop}
				>
					<div
						className={cn(
							'flex flex-col gap-2',
							centered ? 'px-4 pt-3 pb-2.5' : 'px-3 pt-2.5 pb-2',
						)}
					>
						<input
							accept='*/*'
							aria-label={t(
								'workbench:concierge.composer.upload-input',
								'Upload attachment',
							)}
							className='hidden'
							multiple
							onChange={draft.handleFileInputChange}
							ref={draft.fileInputRef}
							tabIndex={-1}
							type='file'
						/>

						{draft.attachmentError ? (
							<div className='text-destructive text-xs' role='alert'>
								{draft.attachmentError}
							</div>
						) : null}

						<ComposerAutocompletePopover
							activeIndex={draft.activeIndex}
							entityMatches={draft.referenceMatches}
							kind={draft.autocompleteKind}
							mentionMatches={[]}
							onEntitySelect={draft.selectReference}
							onHover={draft.setActiveIndex}
							onMentionSelect={noopMention}
							onOpenChange={noopOpenChange}
							onSlashSelect={draft.selectSlashCommand}
							slashLoading={draft.slashLoading}
							slashMatches={draft.slashMatches}
						>
							<TextContextMenu>
								{/* `relative` positions the editor's placeholder, which is
								    absolute — without it the hint escapes to the panel's own
								    corner. */}
								<div className='relative'>
									<ComposerEditor
										ariaLabel={t(
											'workbench:concierge.composer.label',
											'Message the Concierge',
										)}
										className='max-h-48 min-h-14'
										disabled={disabled}
										handleRef={draft.editorRef}
										initialSeed={{ attachments: [], text: '' }}
										initialSnapshot={null}
										onBlur={() => setFocused(false)}
										onDraftChange={draft.handleDraftChange}
										onDroppedTransfer={draft.consumeDroppedTransfer}
										onFocus={() => setFocused(true)}
										onKeyDown={composer.handleKeyDown}
										onPastedTransfer={draft.consumePastedTransfer}
										placeholder={t(
											'workbench:concierge.composer.placeholder',
											'Ask across every project…',
										)}
									/>
									{/* Docked, the card is a quarter of the width the workspace
									    composer gets and the hint would land on the placeholder
									    it is meant to sit beside. */}
									{centered ? (
										<ComposerFocusHint
											focused={focused}
											hasChips={draft.hasChips}
											shortcutId='concierge.focusComposer'
											value={draft.text}
										/>
									) : null}
								</div>
							</TextContextMenu>
						</ComposerAutocompletePopover>

						<div className='flex items-center justify-between gap-2'>
							<div className='-ml-1.5 flex min-w-0 items-center gap-1'>
								<ModelPicker
									disabled={disabled}
									onChange={selection.setModel}
									onOpenChange={setModelPickerOpen}
									open={modelPickerOpen}
									options={selection.availableModels}
									value={selection.modelId}
								/>
								<ThinkingPicker
									disabled={disabled}
									onChange={selection.setThinkingLevel}
									options={selection.availableThinkingLevels}
									provider={selection.provider}
									value={selection.thinkingLevel}
								/>
							</div>
							<div className='-mr-1.5 flex shrink-0 items-center gap-1'>
								{selection.provider === 'claude' ? (
									<McpServersPanel cwd={cwd} disabled={disabled} />
								) : null}
								{composer.contextUsage ? (
									<ContextIndicator usage={composer.contextUsage} />
								) : null}
								<DictationButton dictation={dictation} />
								<AttachmentMenu
									disabled={disabled}
									onAddAttachment={draft.openFilePicker}
									onLinkDirectory={draft.openFilePicker}
									onReference={draft.startReference}
								/>
								<ConciergeSubmitControl
									composer={composer}
									isStreaming={isStreaming}
									onStop={onStop}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</footer>
	);
}

/**
 * The send / stop control and its tooltip, shaped exactly as the workspace
 * composer's is.
 *
 * Stop shows only while the turn is live *and* the draft is empty. The moment
 * the user types, the control becomes Send — which is what the ⌘↵ chord has
 * always done here, so a button that stayed on Stop was promising the opposite
 * of what the keyboard delivered.
 */
function ConciergeSubmitControl({
	composer,
	isStreaming,
	onStop,
}: {
	composer: ReturnType<typeof useConciergeComposer>;
	isStreaming: boolean;
	onStop: () => void;
}) {
	const { t } = useTranslation();
	const { draft } = composer;

	if (isStreaming && !draft.canSend) {
		return (
			<Button
				aria-label={t('common:actions.stop', 'Stop')}
				className='rounded-md'
				onClick={onStop}
				size='icon-sm'
				type='button'
				variant='outline'
			>
				<SquareIcon />
			</Button>
		);
	}

	const canSend = draft.canSend && !composer.isSending;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>
					<Button
						aria-label={t('common:actions.send', 'Send')}
						className='rounded-md'
						disabled={!canSend}
						onClick={composer.send}
						size='icon-sm'
						type='button'
						variant={canSend ? 'default' : 'secondary'}
					>
						{composer.isSending ? <Spinner /> : <ArrowUpIcon />}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{t('workbench:concierge.composer.send-tooltip', 'Send message')}
				<span className='ml-2 text-muted-foreground'>
					{composer.sendShortcutHint}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

/** The file half of the menu is unreachable here — the Concierge has no file list. */
function noopMention(): void {
	return;
}

/** The popover closes itself from the draft's own token tracking. */
function noopOpenChange(): void {
	return;
}
