import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { AttachmentMenu } from '@/renderer/components/workbench-shell/conversation-panel/composer/attachment-menu';
import { ContextIndicator } from '@/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';
import { ComposerEditor } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { McpServersPanel } from '@/renderer/components/workbench-shell/conversation-panel/composer/mcp-servers-panel';
import { ComposerAutocompletePopover } from '@/renderer/components/workbench-shell/conversation-panel/composer/mention-popover';
import { ModelPicker } from '@/renderer/components/workbench-shell/conversation-panel/composer/model-picker';
import { ThinkingPicker } from '@/renderer/components/workbench-shell/conversation-panel/composer/thinking-picker';
import {
	type ConciergeSendSelection,
	useConciergeComposer,
} from '@/renderer/hooks/concierge/use-concierge-composer';
import { cn } from '@/renderer/lib/utils';

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
 * and the slash-command popover — pointed at the Concierge home instead of a
 * worktree. `attachPastedFiles` and `serializeComposerDraft` both take a cwd
 * rather than a workspace, and the slash catalogue is resolved per runtime and
 * cwd, so almost none of it needed a Concierge-specific path. What drives those
 * parts is resolved by `useConciergeComposer`, leaving this to render it.
 *
 * Two things are deliberately absent. `@` file mentions rank against a
 * workspace's file list, and the Concierge has no workspace whose files it would
 * be naming — it reads across all of them by path instead. Plan Mode is absent
 * because the Concierge does not plan on anyone's behalf; an orchestrator it
 * spawns with `planMode: true` submits its own plan, in the workspace the plan
 * is about.
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
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const composer = useConciergeComposer({ cwd, disabled, onSubmit });
	const { draft, selection } = composer;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a passive file target, not a keyboard/pointer control
		<div
			className={cn(
				'flex flex-col gap-2 border-border/60 border-t p-3',
				centered && 'mx-auto w-full max-w-4xl border-t-0 px-4 pt-2 pb-5',
			)}
			onDragOver={composer.handleDragOver}
			onDrop={composer.handleDrop}
		>
			{draft.attachmentError ? (
				<p className='text-status-danger text-xs'>{draft.attachmentError}</p>
			) : null}
			<ComposerAutocompletePopover
				activeIndex={draft.activeIndex}
				kind={draft.slashOpen ? 'slash' : null}
				mentionMatches={[]}
				onHover={draft.setActiveIndex}
				onMentionSelect={noopMention}
				onOpenChange={noopOpenChange}
				onSlashSelect={draft.selectSlashCommand}
				slashLoading={draft.slashLoading}
				slashMatches={draft.slashMatches}
			>
				{/* `relative` positions the editor's placeholder, which is absolute —
				    without it the hint escapes to the panel's own corner. */}
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
						onBlur={noop}
						onDraftChange={draft.handleDraftChange}
						onDroppedTransfer={draft.consumeDroppedTransfer}
						onFocus={noop}
						onKeyDown={composer.handleKeyDown}
						onPastedTransfer={draft.consumePastedTransfer}
						placeholder={t(
							'workbench:concierge.composer.placeholder',
							'Ask across every project…',
						)}
					/>
				</div>
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
				<div className='-mr-1.5 flex items-center gap-1'>
					{selection.provider === 'claude' ? (
						<McpServersPanel cwd={cwd} disabled={disabled} />
					) : null}
					{composer.contextUsage ? (
						<ContextIndicator usage={composer.contextUsage} />
					) : null}
					<AttachmentMenu
						disabled={disabled}
						onAddAttachment={draft.openFilePicker}
						onLinkDirectory={draft.openFilePicker}
					/>
					<Tooltip>
						<TooltipTrigger asChild>
							<span>
								<Button
									aria-label={
										isStreaming
											? t('common:actions.stop', 'Stop')
											: t('common:actions.send', 'Send')
									}
									className='size-7 rounded-full'
									disabled={
										!isStreaming &&
										(composer.isSending || !draft.canSend || disabled)
									}
									onClick={isStreaming ? onStop : composer.send}
									size='icon'
									variant={
										isStreaming || draft.canSend ? 'default' : 'secondary'
									}
								>
									{isStreaming ? <SquareIcon /> : <ArrowUpIcon />}
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>
							{isStreaming ? (
								t('workbench:concierge.composer.stop-tooltip', 'Stop the turn')
							) : (
								<>
									{t(
										'workbench:concierge.composer.send-tooltip',
										'Send message',
									)}
									<span className='ml-2 text-muted-foreground'>
										{composer.sendShortcutHint}
									</span>
								</>
							)}
						</TooltipContent>
					</Tooltip>
				</div>
			</div>
			<input
				accept='*/*'
				className='hidden'
				multiple
				onChange={draft.handleFileInputChange}
				ref={draft.fileInputRef}
				type='file'
			/>
		</div>
	);
}

/** The editor requires focus handlers; the Concierge composer has no use for them. */
function noop(): void {
	return;
}

/** The popover's mention half is unreachable here — the Concierge has no `@`. */
function noopMention(): void {
	return;
}

/** The popover closes itself from the draft's own token tracking. */
function noopOpenChange(): void {
	return;
}
